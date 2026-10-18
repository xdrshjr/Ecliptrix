import 'server-only';
import type { NextRequest } from 'next/server';
import { createPassthroughRoute, type RouteContext } from '@/lib/api/server/backend-proxy';

export function researchOriginAllowed(request: Request, write = false): boolean {
  // The packaged app injects RESEARCH_RENDERER_ORIGIN; a dev server on any other
  // port (3001, PORT=…) falls back to the request's own origin, which a
  // cross-site page cannot forge. Without this fallback every web_research write
  // — including reset-all — 403s outside port 3000.
  let selfOrigin = '';
  try {
    selfOrigin = new URL(request.url).origin;
  } catch {
    selfOrigin = '';
  }
  const allowed = process.env.RESEARCH_RENDERER_ORIGIN
    ? [process.env.RESEARCH_RENDERER_ORIGIN]
    : ['http://localhost:3000', 'http://127.0.0.1:3000', selfOrigin].filter(Boolean);
  const origin = request.headers.get('origin');
  if (origin && !allowed.includes(origin)) return false;
  if (write && (!origin || !request.headers.get('content-type')?.startsWith('application/json'))) {
    return false;
  }
  return request.headers.get('sec-fetch-site') !== 'cross-site';
}

export function researchProxyError(code: string, status: number) {
  return Response.json({ success: false, message: code, timestamp: new Date().toISOString(),
    error_code: code, error_details: { failure_class: 'validation', retryable: false } },
  { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Existing settings writes share the same boundary as credentials writes. */
export function protectedSettingsWrite(path: string | ((p: Record<string, string | string[]>) => string),
  method: 'POST' | 'PUT', always = false) {
  const proxy = createPassthroughRoute(path, { forwardHeaders: ['Origin'] });
  return async (request: NextRequest, context: RouteContext) => {
    const params = await context?.params;
    if ((always || params?.category === 'web_research') && !researchOriginAllowed(request, true)) {
      return researchProxyError('origin_forbidden', 403);
    }
    return proxy[method](request, context);
  };
}
