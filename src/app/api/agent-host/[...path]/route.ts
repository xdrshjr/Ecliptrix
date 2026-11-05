import type { NextRequest } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import {
  researchOriginAllowed,
  researchProxyError,
} from '@/lib/server/researchUiOrigin';

/**
 * `/api/agent-host/*` 白名单代理（本机 shell / 文件 / 通用联网）。
 *
 * 设计基线：docs/plans/agent-general-assistant/spec.md §6「BFF 契约」。
 * 模板是 `app/api/agent-toolkit/[...path]/route.ts`（同族里最完整的一份），
 * **不是** web-research 那份：那份没有分路由超时，也不转发写请求的 Origin。
 *
 * 这是**白名单**，不是通配代理：方法 × 路径逐条登记，未登记组合直接 404。
 */

const FS_PATHS = 'fs/(read|write|edit|list|glob|grep)';
const EGRESS_PATHS = 'egress/(request|download|diagnose)';
const ROUTES: Record<string, RegExp> = {
  GET: /^(capabilities|audit)$/,
  POST: new RegExp(`^(shell/run|${FS_PATHS}|${EGRESS_PATHS})$`),
};

/** 查询白名单必须含 `limit`（`GET /audit` 需要），否则静默丢参。 */
const QUERY_WHITELIST = ['limit', 'project_id'];
/** 显式登记转发头；Cookie / Authorization 永不转发（本应用无凭据）。 */
const FORWARDED_HEADERS = [
  'origin',
  'x-tool-call-id',
  'accept-language',
  'content-type',
];

/** JSON 体上限：2 MiB + 8 KiB —— `fs/write` 的内容本身可达 2 MiB。 */
const JSON_BODY_LIMIT = 2 * 1024 * 1024 + 8 * 1024;
/** JSON 响应体上限：超出者应改走 `egress/download`（`download_url` 工具）。 */
const JSON_RESPONSE_LIMIT = 8 * 1024 * 1024;

const SHELL_DEFAULT_TIMEOUT_MS = 120_000;
/** `shell_timeout_s` 的硬上限；越界是参数错误，不是截断（见 shellTimeout）。 */
const SHELL_MAX_TIMEOUT_MS = 600_000;
/** 给后端「terminate → 5 s 后强杀整棵进程树」留的余量。 */
const SHELL_TIMEOUT_HEADROOM_MS = 5_000;
const SHELL_PROXY_TIMEOUT_CAP_MS =
  SHELL_MAX_TIMEOUT_MS + SHELL_TIMEOUT_HEADROOM_MS;
/** `kind=media` 后端预算 180 s + 余量。 */
const DOWNLOAD_TIMEOUT_MS = 190_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
};

