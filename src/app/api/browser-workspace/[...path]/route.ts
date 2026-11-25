import type { NextRequest } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { researchOriginAllowed, researchProxyError } from '@/lib/server/researchUiOrigin';

/**
 * BFF for the browser workspace UI endpoints (spec §4.3.4 / §5.3).
 *
 * Deliberately a CLOSED whitelist, mirroring web-research/[...path]: the only
 * things the renderer may ask the backend are the diagnostics read and the
 * right-click "save to media library" write. Navigation, tabs, profiles and
 * consent never come through here — they are IPC to the main process. Nothing
 * here forwards a token: the control-service token lives only in the backend's
 * environment.
 */

const ROUTES: Record<string, RegExp> = {
  GET: /^state$/,
  POST: /^resources\/save$/,
};
const MAX_BODY_BYTES = 65536;

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
    if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
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
  if (path.some((segment) => /[.%\\]/.test(segment)) || !ROUTES[method]?.test(relative)) {
    return researchProxyError('not_found', 404);
  }
  const isWrite = method === 'POST';
  if (!researchOriginAllowed(request, isWrite)) return researchProxyError('origin_forbidden', 403);
  const body = isWrite ? await readBody(request) : undefined;
  if (body === null) return researchProxyError('request_too_large', 413);
  if (isWrite && !request.headers.get('content-type')?.startsWith('application/json')) {
    return researchProxyError('json_required', 415);
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const name of ['Origin', 'Accept-Language']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(backendConfig.joinPath(`/api/browser-workspace/${relative}`), {
      method, headers, body,
      // Saving fetches bytes through the tab session and validates them: allow a slow CDN.
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(90000)]),
      cache: 'no-store',
    });
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
    } });
  } catch {
    return researchProxyError('browser_workspace_unavailable', 502);
  }
}

export const GET = proxy;
export const POST = proxy;
