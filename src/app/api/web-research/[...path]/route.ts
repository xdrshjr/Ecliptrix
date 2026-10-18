import type { NextRequest } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { researchOriginAllowed, researchProxyError } from '@/lib/server/researchUiOrigin';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ROUTES: Record<string, RegExp> = {
  GET: new RegExp(`^(capabilities|artifacts/${UUID}(/image)?)$`),
  POST: /^(search|fetch|extract-images|download|research|browser\/(open|read|act)|test-connection)$/,
  PUT: /^credentials$/,
  DELETE: new RegExp(`^browser/${UUID}$`),
};
interface Context { params: Promise<{ path: string[] }> }

async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

async function proxy(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const relative = path.join('/');
  const method = request.method;
  if (path.some(p => /[.%\\]/.test(p)) || !ROUTES[method]?.test(relative)) {
    return researchProxyError('not_found', 404);
  }
  const uiWrite = ['credentials', 'test-connection'].includes(relative);
  if (!researchOriginAllowed(request, uiWrite)) return researchProxyError('origin_forbidden', 403);
  const body = ['POST', 'PUT'].includes(method) ? await readBody(request) : undefined;
  if (body === null) return researchProxyError('request_too_large', 413);
  if (body !== undefined && !request.headers.get('content-type')?.startsWith('application/json')) {
    return researchProxyError('json_required', 415);
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const name of uiWrite ? ['Origin']
    : ['X-Research-Run', 'X-Research-Token', 'X-Tool-Call-Id', 'Accept-Language']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const query = new URL(request.url).searchParams;
  const filtered = new URLSearchParams();
  for (const key of ['offset', 'max_bytes', 'project_id']) {
    if (query.has(key)) filtered.set(key, query.get(key)!);
  }
  try {
    const response = await fetch(backendConfig.joinPath(`/api/web-research/${relative}`) +
      (filtered.size ? `?${filtered}` : ''), { method, headers, body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(190000)]), cache: 'no-store' });
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': relative.endsWith('/image') && response.ok ? 'image/png' : 'application/json',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    } });
  } catch { return researchProxyError('research_unavailable', 502); }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
