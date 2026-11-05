import type { ToolContext } from '../types';

/**
 * Construct an absolute URL for internal API calls from the server-side agent context.
 * Uses `context.apiBaseUrl` which is the loopback URL for the local Next.js
 * process (see `src/app/api/video-editing-agent/chat/route.ts` →
 * `resolveAgentLoopbackUrl`). Loopback is used — not the incoming request
 * origin — so tool fetches don't hairpin through public nginx/HTTPS, which
 * was the root cause of the 2026-04-07 `fetch failed` production incident.
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

  // Build the abort signal: always include a timeout signal, combine with
  // any caller-provided signal AND the route-wide context.abortSignal so any
  // of {caller signal, per-request timeout, route-wide abort} can short-
  // circuit the fetch. AbortSignal.any is feature-detected — on older Node
  // (< 19) we fall back to relaying manually via a fresh AbortController so
  // a cancel from any input still aborts the underlying fetch.
  const timeoutSignal = AbortSignal.timeout(timeout);
  const signals: AbortSignal[] = [timeoutSignal];
  if (callerSignal) signals.push(callerSignal);
  if (context.abortSignal) signals.push(context.abortSignal);
  const hasAbortSignalAny = typeof AbortSignal !== 'undefined' && 'any' in AbortSignal;
  let signal: AbortSignal;
  if (signals.length === 1) {
    signal = signals[0];
  } else if (hasAbortSignalAny) {
    signal = (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any(signals);
  } else {
    const relay = new AbortController();
    for (const s of signals) {
      if (s.aborted) {
        relay.abort();
        break;
      }
      s.addEventListener('abort', () => relay.abort(), { once: true });
    }
    signal = relay.signal;
  }

  // Merge headers — ensure Content-Type defaults to application/json but
  // callers can override by passing their own Content-Type. Normalise the
  // three HeadersInit shapes (Headers / array / record / undefined) into a
  // plain object before spreading so the auth-injection step below can do
  // simple key lookups. Parens around the ternary make the `?? {}` apply to
  // the whole conditional, not just its last branch.
  const normalizedCallerHeaders: Record<string, string> =
    (callerHeaders instanceof Headers
      ? Object.fromEntries(callerHeaders.entries())
      : Array.isArray(callerHeaders)
        ? Object.fromEntries(callerHeaders)
        : (callerHeaders as Record<string, string> | undefined)) ?? {};

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...normalizedCallerHeaders,
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

/** 固定的服务端能力；未生效的模型参数不得创建新的探测名额。 */
export const GENERATION_CAPABILITIES = {
  video: 'ark:contents/generations/tasks:doubao-seedance-1-5-pro-251215',
  image: 'ark:images/generations:doubao-seedream-5-0-260128',
} as const;

type RecoveryContext = ToolContext & {
  recoveryScope?: string;
  generationConfigRevision?: string;
  recoveryReset?: boolean;
};
export interface CapabilityFailureRecord {
  capability: string;
  scope: string;
  revision: string;
  expiresAt: number;
  failure: GenerationFailure;
}
export interface GenerationFailure {
  success: false;
  error_code: string;
  error: string;
  failureClass: string;
  next_step: string;
  error_details: Record<string, unknown>;
  capability_failure?: CapabilityFailureRecord;
}
const failures = new WeakMap<ToolContext, Map<string, CapabilityFailureRecord>>();
const pending = new WeakMap<ToolContext, Set<string>>();
const FAILURE_TTL_MS = 10 * 60_000;
const FAILURE_CLASSES = new Set([
  'configuration', 'validation', 'user_input', 'policy', 'cancelled',
  'transient', 'internal', 'blocked',
]);
const GENERATION_ERROR_CODES = new Set([
  'provider_unavailable', 'credential_not_configured', 'provider_authentication',
  'provider_rate_limited', 'provider_validation', 'provider_error',
  'generation_submission_unknown', 'invalid_response', 'cancelled',
]);

/** 只接受同任务、同配置且未过期的已执行工具事实，不重放操作。 */
export function restoreCapabilityFailures(
  context: RecoveryContext, values: unknown[],
): void {
  if (!context.recoveryScope || context.recoveryReset) return;
  const records = new Map<string, CapabilityFailureRecord>();
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const record = item.capability_failure as CapabilityFailureRecord | undefined;
    if (record?.scope === context.recoveryScope &&
        record.revision === (context.generationConfigRevision ?? '') &&
        record.expiresAt > Date.now() &&
        Object.values(GENERATION_CAPABILITIES).includes(record.capability as never) &&
        record.failure?.success === false) records.set(record.capability, record);
    const cleared = item.capability_recovery as Record<string, unknown> | undefined;
    if (cleared?.scope === context.recoveryScope &&
        cleared.revision === (context.generationConfigRevision ?? '')) {
      records.delete(String(cleared.capability));
    }
  }
  failures.set(context, records);
}

