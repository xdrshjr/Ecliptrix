import 'server-only';
import type { NextRequest } from 'next/server';
import { createPassthroughRoute, type RouteContext } from '@/lib/api/server/backend-proxy';
import { protectedSettingsWrite } from '@/lib/server/researchUiOrigin';

type Handler = (request: NextRequest, context: RouteContext) => Promise<Response>;

/**
 * Adds `Cache-Control: no-store` to a proxied response. The generic proxy only
 * forwards `Content-Type`, so without this a status or model-resolution answer
 * could be reused by an HTTP cache after the user switched the source mode.
 */
export function withNoStore(handler: Handler): Handler {
  return async (request, context) => {
    const response = await handler(request, context);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  };
}

/** Read-only passthrough to a fixed backend path, never cached. */
export function skillrouterRead(backendPath: string, timeoutMs?: number): Handler {
  return withNoStore(createPassthroughRoute(backendPath, { timeoutMs }).GET);
}

/**
 * Mutating call. The backend rejects a write without `Origin` (403) or a JSON
 * content type (415) and the generic proxy forwards neither, so every write
 * goes through `protectedSettingsWrite(..., always = true)`.
 */
export function skillrouterWrite(
  backendPath: string,
  method: 'PUT' | 'DELETE' | 'POST',
): Handler {
  return withNoStore(protectedSettingsWrite(backendPath, method, true));
}
