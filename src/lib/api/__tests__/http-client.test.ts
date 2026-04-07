/**
 * Vitest unit tests for `src/lib/api/http-client.ts`.
 *
 * Coverage: spec §6 cases T1-T18.
 *
 * IMPORTANT: Vitest is NOT YET INSTALLED in this repo — that is T07's job.
 * This file is valid Vitest syntax and will run as soon as `vitest` and
 * `@vitest/expect` are added to devDependencies and the vitest config wires up
 * a jsdom-like environment that exposes `window` and `localStorage`.
 *
 * Local conventions for these tests:
 *   - We mock `fetch` via `vi.fn()` so each test fully owns the response.
 *   - We mock `window.localStorage` with an in-memory store.
 *   - We mock `window.location` so 401-redirect tests can assert the target
 *     URL without actually navigating jsdom.
 *   - We reset the module-level once-flag between tests via the
 *     `__resetSessionExpiryFlagForTests` test hook exported from the wrapper.
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
  ForbiddenError,
  MissingAuthError,
  SessionExpiredError,
  TimeoutError,
  __resetSessionExpiryFlagForTests,
} from '../http-client';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from '@/lib/auth/storage-keys';

// ---------------------------------------------------------------------------
// Test plumbing
// ---------------------------------------------------------------------------

interface MockLocation {
  pathname: string;
  href: string;
}

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

let mockLocation: MockLocation;

beforeEach(() => {
  // Reset storage
  for (const k of Object.keys(STORAGE_STATE)) delete STORAGE_STATE[k];

  // Reset module-level once-flag
  __resetSessionExpiryFlagForTests();

  // Mock localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: makeStorageMock(),
  });

  // Mock window.location — vitest's jsdom env provides window, but we replace
  // location so we can read/write `href` and `pathname` without navigating.
  mockLocation = { pathname: '/some-protected-page', href: '' };
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: mockLocation,
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

function seedToken(token = 'test-session-token') {
  STORAGE_STATE[SESSION_TOKEN_KEY] = token;
}

// ---------------------------------------------------------------------------
// Test cases (T1 - T18 from spec §6)
// ---------------------------------------------------------------------------

describe('http-client', () => {
  // -------------------------------------------------------------------------
  // T1 — requireAuth default true, no token → MissingAuthError, no fetch
  // -------------------------------------------------------------------------
  it('T1: throws MissingAuthError when no token is present and requireAuth is default', async () => {
    await expect(http.get('/api/x')).rejects.toBeInstanceOf(MissingAuthError);
    expect(asMockFetch()).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T2 — requireAuth: false bypasses auth check, no Authorization header sent
  // -------------------------------------------------------------------------
  it('T2: with requireAuth:false issues fetch without Authorization header', async () => {
    asMockFetch().mockResolvedValue(makeJsonResponse(200, { ok: true }));

    const result = await http.get<{ ok: boolean }>('/api/x', { requireAuth: false });
    expect(result).toEqual({ ok: true });

    expect(asMockFetch()).toHaveBeenCalledTimes(1);
    const init = asMockFetch().mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
  });

  // -------------------------------------------------------------------------
  // T3 — token present → fetch sent with Authorization: Bearer <token>
  // -------------------------------------------------------------------------
  it('T3: injects Authorization: Bearer <token> when token is present', async () => {
    seedToken('abc-123');
    asMockFetch().mockResolvedValue(makeJsonResponse(200, { ok: true }));

    await http.get('/api/x');

    expect(asMockFetch()).toHaveBeenCalledTimes(1);
    const init = asMockFetch().mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer abc-123');
  });

  // -------------------------------------------------------------------------
  // T4 — JSON POST body and content-type
  // -------------------------------------------------------------------------
  it('T4: post serializes JSON body and sets Content-Type application/json', async () => {
    seedToken();
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
    seedToken();
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
    seedToken();
    asMockFetch().mockResolvedValue(makeJsonResponse(200, { ok: true, value: 42 }));

    const result = await http.get<{ ok: boolean; value: number }>('/api/x');
    expect(result).toEqual({ ok: true, value: 42 });
  });

  // -------------------------------------------------------------------------
  // T7 — 401 response → clears storage, fires event, redirects, throws
  // -------------------------------------------------------------------------
  it('T7: 401 clears storage, dispatches event, redirects to /login, throws SessionExpiredError', async () => {
    seedToken('about-to-expire');
    STORAGE_STATE[SESSION_USER_KEY] = JSON.stringify({ id: 'u1' });
    asMockFetch().mockResolvedValue(makeJsonResponse(401, { error: 'unauthorized' }));

    const eventSpy = vi.fn();
    window.addEventListener('ecliptrix:session-expired', eventSpy);

    await expect(http.get('/api/x')).rejects.toBeInstanceOf(SessionExpiredError);

    // Order matters: storage must be cleared BEFORE redirect.
    expect(STORAGE_STATE[SESSION_TOKEN_KEY]).toBeUndefined();
    expect(STORAGE_STATE[SESSION_USER_KEY]).toBeUndefined();

    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(mockLocation.href).toBe('/login?reason=session-expired');

    window.removeEventListener('ecliptrix:session-expired', eventSpy);
  });

  // -------------------------------------------------------------------------
  // T8 — 401 while already on /login → no redirect, but event still fires
  // -------------------------------------------------------------------------
  it('T8: 401 while on /login does NOT redirect but still clears storage and fires event', async () => {
    seedToken('expired');
    STORAGE_STATE[SESSION_USER_KEY] = JSON.stringify({ id: 'u1' });
    mockLocation.pathname = '/login';
    asMockFetch().mockResolvedValue(makeJsonResponse(401, { error: 'unauthorized' }));

    const eventSpy = vi.fn();
    window.addEventListener('ecliptrix:session-expired', eventSpy);

    await expect(http.get('/api/x')).rejects.toBeInstanceOf(SessionExpiredError);

    expect(STORAGE_STATE[SESSION_TOKEN_KEY]).toBeUndefined();
    expect(STORAGE_STATE[SESSION_USER_KEY]).toBeUndefined();
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(mockLocation.href).toBe(''); // no navigation

    window.removeEventListener('ecliptrix:session-expired', eventSpy);
  });

  // -------------------------------------------------------------------------
  // T9 — 403 → ForbiddenError carrying body, no logout, no redirect
  // -------------------------------------------------------------------------
  it('T9: 403 throws ForbiddenError carrying body details (no logout, no redirect)', async () => {
    seedToken();
    asMockFetch().mockResolvedValue(
      makeJsonResponse(403, {
        error_code: 'PERMISSION_DENIED',
        message: 'You shall not pass',
      }),
    );

    let thrown: unknown;
    try {
      await http.get('/api/x');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ForbiddenError);
    expect((thrown as ForbiddenError).message).toBe('You shall not pass');
    expect((thrown as ForbiddenError).status).toBe(403);
    // Storage NOT cleared — user is still logged in, just lacks permission.
    expect(STORAGE_STATE[SESSION_TOKEN_KEY]).toBe('test-session-token');
    expect(mockLocation.href).toBe('');
  });

  // -------------------------------------------------------------------------
  // T10 — 500 with full error envelope → ApiError with all fields populated
  // -------------------------------------------------------------------------
  it('T10: 500 with full error envelope produces ApiError with status/code/message/details', async () => {
    seedToken();
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
    seedToken();
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
    seedToken();
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
    seedToken();
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
    seedToken();
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
    seedToken();
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
  it('T16: retries:2 with 401 first attempt does NOT retry — 4xx is never retried', async () => {
    seedToken();
    asMockFetch().mockResolvedValueOnce(makeJsonResponse(401, { error: 'no' }));

    await expect(http.get('/api/x', { retries: 2 })).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(asMockFetch()).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // T17 — path starting with http:// throws synchronously, no fetch issued
  // -------------------------------------------------------------------------
  it('T17: absolute http(s) URL is rejected synchronously and no fetch is issued', async () => {
    seedToken();

    await expect(http.get('http://evil.com/x')).rejects.toThrow(
      /same-origin paths starting with \//,
    );
    await expect(http.get('https://evil.com/x')).rejects.toThrow(
      /same-origin paths starting with \//,
    );
    expect(asMockFetch()).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T18 — Parallel 401 burst → debounced to a single redirect
  // -------------------------------------------------------------------------
  it('T18: 10 parallel requests all returning 401 produce a single redirect (once-flag)', async () => {
    seedToken();
    STORAGE_STATE[SESSION_USER_KEY] = JSON.stringify({ id: 'u1' });
    asMockFetch().mockResolvedValue(makeJsonResponse(401, { error: 'no' }));

    let assignmentCount = 0;
    Object.defineProperty(mockLocation, 'href', {
      configurable: true,
      get() {
        return this._href ?? '';
      },
      set(v: string) {
        assignmentCount += 1;
        this._href = v;
      },
    });

    const eventSpy = vi.fn();
    window.addEventListener('ecliptrix:session-expired', eventSpy);

    const requests = Array.from({ length: 10 }, () =>
      http.get('/api/x').catch((e) => e),
    );
    const results = await Promise.all(requests);

    // Every request must have rejected with SessionExpiredError.
    for (const r of results) {
      expect(r).toBeInstanceOf(SessionExpiredError);
    }
    // ...but only ONE navigation happened.
    expect(assignmentCount).toBe(1);
    // Event also debounced — only one dispatch.
    expect(eventSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener('ecliptrix:session-expired', eventSpy);
  });
});
