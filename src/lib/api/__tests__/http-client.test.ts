/**
 * Vitest unit tests for `src/lib/api/http-client.ts`.
 *
 * The auth cases are gone with the auth layer (desktop-only-refactor §4.9).
 * What remains guards the parts that are still load-bearing: timeouts, the
 * retry policy, the same-origin path whitelist and the uniform error envelope
 * — plus the 429 / `RateLimitError` branch, which is NEW here. That branch was
 * previously untested despite being the one the refactor spec singles out as
 * "must not be removed" (media_proxy_service still throttles per IP, so a 429
 * is still reachable). An untested must-keep branch is how it got deleted by
 * accident the first time.
 *
 * Local conventions for these tests:
 *   - We mock `fetch` via `vi.fn()` so each test fully owns the response.
 *   - We mock `window.localStorage` with an in-memory store.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import {
  http,
  ApiError,
  RateLimitError,
  TimeoutError,
} from '../http-client';

// ---------------------------------------------------------------------------
// Test plumbing
// ---------------------------------------------------------------------------

const STORAGE_STATE: Record<string, string> = {};

function makeStorageMock(): Storage {
  return {
    getItem: vi.fn((key: string) => (key in STORAGE_STATE ? STORAGE_STATE[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      STORAGE_STATE[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete STORAGE_STATE[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(STORAGE_STATE)) delete STORAGE_STATE[k];
    }),
    key: vi.fn((index: number) => Object.keys(STORAGE_STATE)[index] ?? null),
    get length() {
      return Object.keys(STORAGE_STATE).length;
    },
  } as Storage;
}

function makeJsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => {
        const lowerName = name.toLowerCase();
        if (lowerName === 'content-length') return String(text.length);
        return headers[lowerName] ?? null;
      },
    },
    text: vi.fn(async () => text),
    json: vi.fn(async () => JSON.parse(text)),
  } as unknown as Response;
}

function makeRawResponse(
  status: number,
  rawBody: string,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => {
        const lowerName = name.toLowerCase();
        if (lowerName === 'content-length') return String(rawBody.length);
        return headers[lowerName] ?? null;
      },
    },
    text: vi.fn(async () => rawBody),
    json: vi.fn(async () => {
      throw new Error('not valid JSON');
    }),
  } as unknown as Response;
}

beforeEach(() => {
  // Reset storage
  for (const k of Object.keys(STORAGE_STATE)) delete STORAGE_STATE[k];

  // Mock localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: makeStorageMock(),
  });

  // Reset fetch
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function asMockFetch(): Mock {
  return globalThis.fetch as unknown as Mock;
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('http-client', () => {
  // -------------------------------------------------------------------------
  // T4 — JSON POST body and content-type
  // -------------------------------------------------------------------------
  it('T4: post serializes JSON body and sets Content-Type application/json', async () => {
    asMockFetch().mockResolvedValue(makeJsonResponse(200, { ok: true }));

    await http.post('/api/x', { a: 1 });

    const init = asMockFetch().mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  // -------------------------------------------------------------------------
  // T5 — FormData upload omits Content-Type
  // -------------------------------------------------------------------------
  it('T5: upload with FormData does NOT set Content-Type header', async () => {
    asMockFetch().mockResolvedValue(makeJsonResponse(200, { ok: true }));

    const fd = new FormData();
    fd.append('file', new Blob(['hello']), 'hello.txt');

    await http.upload('/api/x', fd);

    const init = asMockFetch().mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
    expect(init.body).toBe(fd);
  });

  // -------------------------------------------------------------------------
  // T6 — happy path 200 → resolves with parsed body
  // -------------------------------------------------------------------------
  it('T6: resolves with parsed JSON body on 200', async () => {
    asMockFetch().mockResolvedValue(makeJsonResponse(200, { ok: true, value: 42 }));

    const result = await http.get<{ ok: boolean; value: number }>('/api/x');
    expect(result).toEqual({ ok: true, value: 42 });
  });
  // -------------------------------------------------------------------------
  // T22 — 429 → RateLimitError carrying Retry-After, and a global event.
  //
  // Guards the branch the refactor spec forbids removing: the per-IP download
  // throttle in media_proxy_service still answers 429, and dropping this
  // branch would degrade it into an unclassified error with no countdown.
  // -------------------------------------------------------------------------
  it('T22: 429 throws RateLimitError carrying the Retry-After seconds', async () => {
    asMockFetch().mockResolvedValue(
      makeJsonResponse(429, { message: 'Slow down' }, { 'retry-after': '17' }),
    );

    let thrown: unknown;
    try {
      await http.get('/api/material/lookup');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).retryAfter).toBe(17);
    expect((thrown as RateLimitError).status).toBe(429);
    expect((thrown as RateLimitError).code).toBe(RateLimitError.CODE);
    // 4xx is never retried.
    expect(asMockFetch()).toHaveBeenCalledTimes(1);
  });

  it('T23: 429 without a Retry-After header falls back to error_details.retry_after', async () => {
    // The Next.js proxy buffers JSON 4xx bodies and drops `Retry-After`, so the
    // body value is the only surviving source of the real countdown.
    asMockFetch().mockResolvedValue(
      makeJsonResponse(429, {
        message: 'Slow down',
        error_details: { retry_after: 9 },
      }),
    );

    let thrown: unknown;
    try {
      await http.get('/api/material/lookup');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).retryAfter).toBe(9);
  });

  it('T24: 429 dispatches the global ecliptrix:rate-limited event', async () => {
    asMockFetch().mockResolvedValue(
      makeJsonResponse(429, { message: 'Slow down' }, { 'retry-after': '3' }),
    );

    const eventSpy = vi.fn();
    window.addEventListener('ecliptrix:rate-limited', eventSpy);
    await expect(http.get('/api/material/lookup')).rejects.toBeInstanceOf(
      RateLimitError,
    );
    window.removeEventListener('ecliptrix:rate-limited', eventSpy);

    expect(eventSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // T10 — 500 with full error envelope → ApiError with all fields populated
  // -------------------------------------------------------------------------
  it('T10: 500 with full error envelope produces ApiError with status/code/message/details', async () => {
    asMockFetch().mockResolvedValue(
      makeJsonResponse(500, {
        error_code: 'INTERNAL_FAILURE',
        message: 'Database is on fire',
        error_details: { table: 'users', op: 'select' },
      }),
    );

    let thrown: unknown;
    try {
      await http.get('/api/x');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const err = thrown as ApiError;
    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL_FAILURE');
    expect(err.message).toBe('Database is on fire');
    expect(err.details).toEqual({ table: 'users', op: 'select' });
  });

  // -------------------------------------------------------------------------
  // T11 — 500 with non-JSON body → ApiError with rawBodyTruncated in details
  // -------------------------------------------------------------------------
  it('T11: 500 with non-JSON body produces ApiError carrying rawBodyTruncated', async () => {
    asMockFetch().mockResolvedValue(makeRawResponse(500, '<html>oops</html>'));

    let thrown: unknown;
    try {
      await http.get('/api/x');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const err = thrown as ApiError;
    expect(err.status).toBe(500);
    expect(err.details).toEqual({ rawBodyTruncated: '<html>oops</html>' });
  });

  // -------------------------------------------------------------------------
  // T12 — Network error → ApiError(NETWORK_ERROR) when retries=0
  // -------------------------------------------------------------------------
  it('T12: network error throws ApiError with NETWORK_ERROR code', async () => {
    asMockFetch().mockRejectedValue(new TypeError('Failed to fetch'));

    let thrown: unknown;
    try {
      await http.get('/api/x');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe('NETWORK_ERROR');
    expect((thrown as ApiError).status).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T13 — timeoutMs:50 with slow backend → TimeoutError
  // -------------------------------------------------------------------------
  it('T13: timeoutMs honored — slow backend produces TimeoutError', async () => {
    // Simulate a fetch that respects abort: never resolves until aborted.
    asMockFetch().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    await expect(http.get('/api/x', { timeoutMs: 50 })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  // -------------------------------------------------------------------------
  // T14 — external signal abort propagates as AbortError
  // -------------------------------------------------------------------------
  it('T14: external AbortSignal cancellation throws AbortError', async () => {
    const ctrl = new AbortController();

    asMockFetch().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const promise = http.get('/api/x', { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);

    let thrown: unknown;
    try {
      await promise;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as Error).name).toBe('AbortError');
  });

  // -------------------------------------------------------------------------
  // T15 — retries:2 with 500/500/200 sequence eventually succeeds
  // -------------------------------------------------------------------------
  it('T15: retries:2 succeeds on third attempt after two 500s', async () => {
    asMockFetch()
      .mockResolvedValueOnce(makeJsonResponse(500, { error: 'fail-1' }))
      .mockResolvedValueOnce(makeJsonResponse(500, { error: 'fail-2' }))
      .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }));

    const result = await http.get<{ ok: boolean }>('/api/x', { retries: 2 });
    expect(result).toEqual({ ok: true });
    expect(asMockFetch()).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // T16 — retries:2 with 401 first → does NOT retry (4xx never retried)
  // -------------------------------------------------------------------------
  it('T16: retries:2 with a 4xx first attempt does NOT retry', async () => {
    asMockFetch().mockResolvedValue(makeJsonResponse(403, { message: 'Forbidden' }));

    await expect(http.get('/api/x', { retries: 2 })).rejects.toBeInstanceOf(
      ApiError,
    );
    // One attempt only — 4xx is a verdict, not a blip.
    expect(asMockFetch()).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // T17 — path starting with http:// throws synchronously, no fetch issued
  // -------------------------------------------------------------------------
  it('T17: absolute http(s) URL is rejected synchronously and no fetch is issued', async () => {

    await expect(http.get('http://evil.com/x')).rejects.toThrow(
      /same-origin paths starting with \//,
    );
    await expect(http.get('https://evil.com/x')).rejects.toThrow(
      /same-origin paths starting with \//,
    );
    expect(asMockFetch()).not.toHaveBeenCalled();
  });});