export function generationFailure(
  code: string, failureClass: string, details: Record<string, unknown> = {},
): GenerationFailure {
  return {
    success: false, error_code: code, error: code, failureClass,
    next_step: code === 'cancelled' ? '本轮已取消；停止执行。'
      : code === 'capability_probe_pending' ? '等待当前能力探测完成后再提交下一镜头。'
        : failureClass === 'validation' ? '修正请求参数后再调用。'
          : '停止此生成分支；使用现有素材或独立能力。确认配置或受理状态后由用户明确重试。',
    error_details: { failure_class: failureClass, retryable: false,
      sticky: failureClass !== 'validation', ...details },
  };
}

/** 首次探测在任何 await 前占位；成功后的不同镜头仍可逐次提交。 */
export function acquireGeneration(context: RecoveryContext, key: string) {
  if (context.abortSignal?.aborted) return generationFailure('cancelled', 'cancelled');
  const record = failures.get(context)?.get(key);
  if (record && record.expiresAt > Date.now() &&
      record.revision === (context.generationConfigRevision ?? '')) {
    return { ...record.failure, capability_failure: record };
  }
  const active = pending.get(context) ?? new Set<string>();
  if (active.has(key)) return generationFailure('capability_probe_pending', 'blocked');
  active.add(key);
  pending.set(context, active);
  return null;
}

export function finishGeneration(
  context: RecoveryContext, key: string, failure?: GenerationFailure,
) {
  pending.get(context)?.delete(key);
  if (!failure) {
    failures.get(context)?.delete(key);
    return { capability_recovery: { capability: key, scope: context.recoveryScope ?? '',
      revision: context.generationConfigRevision ?? '' } };
  }
  if (['validation', 'user_input', 'cancelled'].includes(failure.failureClass)) return failure;
  const retryAfter = Number(failure.error_details.retry_after_seconds ?? 0);
  const retryDelayMs = Number.isFinite(retryAfter)
    ? Math.max(0, retryAfter) * 1000 : 0;
  const record: CapabilityFailureRecord = {
    capability: key, scope: context.recoveryScope ?? '',
    revision: context.generationConfigRevision ?? '',
    // A cache expiry must not shorten the provider's requested wait.
    expiresAt: Date.now() + Math.max(FAILURE_TTL_MS, retryDelayMs), failure,
  };
  const records = failures.get(context) ?? new Map();
  records.set(key, record);
  failures.set(context, records);
  return { ...failure, capability_failure: record };
}

/** 不把供应商正文/HTML、凭据或带签名的 URL 写入历史。 */
export function parseGenerationFailure(status: number, value: unknown): GenerationFailure {
  const body = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const raw = (body.error_details && typeof body.error_details === 'object'
    ? body.error_details : {}) as Record<string, unknown>;
  const suppliedCode = String(body.error_code ?? '');
  const code = GENERATION_ERROR_CODES.has(suppliedCode) ? suppliedCode
    : status === 429 ? 'provider_rate_limited'
      : status === 401 || status === 403 ? 'provider_authentication'
        : status === 400 || status === 422 ? 'provider_validation' : 'provider_error';
  const inferred = code === 'provider_validation' ? 'validation'
    : ['provider_unavailable', 'provider_authentication', 'credential_not_configured'].includes(code)
      ? 'configuration' : 'transient';
  const failureClass = FAILURE_CLASSES.has(String(raw.failure_class))
    ? String(raw.failure_class) : inferred;
  const details: Record<string, unknown> = { local_status: status };
  for (const name of ['upstream_status', 'proxy_status', 'retry_after_seconds']) {
    if (typeof raw[name] === 'number' && Number.isFinite(raw[name])) details[name] = raw[name];
  }
  for (const name of ['request_id', 'provider_request_id']) {
    if (typeof raw[name] === 'string' && /^[\w.-]{1,128}$/.test(raw[name])) details[name] = raw[name];
  }
  return generationFailure(code, failureClass, details);
}
