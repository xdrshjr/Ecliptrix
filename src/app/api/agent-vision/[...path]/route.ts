import type { NextRequest } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { researchOriginAllowed, researchProxyError } from '@/lib/server/researchUiOrigin';

/**
 * `/api/agent-vision/*` 白名单代理。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §5.5。
 *
 * 与 `/api/agent-toolkit/*` 同构：**白名单**而非通配代理，方法 × 路径逐条
 * 登记，未登记组合直接 404；不转发 Cookie / Authorization（本应用无凭据）。
 * 差别只有三处：
 *   1. 没有 multipart 端点，全部是 JSON（上限按端点分档）；
 *   2. 视觉调用要读图 + 等 VL 模型，超时分 90s / 20s 两档；
 *   3. `GET /observations/{id}` 的 id 只能是一段，不能让路径穿越。
 */

const ROUTES: Record<string, RegExp> = {
  GET: /^(capabilities|usage|observations\/[^/]+)$/,
  POST: /^(describe|frames|export-inspect|cache\/clear)$/,
};

const QUERY_WHITELIST = ['project_id', 'offset', 'max_bytes'];
const FORWARDED_HEADERS = ['x-tool-call-id', 'origin', 'accept-language'];
/** 视觉调用的三个端点：一次要读 ≤6 张图并等模型回答。 */
const VISION_ROUTES = new Set(['describe', 'frames', 'export-inspect']);
const VISION_TIMEOUT = 90_000;
const DEFAULT_TIMEOUT = 20_000;
const KiB = 1024;
const BODY_LIMITS: Record<string, number> = {
  describe: 64 * KiB,
  frames: 64 * KiB,
  'export-inspect': 8 * KiB,
  'cache/clear': 8 * KiB,
};

interface Context { params: Promise<{ path: string[] }> }

/**
 * 读 JSON 体并按端点上限截断。
 *
 * 读的是字节而不是 `content-length`：chunked 请求没有该头，只看头等于没有
 * 上限（与 toolkit BFF 同一条纪律）。
 */
async function readJsonBody(
  request: Request, limit: number,
): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

function forwardedHeaders(request: Request, contentType: string | null) {
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // 明确不转发 Cookie / Authorization：本应用没有凭据可转发。
  return headers;
}

function filteredQuery(request: NextRequest): string {
  const query = new URL(request.url).searchParams;
  const filtered = new URLSearchParams();
  for (const key of QUERY_WHITELIST) {
    if (query.has(key)) filtered.set(key, query.get(key)!);
  }
  return filtered.size ? `?${filtered}` : '';
}

function responseHeaders() {
  return new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
}

function errorStatus(error: unknown): Response {
  // DOMException（`AbortSignal.timeout` 的产物）不是 Error 的子类，按名字读才
  // 不会把超时误判成"视觉不可用"。
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '') : '';
  // 超时与网络故障必须可区分：都报 502 会让用户看到「视觉不可用」而实际上
  // 只是这次调用太慢（§4.12 的超时行）。
  if (name === 'TimeoutError' || name === 'AbortError') {
    return researchProxyError('upstream_timeout', 504);
  }
  /**
   * 后端不可达 ≠ 没配视觉模型。若这里报 `vision_unavailable`，工具会把
   * 「去设置里绑一个视觉模型」当成下一步，等于把一次网络故障升级成"能力
   * 缺失"（§4.12）。`model_failed` 是同一闭集里的"这次调用失败，可重试"。
   */
  return researchProxyError('model_failed', 502);
}

async function proxy(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const relative = path.join('/');
  const method = request.method;
  if (path.some(part => /[.%\\]/.test(part)) || !ROUTES[method]?.test(relative)) {
    return researchProxyError('not_found', 404);
  }
  const isWrite = method !== 'GET';
  const contentType = request.headers.get('content-type');
  /**
   * Origin 判定走 `write=false`，写方法的两条额外要求由下面补：合并成一个
   * `write=true` 会把「必须带 Origin」和「必须是 JSON」折成同一个 false，
   * 于是非 JSON 的写会得到 403 而不是可诊断的 415（与 toolkit BFF 同形问题）。
   */
  if (!researchOriginAllowed(request, false)) {
    return researchProxyError('origin_forbidden', 403);
  }
  if (isWrite && !request.headers.get('origin')) {
    return researchProxyError('origin_forbidden', 403);
  }
  if (isWrite && !contentType?.startsWith('application/json')) {
    return researchProxyError('json_required', 415);
  }

  const target = backendConfig.joinPath(`/api/agent-vision/${relative}`)
    + filteredQuery(request);
  const headers = forwardedHeaders(request, contentType);
  const timeout = VISION_ROUTES.has(relative) ? VISION_TIMEOUT : DEFAULT_TIMEOUT;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);

  try {
    let body: string | undefined;
    if (isWrite) {
      const read = await readJsonBody(request, BODY_LIMITS[relative] ?? 8 * KiB);
      if (read === null) return researchProxyError('request_too_large', 413);
      body = read;
    }
    const upstream = await fetch(target, {
      method, headers, body, signal, cache: 'no-store',
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(),
    });
  } catch (error) {
    return errorStatus(error);
  }
}

export const GET = proxy;
export const POST = proxy;
