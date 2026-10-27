import type { NextRequest } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { researchOriginAllowed, researchProxyError } from '@/lib/server/researchUiOrigin';

/**
 * `/api/agent-skills/*` 白名单代理。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §5.1。
 *
 * 与 agent-toolkit 同构：方法 × 路径逐条登记，未登记组合一律 404。空路径
 * （管理列表 / 创建）不会命中本文件的 catch-all，由同级的 `route.ts` 转入。
 * 不转发查询串：本域没有任何查询参数。
 */

const SKILL_ID = '[a-z][a-z0-9-]{2,39}';
const ROUTES: Record<string, RegExp> = {
  GET: new RegExp(`^(index|${SKILL_ID})?$`),
  POST: new RegExp(`^(validate|${SKILL_ID}/(enabled|duplicate))?$`),
  PUT: new RegExp(`^${SKILL_ID}$`),
  DELETE: new RegExp(`^${SKILL_ID}$`),
};

/** JSON 体上限：SKILL.md ≤ 64 KiB，留一倍给转义与信封。 */
const JSON_BODY_LIMIT = 128 * 1024;
const FORWARDED_HEADERS = ['x-tool-call-id', 'origin', 'accept-language'];
const UPSTREAM_TIMEOUT_MS = 15_000;

interface Context { params: Promise<{ path: string[] }> }

/** 带体的方法才读请求体并强制 JSON；DELETE 与 GET 都没有体。 */
const BODY_METHODS = new Set(['POST', 'PUT']);

async function readJsonBody(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > JSON_BODY_LIMIT) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

function forwardedHeaders(request: Request, contentType: string | null): Headers {
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // 明确不转发 Cookie / Authorization：本应用无凭据。
  return headers;
}

/**
 * Origin 与 Content-Type 的判定顺序（对齐 agent-toolkit 与 spec R-10）：
 * `researchOriginAllowed(request, true)` 会把「必须有 Origin」和「必须是 JSON」
 * 合并成一个 false，缺 JSON 头会被误报成 403。这里统一用 `write=false` 做
 * 白名单与跨站判定，再分别补两条写方法要求，使 415 与 403 可区分。
 */
function guardRequest(request: NextRequest, method: string): Response | null {
  if (!researchOriginAllowed(request, false)) {
    return researchProxyError('origin_forbidden', 403);
  }
  if (method !== 'GET' && !request.headers.get('origin')) {
    return researchProxyError('origin_forbidden', 403);
  }
  const contentType = request.headers.get('content-type');
  if (BODY_METHODS.has(method) && !contentType?.startsWith('application/json')) {
    return researchProxyError('json_required', 415);
  }
  return null;
}

async function forward(request: NextRequest, method: string, relative: string) {
  const target = backendConfig.joinPath(
    relative ? `/api/agent-skills/${relative}` : '/api/agent-skills');
  const headers = forwardedHeaders(request, request.headers.get('content-type'));
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
  let body: string | undefined;
  if (BODY_METHODS.has(method)) {
    const read = await readJsonBody(request);
    if (read === null) return researchProxyError('request_too_large', 413);
    body = read;
  }
  const upstream = await fetch(target, { method, headers, body, signal, cache: 'no-store' });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Type': 'application/json',
    },
  });
}

async function proxy(request: NextRequest, context: Context): Promise<Response> {
  const { path } = await context.params;
  const relative = path.join('/');
  const method = request.method;
  if (path.some(part => /[.%\\]/.test(part)) || !ROUTES[method]?.test(relative)) {
    return researchProxyError('not_found', 404);
  }
  const rejected = guardRequest(request, method);
  if (rejected) return rejected;
  try {
    return await forward(request, method, relative);
  } catch (error) {
    // 超时与网络故障必须可区分，否则用户会把「上游慢」看成「技能库坏了」。
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return researchProxyError('upstream_timeout', 504);
    }
    return researchProxyError('storage_unavailable', 502);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
