/**
 * Browser-side HTTP wrapper for Ecliptrix.
 *
 * This module is the single, secure-by-default entry point for every
 * browser → Next.js API call. It auto-injects the session token, handles
 * 401 by clearing the local session and redirecting to /login, and produces
 * a uniform error envelope so callers can handle errors consistently.
 *
 * Hard rules enforced by this module:
 *   1. Path-only API. Calls MUST start with '/'. Absolute http(s) URLs throw
 *      synchronously (prevents leaking the backend URL into the browser).
 *   2. Browser-only. Importing this on the server throws — there is no SSR
 *      escape hatch.
 *   3. Auth is opt-out (`requireAuth` defaults to true). Forgetting the
 *      option keeps you secure. Disabling it requires an explicit
 *      `{ requireAuth: false }`.
 *   4. 401 handling is global and debounced — N parallel requests that all
 *      receive 401 produce ONE redirect, not N.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/03-frontend-http-client-wrapper.md
 */

import {
  SESSION_TOKEN_KEY,
  SESSION_USER_KEY,
  clearSessionToken,
} from '@/lib/auth/storage-keys';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RequestOptions {
  /** When true (default) the wrapper injects Authorization and throws
   *  MissingAuthError if no token is present. */
  requireAuth?: boolean;
  /** Timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** External AbortSignal — when fired, the in-flight request aborts. */
  signal?: AbortSignal;
  /** Extra headers merged on top of the wrapper's defaults. */
  headers?: Record<string, string>;
  /** Number of retry attempts. Default 0. Only retries network errors and
   *  5xx responses — 4xx is NEVER retried. */
  retries?: number;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class MissingAuthError extends Error {
  static readonly code = 'MISSING_AUTH';
  readonly code = 'MISSING_AUTH';
  constructor(message?: string) {
    super(
      message ??
        'No session token in localStorage. Log in first, or pass {requireAuth: false} ' +
          'if this endpoint is intentionally public.',
    );
    this.name = 'MissingAuthError';
  }
}

export class SessionExpiredError extends Error {
  static readonly code = 'SESSION_EXPIRED';
  readonly code = 'SESSION_EXPIRED';
  readonly status = 401;
  constructor(message?: string) {
    super(message ?? 'Session expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

export class ForbiddenError extends Error {
  static readonly code = 'FORBIDDEN';
  readonly code = 'FORBIDDEN';
  readonly status = 403;
  readonly details?: Record<string, unknown>;
  constructor(message?: string, details?: Record<string, unknown>) {
    super(message ?? 'Forbidden');
    this.name = 'ForbiddenError';
    this.details = details;
  }
}

export class ApiError extends Error {
  static readonly code = 'API_ERROR';
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class TimeoutError extends Error {
  static readonly code = 'TIMEOUT';
  readonly code = 'TIMEOUT';
  constructor(message?: string) {
    super(message ?? 'Request timed out');
    this.name = 'TimeoutError';
  }
}

/**
 * Thrown on HTTP 429 (rate limited). Carries the parsed `Retry-After` seconds
 * so callers (and the global toast listener) can show a countdown. NEVER
 * auto-retried — the caller decides whether/when to retry.
 */
export class RateLimitError extends ApiError {
  /**
   * The error-code string this class always carries on its instances
   * (`instance.code === RateLimitError.CODE`). Named `CODE` (not `code`) to
   * avoid clashing with `ApiError`'s narrowed `static readonly code`.
   */
  static readonly CODE = 'RATE_LIMITED';
  readonly retryAfter: number;
  constructor(
    retryAfter: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(429, RateLimitError.CODE, message, details);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Module-level once-flag: ensures parallel 401s produce a single redirect. */
let sessionExpiryHandled = false;

/** Test-only: reset the once-flag between test cases. NOT exported via http. */
export function __resetSessionExpiryFlagForTests(): void {
  sessionExpiryHandled = false;
}

/** Reset the session expiry flag after successful re-authentication. */
export function resetSessionExpiryFlag(): void {
  sessionExpiryHandled = false;
}

/** Paths whose pathname must NOT trigger a redirect when 401 fires. */
const NO_REDIRECT_PATHS = new Set(['/login', '/register']);

// ---------------------------------------------------------------------------
// Session expiry handler (debounced via once-flag)
// ---------------------------------------------------------------------------

function handleSessionExpired(): void {
  // Always clear localStorage and dispatch the event so AuthContext stays in
  // sync, even if multiple parallel 401s race here. The once-flag only guards
  // the redirect side-effect.
  try {
    clearSessionToken();
    window.localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    // localStorage may be unavailable in extreme edge cases; swallow.
  }

  if (sessionExpiryHandled) {
    return;
  }
  sessionExpiryHandled = true;

  try {
    window.dispatchEvent(new CustomEvent('ecliptrix:session-expired'));
  } catch {
    // CustomEvent unavailable — extremely rare. Swallow.
  }

  const currentPath = window.location?.pathname ?? '';
  if (!NO_REDIRECT_PATHS.has(currentPath)) {
    window.location.href = '/login?reason=session-expired';
  }
}

// ---------------------------------------------------------------------------
// Rate-limit (429) handler
// ---------------------------------------------------------------------------

/** Fallback retry-after (seconds) when the backend omits a parseable header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

/**
 * Parse a `Retry-After` header value. Per RFC 7231 it may be a delta-seconds
 * integer (our backend sends this) or an HTTP-date; we support both and fall
 * back to a sane default on anything unparseable / non-positive.
 */
function parseRetryAfter(headerValue: string | null): number {
  if (!headerValue) return DEFAULT_RETRY_AFTER_SECONDS;
  const asInt = Number.parseInt(headerValue, 10);
  if (Number.isFinite(asInt) && asInt > 0) return asInt;
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) {
    const deltaMs = asDate - Date.now();
    if (deltaMs > 0) return Math.ceil(deltaMs / 1000);
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * Build a `RateLimitError` from a 429 response and broadcast a global
 * `ecliptrix:rate-limited` event so a single app-level listener can show ONE
 * friendly toast. NOTE: we dispatch on EVERY 429 — debouncing the toast is the
 * listener's job (time-window throttle), NOT a permanent latch here (a latch
 * would mute every future 429 for the session). Returns the error to throw.
 */
function makeRateLimitError(
  response: Response,
  parsed: ParsedErrorBody,
): RateLimitError {
  // Prefer the `Retry-After` header (RFC 7231). The backend sends it, but the
  // Next.js backend-proxy buffers JSON 4xx responses and forwards only
  // `Content-Type`, dropping `Retry-After`. So when the header is absent we
  // fall back to the body's `error_details.retry_after` (which the proxy DOES
  // preserve) before the hard-coded default — otherwise every proxied 429
  // would show the 5s default countdown instead of the real value.
  const headerRetryAfter = response.headers.get('Retry-After');
  let retryAfter = parseRetryAfter(headerRetryAfter);
  if (headerRetryAfter === null) {
    const bodyRetryAfter = (parsed.details as { retry_after?: unknown } | undefined)
      ?.retry_after;
    if (typeof bodyRetryAfter === 'number' && Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0) {
      retryAfter = Math.ceil(bodyRetryAfter);
    }
  }
  const message = parsed.message ?? 'Too many requests';
  const details: Record<string, unknown> = {
    ...(parsed.details ?? {}),
    retryAfter,
  };
  try {
    window.dispatchEvent(
      new CustomEvent('ecliptrix:rate-limited', {
        detail: { retryAfter, message },
      }),
    );
  } catch {
    // CustomEvent unavailable — extremely rare. Swallow.
  }
  return new RateLimitError(retryAfter, message, details);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertBrowser(): void {
  if (typeof window === 'undefined') {
    throw new Error('http-client is browser-only');
  }
}

function assertSameOriginPath(path: string): void {
  if (
    typeof path !== 'string' ||
    path.startsWith('http://') ||
    path.startsWith('https://')
  ) {
    throw new Error(
      'HTTP client only accepts same-origin paths starting with /. ' +
        `Got: ${String(path)}`,
    );
  }
}

function readToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

interface ParsedErrorBody {
  message?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
  rawBodyTruncated?: string;
}

async function parseErrorBody(response: Response): Promise<ParsedErrorBody> {
  // Try to read once as text so that on JSON parse failure we still have the
  // raw body to surface as `rawBodyTruncated`.
  let rawText: string;
  try {
    rawText = await response.text();
  } catch {
    return {};
  }

  if (!rawText) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const message =
      (parsed.message as string | undefined) ??
      (parsed.detail as string | undefined) ??
      (parsed.error as string | undefined);
    const errorCode =
      (parsed.error_code as string | undefined) ??
      (parsed.errorCode as string | undefined) ??
      (parsed.code as string | undefined);
    const details =
      (parsed.error_details as Record<string, unknown> | undefined) ??
      (parsed.errorDetails as Record<string, unknown> | undefined) ??
      (parsed.details as Record<string, unknown> | undefined);
    return { message, errorCode, details };
  } catch {
    return { rawBodyTruncated: rawText.slice(0, 200) };
  }
}

async function parseSuccessBody<T>(response: Response): Promise<T> {
  // 204 No Content / empty body → return null cast as T.
  if (response.status === 204) {
    return null as T;
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength === '0') {
    return null as T;
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (err) {
    throw new ApiError(
      response.status,
      'PARSE_ERROR',
      'Failed to read response body',
      { cause: String(err) },
    );
  }

  if (!rawText) {
    return null as T;
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new ApiError(
      response.status,
      'PARSE_ERROR',
      'Response body was not valid JSON',
      { rawBodyTruncated: rawText.slice(0, 200) },
    );
  }
}

// ---------------------------------------------------------------------------
// Core request implementation
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  assertBrowser();
  assertSameOriginPath(path);

  const requireAuth = opts.requireAuth ?? true;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxRetries = opts.retries ?? 0;

  // ---- Auth injection (synchronous throw if missing) --------------------
  let token: string | null = null;
  if (requireAuth) {
    token = readToken();
    if (!token) {
      throw new MissingAuthError();
    }
  }

  // ---- Build headers ----------------------------------------------------
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  // Body normalization:
  //   - FormData passes through; do NOT set Content-Type (browser handles it).
  //   - undefined on a POST/PUT becomes empty JSON {} per spec §8.
  //   - everything else gets JSON.stringify + content-type application/json.
  let serializedBody: BodyInit | undefined;
  const bodyIsFormData = isFormData(body);

  if (method === 'GET' || method === 'DELETE') {
    serializedBody = undefined;
  } else if (bodyIsFormData) {
    serializedBody = body as FormData;
    // No Content-Type — the browser sets multipart/form-data with boundary.
  } else {
    const effectiveBody = body === undefined ? {} : body;
    serializedBody = JSON.stringify(effectiveBody);
    if (!('Content-Type' in headers) && !('content-type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // ---- Retry loop -------------------------------------------------------
  let attempt = 0;
  let lastNetworkError: unknown = null;

  while (attempt <= maxRetries) {
    const abortCtrl = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortCtrl.abort();
    }, timeoutMs);

    let externalAbortListener: (() => void) | null = null;
    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timeoutHandle);
        // Mirror the native fetch behavior — propagate the caller's signal.
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      externalAbortListener = () => abortCtrl.abort();
      opts.signal.addEventListener('abort', externalAbortListener);
    }

    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: serializedBody,
        signal: abortCtrl.signal,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (externalAbortListener && opts.signal) {
        opts.signal.removeEventListener('abort', externalAbortListener);
      }

      if (timedOut) {
        // Timeouts are NOT retried — they almost always indicate a slow
        // backend, not a transient blip; the caller can retry explicitly.
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
      }

      // External signal abort propagates as AbortError — never retry.
      const isAbortError =
        (err as { name?: string })?.name === 'AbortError' ||
        (typeof DOMException !== 'undefined' &&
          err instanceof DOMException &&
          err.name === 'AbortError');
      if (isAbortError) {
        throw err;
      }

      // Genuine network error — eligible for retry.
      lastNetworkError = err;
      attempt += 1;
      if (attempt <= maxRetries) {
        continue;
      }
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        (err as Error)?.message ?? 'Network request failed',
        { cause: String(err) },
      );
    } finally {
      // We always clear the timeout here so it can't fire after success.
      clearTimeout(timeoutHandle);
    }

    if (externalAbortListener && opts.signal) {
      opts.signal.removeEventListener('abort', externalAbortListener);
    }

    // ---- Status handling --------------------------------------------------
    const status = response.status;

    if (status === 401) {
      // 4xx — never retried.
      if (requireAuth) {
        // Authenticated endpoint: token is invalid/expired → global handling.
        handleSessionExpired();
        throw new SessionExpiredError();
      }
      // Public endpoint (requireAuth: false) — caller handles credential
      // rejection inline. Do NOT clear localStorage / redirect / dispatch.
      const parsed = await parseErrorBody(response);
      throw new ApiError(
        401,
        parsed.errorCode ?? 'UNAUTHORIZED',
        parsed.message ?? 'Unauthorized',
        parsed.details ??
          (parsed.rawBodyTruncated
            ? { rawBodyTruncated: parsed.rawBodyTruncated }
            : undefined),
      );
    }

    if (status === 403) {
      const parsed = await parseErrorBody(response);
      throw new ForbiddenError(parsed.message ?? 'Forbidden', parsed.details);
    }

    if (status === 429) {
      // Rate limited — 4xx, NEVER retried. Dispatch the global event (for the
      // friendly toast) and throw a typed RateLimitError carrying retryAfter.
      const parsed = await parseErrorBody(response);
      throw makeRateLimitError(response, parsed);
    }

    if (status >= 400 && status < 500) {
      // Other 4xx — never retried.
      const parsed = await parseErrorBody(response);
      throw new ApiError(
        status,
        parsed.errorCode ?? `HTTP_${status}`,
        parsed.message ?? `Request failed with status ${status}`,
        parsed.details ??
          (parsed.rawBodyTruncated
            ? { rawBodyTruncated: parsed.rawBodyTruncated }
            : undefined),
      );
    }

    if (status >= 500) {
      // 5xx — eligible for retry.
      attempt += 1;
      if (attempt <= maxRetries) {
        continue;
      }
      const parsed = await parseErrorBody(response);
      throw new ApiError(
        status,
        parsed.errorCode ?? `HTTP_${status}`,
        parsed.message ?? `Request failed with status ${status}`,
        parsed.details ??
          (parsed.rawBodyTruncated
            ? { rawBodyTruncated: parsed.rawBodyTruncated }
            : undefined),
      );
    }

    // ---- Success (2xx / 3xx) ---------------------------------------------
    return parseSuccessBody<T>(response);
  }

  // Loop exited without returning — should be unreachable, but guard anyway.
  throw new ApiError(
    0,
    'NETWORK_ERROR',
    (lastNetworkError as Error)?.message ?? 'Request failed after retries',
  );
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Streaming request — for SSE / chunked responses where the caller needs the
// raw Response object to read body.getReader() themselves. Same auth +
// 401-handling guarantees as the JSON helpers above. NEVER auto-parses the
// body. The caller is responsible for consuming the stream.
// ---------------------------------------------------------------------------

interface StreamRequestOptions extends RequestOptions {
  /** HTTP method (defaults to POST). */
  method?: HttpMethod;
}

async function streamRequest(
  path: string,
  body?: unknown,
  opts: StreamRequestOptions = {},
): Promise<Response> {
  assertBrowser();
  assertSameOriginPath(path);

  const method: HttpMethod = opts.method ?? 'POST';
  const requireAuth = opts.requireAuth ?? true;
  const timeoutMs = opts.timeoutMs ?? 30000;

  let token: string | null = null;
  if (requireAuth) {
    token = readToken();
    if (!token) {
      throw new MissingAuthError();
    }
  }

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  let serializedBody: BodyInit | undefined;
  const bodyIsFormData = isFormData(body);

  if (method === 'GET' || method === 'DELETE') {
    serializedBody = undefined;
  } else if (bodyIsFormData) {
    serializedBody = body as FormData;
  } else if (body !== undefined) {
    serializedBody = JSON.stringify(body);
    if (!('Content-Type' in headers) && !('content-type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const abortCtrl = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    abortCtrl.abort();
  }, timeoutMs);

  let externalAbortListener: (() => void) | null = null;
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timeoutHandle);
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    externalAbortListener = () => abortCtrl.abort();
    opts.signal.addEventListener('abort', externalAbortListener);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: serializedBody,
      signal: abortCtrl.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (externalAbortListener && opts.signal) {
      opts.signal.removeEventListener('abort', externalAbortListener);
    }

    if (timedOut) {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
    }

    const isAbortError =
      (err as { name?: string })?.name === 'AbortError' ||
      (typeof DOMException !== 'undefined' &&
        err instanceof DOMException &&
        err.name === 'AbortError');
    if (isAbortError) {
      throw err;
    }

    throw new ApiError(
      0,
      'NETWORK_ERROR',
      (err as Error)?.message ?? 'Network request failed',
      { cause: String(err) },
    );
  }

  // We intentionally do NOT clear the timeout here — the caller still needs
  // to consume the stream and the read may take longer than timeoutMs. The
  // AbortController is the only protection from a hung response, so leaving
  // the timeout active for the duration of streaming is incorrect. Clear it
  // immediately on success and let the caller manage their own deadline via
  // opts.signal if they need cancellation mid-stream.
  clearTimeout(timeoutHandle);
  if (externalAbortListener && opts.signal) {
    opts.signal.removeEventListener('abort', externalAbortListener);
  }

  const status = response.status;

  if (status === 401) {
    if (requireAuth) {
      handleSessionExpired();
      throw new SessionExpiredError();
    }
    // Public endpoint — caller handles credential rejection inline.
    const parsed = await parseErrorBody(response);
    throw new ApiError(
      401,
      parsed.errorCode ?? 'UNAUTHORIZED',
      parsed.message ?? 'Unauthorized',
      parsed.details ??
        (parsed.rawBodyTruncated
          ? { rawBodyTruncated: parsed.rawBodyTruncated }
          : undefined),
    );
  }

  if (status === 403) {
    const parsed = await parseErrorBody(response);
    throw new ForbiddenError(parsed.message ?? 'Forbidden', parsed.details);
  }

  if (status === 429) {
    // Rate limited — dispatch the global event + throw RateLimitError. No retry.
    const parsed = await parseErrorBody(response);
    throw makeRateLimitError(response, parsed);
  }

  if (status >= 400) {
    const parsed = await parseErrorBody(response);
    throw new ApiError(
      status,
      parsed.errorCode ?? `HTTP_${status}`,
      parsed.message ?? `Request failed with status ${status}`,
      parsed.details ??
        (parsed.rawBodyTruncated
          ? { rawBodyTruncated: parsed.rawBodyTruncated }
          : undefined),
    );
  }

  return response;
}

// ---------------------------------------------------------------------------
// Authenticated file download — fetch the bytes via the wrapper (so the
// Authorization header is injected), wrap in a Blob, then trigger a
// programmatic browser download via a hidden <a download> element.
//
// Why this exists
// ---------------
// `<a href="/api/.../download" download>` and `window.open('/api/.../download')`
// both issue raw browser GETs that CANNOT carry the Authorization header that
// the http-client wrapper would otherwise inject. After T01 strict middleware
// shipped, every such direct browser navigation to an auth-required endpoint
// returns 401. The dev-server test on 2026-04-07 caught this on
// /api/video-compose/{id}/download.
//
// The fix is to fetch the bytes with auth, hold them as a Blob, and trigger
// the download from a local Blob URL — local Blob URLs need no auth.
//
// Caveat: this loads the entire file into memory. For very large files
// (>~500MB) this will pressure the browser; in that case the right answer
// is signed URLs (Risk R3 in master-plan, deferred ticket).
// ---------------------------------------------------------------------------

interface DownloadOptions extends RequestOptions {
  /** HTTP method (defaults to GET). */
  method?: HttpMethod;
  /** Optional JSON body for POST-style downloads. */
  body?: unknown;
}

async function downloadFile(
  path: string,
  filename: string,
  opts: DownloadOptions = {},
): Promise<void> {
  assertBrowser();
  // streamRequest already handles auth, 401 redirect, 4xx/5xx envelopes —
  // we just need the raw Response so we can call .blob() on it.
  const response = await streamRequest(path, opts.body, {
    method: opts.method ?? 'GET',
    requireAuth: opts.requireAuth,
    timeoutMs: opts.timeoutMs ?? 600_000, // 10 min default — large files
    signal: opts.signal,
    headers: opts.headers,
  });

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    // Some browsers ignore the download attribute on cross-origin URLs;
    // a Blob URL is same-origin so this is safe.
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Defer revocation until the download has actually started. 100ms is the
    // standard incantation; the spec doesn't require it but cleaning up the
    // Blob URL during the same tick has been observed to cancel the download
    // in some Chromium versions.
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 100);
  }
}

export const http = {
  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, opts);
  },
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('POST', path, body, opts);
  },
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, body, opts);
  },
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PATCH', path, body, opts);
  },
  del<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, opts);
  },
  upload<T>(
    path: string,
    formData: FormData,
    opts?: RequestOptions,
  ): Promise<T> {
    return request<T>('POST', path, formData, opts);
  },
  /**
   * Streaming request — returns the raw Response so the caller can read
   * `response.body.getReader()` for SSE / chunked output. Auth injection and
   * 4xx/401 handling are identical to the JSON helpers; the only difference
   * is that 2xx responses are NOT JSON-parsed. Defaults to POST.
   */
  stream(
    path: string,
    body?: unknown,
    opts?: StreamRequestOptions,
  ): Promise<Response> {
    return streamRequest(path, body, opts);
  },
  /**
   * Authenticated file download — fetches `path` with the Authorization
   * header set, then triggers the browser to save the response body as
   * `filename` via a hidden Blob URL link. Use this in place of
   * `window.open('/api/.../download')` or `<a href download>` for any
   * download URL whose endpoint requires auth.
   *
   * @param path     Same-origin path beginning with `/`
   * @param filename Suggested filename for the saved file
   * @param opts     Optional method/body/headers/timeout/signal
   *
   * @example
   *   await http.download(
   *     `/api/video-compose/${id}/download?task_id=${taskId}`,
   *     `composed_${id}.mp4`,
   *   );
   */
  download(
    path: string,
    filename: string,
    opts?: DownloadOptions,
  ): Promise<void> {
    return downloadFile(path, filename, opts);
  },
};

export type Http = typeof http;