interface Context {
  params: Promise<{ path: string[] }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 路径白名单：段级拒绝 `/ . % \`（含编码后的 `%2e%2e`）。 */
function isRegistered(segments: string[], method: string): boolean {
  if (segments.some(part => /[.%\\]/.test(part))) return false;
  return ROUTES[method]?.test(segments.join('/')) ?? false;
}

/** 逐块读 JSON 体并在上限处真正中断（不能只信 `content-length`）。 */
async function readJsonBody(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > JSON_BODY_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function filteredQuery(request: NextRequest): string {
  const query = new URL(request.url).searchParams;
  const filtered = new URLSearchParams();
  for (const key of QUERY_WHITELIST) {
    if (query.has(key)) filtered.set(key, query.get(key) as string);
  }
  return filtered.size ? `?${filtered}` : '';
}

/**
 * `/shell/run` 的代理超时 = `timeout_ms`（缺省 120 s）+ 5 s。
 *
 * 越界返回 `null`（调用方判 400 `invalid_argument`），**绝不静默截断**：
 * 截断会让 600 s 的命令在 BFF 侧先断，用户看到的是「命令超时」而不是
 * 「参数超限」（spec §6 超时行 / AC-G18）。坏 JSON 交给后端回 400，
 * 这里用默认值兜住超时即可。
 */
function shellTimeout(body: string | undefined): number | null {
  const fallback = SHELL_DEFAULT_TIMEOUT_MS + SHELL_TIMEOUT_HEADROOM_MS;
  if (!body) return fallback;
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return fallback;
  }
  const value = isRecord(payload) ? payload.timeout_ms : undefined;
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0 || value > SHELL_MAX_TIMEOUT_MS) return null;
  return Math.min(value + SHELL_TIMEOUT_HEADROOM_MS,
    SHELL_PROXY_TIMEOUT_CAP_MS);
}

/** 按路由定超时：shell 走请求体预算，下载 190 s，其余 30 s。 */
function routeTimeoutMs(relative: string, body: string | undefined) {
  if (relative === 'shell/run') return shellTimeout(body);
  if (relative === 'egress/download') return DOWNLOAD_TIMEOUT_MS;
  return DEFAULT_TIMEOUT_MS;
}

/** 204/304 不能带响应体，否则 `new Response(bytes, …)` 直接抛 TypeError。 */
function bodyAllowed(status: number): boolean {
  return status !== 204 && status !== 304;
}

/**
 * 上游响应体先缓冲再量长度。
 *
 * `egress_max_bytes` 是后端的承诺，BFF 只做最后一道闸：超过 8 MiB 说明
 * 这个调用选错了入口，提示调用方改用 `download_url`（`egress/download`）。
 */
async function bufferedResponse(upstream: Response): Promise<Response> {
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > JSON_RESPONSE_LIMIT) {
    return researchProxyError('response_too_large', 502);
  }
  return new Response(bodyAllowed(upstream.status) ? bytes : null, {
    status: upstream.status,
    headers: RESPONSE_HEADERS,
  });
}

/**
 * 超时与网络故障必须可区分：都报 502 会让用户看到「出口不可用」，
 * 而实际只是上游慢（spec §6 错误行）。
 */
function transportError(error: unknown): Response {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return researchProxyError('upstream_timeout', 504);
  }
  return researchProxyError('upstream_unavailable', 502);
}

/**
 * 写请求的两道额外闸门。
 *
 * 后端 `validate_ui_origin` 要求写请求带 `Origin`，不转发就是 403；非 JSON
 * 则给出可诊断的 415 而不是笼统的 403（同 agent-toolkit §4.1 的教训）。
 *
 * @returns 需要短路时是错误响应；放行时是 `null`
 */
function writeGate(request: NextRequest): Response | null {
  if (!request.headers.get('origin')) {
    return researchProxyError('origin_forbidden', 403);
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return researchProxyError('json_required', 415);
  }
  return null;
}

async function proxy(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const relative = path.join('/');
  const method = request.method;
  if (!isRegistered(path, method)) {
    return researchProxyError('not_found', 404);
  }
  // Origin 统一按 `write=false` 判，写方法的两条额外要求由 writeGate 补。
  if (!researchOriginAllowed(request, false)) {
    return researchProxyError('origin_forbidden', 403);
  }
  const isWrite = method === 'POST';
  const gate = isWrite ? writeGate(request) : null;
  if (gate) return gate;
  let body: string | undefined;
  if (isWrite) {
    const read = await readJsonBody(request);
    if (read === null) return researchProxyError('request_too_large', 413);
    body = read;
  }
  const timeoutMs = routeTimeoutMs(relative, body);
  if (timeoutMs === null) {
    return researchProxyError('invalid_argument', 400);
  }

  const target = backendConfig.joinPath(`/api/agent-host/${relative}`)
    + filteredQuery(request);
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(timeoutMs),
  ]);
  try {
    const upstream = await fetch(target, {
      method,
      headers: forwardedHeaders(request),
      body,
      signal,
      cache: 'no-store',
    });
    return await bufferedResponse(upstream);
  } catch (error) {
    return transportError(error);
  }
}

export const GET = proxy;
export const POST = proxy;
