import type { NextRequest } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { researchOriginAllowed, researchProxyError } from '@/lib/server/researchUiOrigin';

/**
 * `/api/agent-toolkit/*` 白名单代理。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §4.4。
 *
 * 这是**白名单**，不是通配代理：方法 × 路径逐条登记，任何未登记组合直接 404。
 * `documents/upload` 是唯一的 multipart 端点，走流式直通 + 按实际字节计数限流
 * （不能只信 `content-length`：chunked 请求没有该头）。
 */

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ROUTES: Record<string, RegExp> = {
  GET: /^(capabilities|usage|workspace\/(list|read|download)|documents|documents\/read|memory|memory\/search|memory\/digest)$/,
  POST: /^(workspace\/(write|import)|documents\/upload|analysis\/run|memory)$/,
  DELETE: new RegExp(`^(workspace/file|documents/${UUID}|memory/${UUID}|memory)$`),
};

const QUERY_WHITELIST = [
  'project_id', 'name', 'prefix', 'limit', 'offset', 'max_bytes', 'page',
  'max_chars', 'document_id', 'q', 'scope',
];

/** JSON 体上限：2 MiB + 8 KiB 余量。 */
const JSON_BODY_LIMIT = 2 * 1024 * 1024 + 8 * 1024;
/** multipart 上限：按实际字节计数，与 `content-length` 无关。 */
const UPLOAD_BYTE_LIMIT = 128 * 1024 * 1024;
const FORWARDED_HEADERS = ['x-tool-call-id', 'origin', 'accept-language'];
const DOWNLOAD_PATH = 'workspace/download';

interface Context { params: Promise<{ path: string[] }> }

async function readJsonBody(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
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

/**
 * multipart 流式直通：边转发边计数，超限立即中断并 413。
 *
 * 为什么不直接 `body: request.body`：需要在上限处真正终止上游请求，否则
 * 「先整包读完再判断」会把 128 MiB 放进内存，而「只看 content-length」在
 * chunked 请求上等于没有上限（spec R-21）。
 */
function streamWithCap(source: ReadableStream<Uint8Array>, limit: number) {
  let seen = 0;
  let aborted = false;
  return {
    stream: source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          aborted = true;
          controller.error(new Error('request_too_large'));
          return;
        }
        controller.enqueue(chunk);
      },
    })),
    exceeded: () => aborted,
  };
}

function forwardedHeaders(request: Request, contentType: string | null) {
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // 明确不转发 Cookie / Authorization：本应用无凭据。
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

function responseHeaders(relative: string, upstream: Response) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  if (relative === DOWNLOAD_PATH) {
    const type = upstream.headers.get('content-type');
    const disposition = upstream.headers.get('content-disposition');
    if (type) headers.set('Content-Type', type);
    if (disposition) headers.set('Content-Disposition', disposition);
  } else {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

async function proxy(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const relative = path.join('/');
  const method = request.method;
  if (path.some(part => /[.%\\]/.test(part)) || !ROUTES[method]?.test(relative)) {
    return researchProxyError('not_found', 404);
  }
  const isUpload = method === 'POST' && relative === 'documents/upload';
  const isWrite = method !== 'GET';
  const contentType = request.headers.get('content-type');
  /**
   * Origin 判定统一走 `write=false`，写方法的两条额外要求由这里补。
   *
   * 为什么不直接 `researchOriginAllowed(request, write=true)`：该分支把
   * 「必须带 Origin」**和**「必须是 application/json」合并成一个 false，
   * 于是 (a) multipart 的 `documents/upload` 永远 403，(b) 非 JSON 的写请求
   * 得到 403 而不是可诊断的 415。这是 §4.1 R-01 在 BFF 层的同形问题。
   */
  if (!researchOriginAllowed(request, false)) {
    return researchProxyError('origin_forbidden', 403);
  }
  if (isWrite && !request.headers.get('origin')) {
    return researchProxyError('origin_forbidden', 403);
  }
  if (isUpload) {
    if (!contentType?.startsWith('multipart/form-data')) {
      return researchProxyError('json_required', 415);
    }
  } else if (isWrite && method !== 'DELETE'
    && !contentType?.startsWith('application/json')) {
    // DELETE 没有请求体，浏览器不会给它带 content-type（§4.1.1 矩阵的
    // 「JSON 断言 = 否（无请求体）」）。只对带体的 POST 要求 JSON。
    return researchProxyError('json_required', 415);
  }

  const target = backendConfig.joinPath(`/api/agent-toolkit/${relative}`)
    + filteredQuery(request);
  const headers = forwardedHeaders(request, contentType);
  const timeout = isUpload || relative === 'analysis/run' ? 120_000 : 30_000;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);

  try {
    if (isUpload && request.body) {
      const capped = streamWithCap(request.body, UPLOAD_BYTE_LIMIT);
      const upstream = await fetch(target, {
        method, headers, signal,
        // Node/undici 传流式请求体必须带 duplex:'half'，否则直接抛 TypeError。
        body: capped.stream,
        duplex: 'half',
        cache: 'no-store',
      } as RequestInit & { duplex: 'half' });
      if (capped.exceeded()) return researchProxyError('request_too_large', 413);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders(relative, upstream),
      });
    }
    let body: string | undefined;
    if (isWrite) {
      const read = await readJsonBody(request);
      if (read === null) return researchProxyError('request_too_large', 413);
      body = read;
    }
    const upstream = await fetch(target, {
      method, headers, body, signal, cache: 'no-store',
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(relative, upstream),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'request_too_large') {
      return researchProxyError('request_too_large', 413);
    }
    // 超时与网络故障必须可区分：都报 storage_unavailable 会让用户看到
    // 「工作区不可用」而实际上是上游慢（§4.4 的错误表里有 upstream_timeout）。
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return researchProxyError('upstream_timeout', 504);
    }
    return researchProxyError('storage_unavailable', 502);
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
