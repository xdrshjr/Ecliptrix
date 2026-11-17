import type { NextRequest } from 'next/server';
import { backendProxy, type RouteContext } from '@/lib/api/server/backend-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = '[0-9a-fA-F-]{36}';
const RULES: Record<string, RegExp[]> = {
  GET: [/^capabilities$/, /^libraries$/, /^templates(?:\/[a-z0-9-]+)?$/,
    new RegExp(`^projects/${UUID}/(?:drafts|jobs)$`),
    new RegExp(`^projects/${UUID}/(?:assets|drafts|jobs)/${UUID}$`),
    new RegExp(`^projects/${UUID}/jobs/by-request/${UUID}$`)],
  POST: [/^capabilities\/refresh$/,
    new RegExp(`^projects/${UUID}/(?:inputs|drafts|jobs)$`),
    new RegExp(`^projects/${UUID}/jobs/${UUID}/cancel$`)],
  PUT: [new RegExp(`^projects/${UUID}/drafts/${UUID}$`)],
  DELETE: [new RegExp(`^projects/${UUID}/drafts/${UUID}$`)],
};
const PROXY_OPTIONS = { streaming: true,
  forwardHeaders: ['If-None-Match', 'Range', 'If-Range'],
  responseHeaderAllowlist: ['Content-Type', 'Content-Length', 'ETag',
    'Cache-Control', 'Retry-After', 'Accept-Ranges', 'Content-Range',
    'Last-Modified'] };

/** Allow only public effects routes; internal drain is never reachable. */
async function proxy(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const segments = params.path;
  const suffix = Array.isArray(segments) ? segments.join('/') : '';
  if (!RULES[request.method]?.some(pattern => pattern.test(suffix))) {
    return Response.json({ success: false, message: 'Effects route not found',
      data: null, error_code: 'EFFECT_NOT_FOUND', error_details: null },
    { status: 404 });
  }
  const method = request.method.toLowerCase();
  const handler = method === 'delete' ? backendProxy.del
    : backendProxy[method as 'get' | 'post' | 'put'];
  const response = await handler(request, `/api/effects/${suffix}`,
    context, PROXY_OPTIONS);
  if (response.status >= 400
    && !response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    return Response.json({ success: false,
      message: `Backend returned ${response.status}`, data: null,
      error_code: 'BACKEND_ERROR', error_details: null },
    { status: response.status });
  }
  return response;
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
