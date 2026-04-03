import type { ToolContext } from '../types';

/**
 * Construct an absolute URL for internal API calls from the server-side agent context.
 * Uses `context.apiBaseUrl` which is derived from the incoming request's origin,
 * ensuring the URL always points to the correct host/port regardless of how the
 * server was started.
 */
export function apiUrl(context: ToolContext, path: string): string {
  return `${context.apiBaseUrl}${path}`;
}

// ---------------------------------------------------------------------------
// toolFetch — shared fetch wrapper for all agent tools
// ---------------------------------------------------------------------------

export interface ToolFetchOptions {
  /** Timeout in ms. Default 30000 */
  timeout?: number;
  /** Whether to retry on network errors. Default true */
  retry?: boolean;
  /** Max retry attempts. Default 1 */
  maxRetries?: number;
}

/** Delay helper for retry back-off. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared fetch wrapper for all agent tools.
 *
 * - Applies `AbortSignal.timeout()` for automatic timeout
 * - Retries once on network errors (`TypeError`) only
 * - Does NOT retry on timeout (`TimeoutError`) or caller cancellation (`AbortError`) or HTTP 4xx/5xx
 * - Automatically sets `Content-Type: application/json`
 * - Uses `context.apiBaseUrl` for URL construction
 */
export async function toolFetch(
  context: ToolContext,
  path: string,
  init?: RequestInit & ToolFetchOptions,
): Promise<Response> {
  const {
    timeout = 30_000,
    retry = true,
    maxRetries = 1,
    signal: callerSignal,
    headers: callerHeaders,
    ...restInit
  } = init ?? {};

  // Build the abort signal: always include a timeout signal, and combine with
  // any caller-provided signal so that either can cancel the request.
  const timeoutSignal = AbortSignal.timeout(timeout);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;

  // Merge headers — ensure Content-Type defaults to application/json but
  // callers can override by passing their own Content-Type.
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(callerHeaders instanceof Headers
      ? Object.fromEntries(callerHeaders.entries())
      : Array.isArray(callerHeaders)
        ? Object.fromEntries(callerHeaders)
        : callerHeaders),
  };

  const url = apiUrl(context, path);
  const fetchInit: RequestInit = { ...restInit, headers, signal };

  const maxAttempts = retry ? 1 + maxRetries : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, fetchInit);
      // Return on any HTTP response — even 4xx/5xx. The caller decides how to
      // handle non-ok statuses. We do NOT retry on HTTP errors because those
      // are deterministic backend responses, not transient network issues.
      return response;
    } catch (error: unknown) {
      // TimeoutError (from AbortSignal.timeout()) or AbortError (from caller
      // cancellation) — never retry either case.
      if (
        error instanceof DOMException &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw error;
      }

      // TypeError indicates a network-level failure (DNS, connection refused,
      // etc.). Retry if we have attempts remaining.
      if (error instanceof TypeError && attempt < maxAttempts) {
        await delay(1_000);
        continue;
      }

      // Out of retries or non-retryable error — propagate.
      throw error;
    }
  }

  // TypeScript exhaustiveness — the loop always returns or throws.
  throw new Error('toolFetch: unexpected end of retry loop');
}

// ---------------------------------------------------------------------------
// parseToolResponse — safe JSON parse for tool responses
// ---------------------------------------------------------------------------

/**
 * Safely parse a `Response` body as JSON.
 *
 * Returns the parsed object on success. On JSON parse failure, returns
 * `{ success: false, error: 'Invalid JSON response' }` so that callers can
 * treat it uniformly without try/catch at every call site.
 */
export async function parseToolResponse<T = Record<string, unknown>>(
  response: Response,
): Promise<T | { success: false; error: string }> {
  try {
    return (await response.json()) as T;
  } catch {
    return { success: false, error: 'Invalid JSON response' };
  }
}
