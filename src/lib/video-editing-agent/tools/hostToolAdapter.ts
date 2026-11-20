import type { MaterialItem } from '@/types';
import type { ResearchMaterial } from '@/types/webResearch';
import type { ToolContext } from '../types';
import { utf8Slice } from '../modelContextBudget';
import { toolFetch } from './apiHelper';
import { localMaterial, RESULT_BYTE_CAP, toolResult } from './webToolAdapter';

/**
 * 本机能力（`/shell/*`、`/fs/*`）与 tier-2 通用出口（`/egress/*`）的薄适配层。
 *
 * 设计基线：docs/plans/agent-general-assistant/spec.md §4.3 / §4.7 / §6。
 *
 * 与 `webToolAdapter` 同构（一次 HTTP 调用、最多一个编辑操作、不做事后补发），
 * 但**故意不读** `context.researchRun`：这里没有 run 生命周期，所以结构上
 * 不可能出现 `run_closed`——一次失败只失败这一次（AC-G07 / §1.2）。
 *
 * 结果裁剪、`toolResult` 与素材正则全部复用 `webToolAdapter`，不复制第二份。
 */

/** tier-2 出口的每回合默认上限（设置项 `egress_max_per_turn`，§4.9）。 */
export const DEFAULT_EGRESS_MAX_PER_TURN = 60;

/** `bash` 的前端超时余量：后端超时之后再留 5 s 收尾（§6 映射表）。 */
export const SHELL_TIMEOUT_MARGIN_MS = 5_000;

/** `/fs/*`、`http_request`、`diagnose_url` 的前端超时（§6 映射表）。 */
export const HOST_CALL_TIMEOUT_MS = 15_000;
export const EGRESS_REQUEST_TIMEOUT_MS = 30_000;
export const EGRESS_DIAGNOSE_TIMEOUT_MS = 10_000;
/** `download_url`：后端下载上限 185 s + 5 s（§6）。 */
export const EGRESS_DOWNLOAD_TIMEOUT_MS = 190_000;

/**
 * 一次 `agent-host` 调用。
 *
 * `timeout` 由工具侧按 §6 的映射表给出（`bash` 是 `timeout_ms + 5 s`），
 * 适配器不猜。
 */
export interface HostCall {
  /** 形如 `/shell/run`、`/fs/read`、`/egress/download`。 */
  path: string;
  signal?: AbortSignal;
  body?: unknown;
  /** 前端超时（ms）。 */
  timeout?: number;
  /** tier-2 出口调用：计入每回合预算（AC-G22a）。 */
  egress?: boolean;
  /** `download_url` 专用：把 `{status:'ready', material}` 发布成入库操作。 */
  importMaterial?: boolean;
  /** 合并进成功结果的字段（如点对点的 `next_step`）。 */
  successFields?: Record<string, unknown>;
}

interface HostEnvelope {
  success?: boolean;
  data?: unknown;
  message?: string;
  error_code?: string;
  error_details?: Record<string, unknown>;
}

/** 错误码 → 可执行的下一步；模型看到 next_step 才不会原地重试同一个调用。 */
const NEXT_STEPS: Record<string, string> = {
  cancelled: 'The turn was cancelled; do nothing.',
  timeout: 'Retry once with a longer timeout or a smaller request.',
  network_error:
    'The local service did not answer; retry once, then report it.',
  upstream_timeout:
    'Retry once with a longer timeout_ms or a narrower command.',
  internal_error:
    'Report the limitation to the user; do not retry the same call.',
  shell_disabled: 'Ask the user to enable Shell in Settings → Agent host.',
  shell_busy: 'Wait for the running command to finish, then retry once.',
  shell_spawn_failed:
    'Report it; the operating system or antivirus refused to spawn.',
  path_forbidden:
    'Use a path inside the allowed folders; ask the user to widen them.',
  edit_not_unique: 'Read the file and pass a longer, unique old_string.',
  host_file_too_large: 'Split the content into smaller files.',
  binary_file:
    'Use read_document for documents, or a shell command to inspect it.',
  egress_disabled: 'Ask the user to enable the generic egress in Settings.',
  egress_budget_exceeded:
    'Continue editing; the next turn gets a fresh egress budget.',
  egress_rate_limited: 'Wait for the retry window, then make one call.',
  http_write_unsupported:
    'Only GET and HEAD are supported; there is no request body.',
  proxy_config_invalid:
    'Ask the user to fix the proxy URL (scheme://host:port).',
  dns_answer_non_global: 'Ask the user to relax the egress mode or fix DNS.',
  dns_no_answer: 'Ask the user to check DNS or the proxy for this host.',
  port_not_allowed: 'Ask the user to allow this port in the egress settings.',
  url_forbidden: 'Run diagnose_url to learn which rule refused the address.',
  unsupported_media_type: 'Use kind image or media, with a direct file URL.',
  invalid_local_material:
    'The download did not land in the cache folder; retry once.',
  material_not_ready: 'Report the download as failed; retry with another URL.',
  material_not_materialized:
    'No bytes were written (size 0): report a failure, never a saved material.',
};

const DEFAULT_NEXT_STEP =
  'Report the limitation to the user; do not retry the same call.';

/** 失败信封里原样透出的键（AC-G21 / REV-P1-12）。 */
const VERBATIM_DETAIL_KEYS =
  ['reason', 'layer', 'sticky', 'remediation', 'upstream_status',
    'local_status', 'request_id', 'provider_request_id', 'retry_after_seconds',
    'robots_scope', 'robots_origin', 'robots_failure_stage', 'robots_failure_code', 'robots_cache_hit'] as const;

/**
 * 组装失败结果：`failure_class` 与 `retryable` 恒有，`reason` / `layer` /
 * `sticky` / `remediation` 一律按后端信封原样透出，不解释、不改写——模型与
 * 用户要看到的就是后端给出的那一句（§4.7）。
 *
 * @param errorCode - 后端错误码（或本地判定的码，如 `http_write_unsupported`）。
 * @param details - 后端 `error_details`；缺字段时按 `transient` / 不可重试兜底。
 * @param nextStep - 覆盖默认下一步建议。
 */
export function hostFailure(
  errorCode: string,
  details: Record<string, unknown> = {},
  nextStep?: string,
) {
  const errorDetails: Record<string, unknown> = {
    failure_class: ['policy', 'configuration', 'validation', 'user_input',
      'cancelled', 'transient', 'internal', 'blocked'].includes(String(details.failure_class))
      ? details.failure_class : 'internal',
    retryable: details.retryable === true,
  };
  for (const key of VERBATIM_DETAIL_KEYS) {
    if (['string', 'number', 'boolean'].includes(typeof details[key])) {
      errorDetails[key] = typeof details[key] === 'string'
        ? safeFailureText(details[key] as string) : details[key];
    }
  }
  return toolResult({
    success: false,
    error_code: /^[a-z][a-z0-9_]{0,79}$/.test(errorCode) ? errorCode : 'internal_error',
    next_step: nextStep ? safeFailureText(nextStep) : NEXT_STEPS[errorCode] ?? (details.retryable === true
      ? 'Retry once after the retry window; then use another source or report the limitation.'
      : DEFAULT_NEXT_STEP),
    error_details: errorDetails,
    failureClass: errorDetails.failure_class,
  });
}

function safeFailureText(value: string): string {
  return value.replace(/<[^>]*>/g, '')
    .replace(/(?:authorization|api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/https?:\/\/[^\s<>]+/gi, raw => {
      try { const url = new URL(raw); return `${url.origin}${url.pathname}`; }
      catch { return '[redacted URL]'; }
    }).slice(0, 500);
}

/**
 * 每回合 tier-2 出口记账（AC-G22a）：第 `maxPerTurn + 1` 次直接失败。
 *
 * 计数器挂在 `context.turnState`（每个请求新建）上，所以一次 SSE 重试或下一轮
 * 对话自然从零开始。预算耗尽只关掉出口调用，纯剪辑工具照常工作。
 *
 * @returns 超预算时的失败结果；未超预算返回 `null` 并已计一次。
 */
function takeEgressBudget(context: ToolContext) {
  const limit = context.hostCapabilities?.egress.maxPerTurn
    ?? DEFAULT_EGRESS_MAX_PER_TURN;
  const used = context.turnState.egressCalls ?? 0;
  if (used >= limit) {
    return hostFailure('egress_budget_exceeded', {
      failure_class: 'transient', retryable: false,
    }, `This turn already used ${limit} egress calls; editing tools still work.`
      + ' Tell the user, or finish with what is already available.');
  }
  context.turnState.egressCalls = used + 1;
  return null;
}

/**
 * `bash` 的两路输出各自不超过 `RESULT_BYTE_CAP`（§6「ShellResult 精简」）。
 *
 * 后端已按 `shell_max_output_kb` 截过一次；这里再兜一道，避免 stdout 与 stderr
 * 同时很大时，把整条结果挤成 artifact 引用而丢掉退出码与解释器回显。
 */
function limitShellStreams(data: Record<string, unknown>) {
  const capped: Record<string, unknown> = { ...data };
  for (const key of ['stdout', 'stderr'] as const) {
    const text = capped[key];
    if (typeof text !== 'string') continue;
    if (new TextEncoder().encode(text).length <= RESULT_BYTE_CAP) continue;
    capped[key] = `${utf8Slice(text, RESULT_BYTE_CAP)}…`;
    capped[`${key}_truncated`] = true;
  }
  return capped;
}

/** 非 JSON 响应（BFF 502/504 的纯文本）也要变成结构化失败。 */
async function readEnvelope(response: Response): Promise<HostEnvelope> {
  try {
    return await response.json() as HostEnvelope;
  } catch {
    return {
      success: false,
      error_code: response.status === 504
        ? 'upstream_timeout' : 'internal_error',
      error_details: { failure_class: response.status === 504 ? 'transient' : 'internal', retryable: response.status === 504 },
    };
  }
}

function nextStepOf(envelope: HostEnvelope): string | undefined {
  const value = envelope.error_details?.next_step;
  return typeof value === 'string' ? value : undefined;
}

/** `project_id` 只在会话确实有工程时下发（旧调用点没有该字段）。 */
export function withProjectId(
  context: ToolContext,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return context.projectId ? { ...body, project_id: context.projectId } : body;
}

/**
 * 把 `{status:'ready', material}` 变成一次入库操作（AC-G05 / AC-G06）。
 *
 * `size = 0` 一律判失败：那是"只有元数据、没有字节"的伪素材，正是现场日志里
 * 8 张图全部失败的原因（C-6）。`local_url` 必须通过 `webToolAdapter` 的缓存
 * 正则；已是库内素材时不重复发布操作。
 */
function importDownloadedMaterial(
  context: ToolContext,
  callId: string,
  payload: unknown,
  call: HostCall,
) {
  const data = (payload ?? {}) as {
    status?: string;
    reused?: boolean;
    material?: ResearchMaterial;
  };
  if (data.status !== 'ready' || !data.material) {
    return hostFailure('material_not_ready', {
      failure_class: 'transient', retryable: true,
    });
  }
  if (!(data.material.size > 0)) {
    return hostFailure('material_not_materialized', {
      failure_class: 'policy', retryable: false,
    });
  }
  let material: MaterialItem;
  try {
    // §6 的 `/egress/download` 不返回 `created_at`；`localMaterial` 需要它，
    // 缺省用下载时刻，避免库里出现 Invalid Date。
    const raw = data.material;
    material = localMaterial({
      ...raw,
      created_at: raw.created_at ?? new Date().toISOString(),
    });
  } catch {
    return hostFailure('invalid_local_material', {
      failure_class: 'policy', retryable: true,
    });
  }
  material.metadata = { ...material.metadata, candidate: false, materialized: true };
  const exists = context.materials.some(item => item.id === material.id);
  if (!exists && !context.abortSignal?.aborted) {
    context.recordOperation(callId,
      { type: 'add_materials', materials: [material] });
    context.materials.push(material);
  }
  return toolResult({
    ...data,
    materialized: true,
    availability: 'materialized',
    already_in_library: exists,
    project_id: context.projectId ?? null,
    success: true,
    ...call.successFields,
  });
}

interface EgressBranch {
  key: string;
  attempts: number;
  nextAttemptAt: number;
  failure?: ReturnType<typeof hostFailure>;
  active: boolean;
  record?: EgressFailureRecord;
  requestVariant?: string;
}
const egressBranches = new WeakMap<object, Map<string, EgressBranch>>();
const unavailableOrigins = new WeakMap<object, Map<string, ReturnType<typeof hostFailure>>>();

interface EgressFailureRecord {
  branchId: string;
  scope: string;
  revision: string;
  expiresAt: number;
  attempts: number;
  nextAttemptAt: number;
  failure: Record<string, unknown>;
  requestVariant?: string;
}

export function restoreEgressFailures(context: ToolContext, values: unknown[]) {
  if (!context.recoveryScope || context.recoveryReset) return;
  const branches = new Map<string, EgressBranch>();
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const record = item.egress_failure as EgressFailureRecord | undefined;
    if (record?.scope === context.recoveryScope &&
        record.revision === (context.generationConfigRevision ?? '') &&
        record.expiresAt > Date.now() && typeof record.branchId === 'string' && record.branchId.startsWith('/egress/') &&
        record.failure?.success === false) {
      branches.set(record.branchId, { key: record.branchId, attempts: record.attempts,
        nextAttemptAt: record.nextAttemptAt, failure: toolResult(record.failure),
        active: false, record, requestVariant: record.requestVariant });
    }
    const cleared = item.egress_recovery as Record<string, unknown> | undefined;
    if (cleared?.scope === context.recoveryScope &&
        cleared.revision === (context.generationConfigRevision ?? '')) branches.delete(String(cleared.branchId));
  }
  egressBranches.set(context.turnState, branches);
  const origins = new Map<string, ReturnType<typeof hostFailure>>();
  branches.forEach(branch => {
    const failure = branch.failure;
    const details = failure?.details.error_details as Record<string, unknown> | undefined;
    if (failure?.details.error_code === 'robots_unavailable' && details?.robots_scope === 'origin' && typeof details.robots_origin === 'string') {
      try { origins.set(new URL(details.robots_origin).origin, failure); } catch { /* 无有效 origin 不扩展拒绝范围。 */ }
    }
  });
  unavailableOrigins.set(context.turnState, origins);
}

/** 去除片段/签名参数，规范化主机及默认端口，避免拼写重置预算。 */
function branchFor(context: ToolContext, call: HostCall): EgressBranch | undefined {
  if (!call.egress || call.path === '/egress/diagnose') return undefined;
  const body = call.body as { url?: string } | undefined;
  try {
    const url = new URL(body?.url ?? '');
    const path = url.pathname.replace(/%[0-9a-f]{2}/gi, encoded => {
      const decoded = String.fromCharCode(parseInt(encoded.slice(1), 16));
      return /^[a-z0-9._~-]$/i.test(decoded) ? decoded : encoded.toUpperCase();
    });
    const key = `${call.path}:${url.origin}${path}`;
    const branches = egressBranches.get(context.turnState) ?? new Map();
    const branch = branches.get(key) ?? { key, attempts: 0, nextAttemptAt: 0, active: false };
    if (branch.record && branch.record.expiresAt <= Date.now() && !branch.active) {
      branch.attempts = 0;
      branch.failure = undefined;
      branch.record = undefined;
    }
    branches.set(key, branch);
    egressBranches.set(context.turnState, branches);
    return branch;
  } catch { return undefined; }
}

function readRequestVariant(call: HostCall): string | undefined {
  const body = call.body as { kind?: string; method?: string } | undefined;
  if (call.path === '/egress/download' &&
      (body?.kind === 'image' || body?.kind === 'media')) {
    return `kind:${body.kind}`;
  }
  if (call.path === '/egress/request' &&
      (body?.method === 'HEAD' || body?.method === 'GET')) {
    return `method:${body.method}`;
  }
  return undefined;
}

/** Keep the URL-wide budget; only these rejected arguments admit one correction. */
function getCorrectiveVariant(branch: EgressBranch): string | undefined {
  if (branch.attempts >= 2) return undefined;
  const failure = branch.failure?.details;
  const details = failure?.error_details as Record<string, unknown> | undefined;
  if (details?.failure_class !== 'user_input') return undefined;
  if (failure?.error_code === 'unsupported_media_type') {
    if (branch.requestVariant === 'kind:image') return 'kind:media';
    if (branch.requestVariant === 'kind:media') return 'kind:image';
  }
  if (details.upstream_status === 405 && branch.requestVariant === 'method:HEAD') {
    return 'method:GET';
  }
  return undefined;
}

function readRetryAfterSeconds(value: unknown): number {
  const text = typeof value === 'string' ? value.trim() : '';
  const seconds = typeof value === 'number' ? value
    : /^\d+$/.test(text) ? Number(text)
      : Math.ceil((Date.parse(text) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(0, seconds)) : 0;
}

function rememberEgressFailure(context: ToolContext, branch: EgressBranch | undefined,
  result: ReturnType<typeof hostFailure>) {
  if (!branch) return result;
  const details = result.details.error_details as Record<string, unknown>;
  if (result.details.error_code === 'robots_unavailable' && details.robots_scope === 'origin'
    && typeof details.robots_origin === 'string') {
    const origins = unavailableOrigins.get(context.turnState) ?? new Map();
    try { origins.set(new URL(details.robots_origin).origin, result); } catch { /* 无有效 origin 不扩展拒绝范围。 */ }
    unavailableOrigins.set(context.turnState, origins);
  }
  if (details.failure_class === 'cancelled') return result;
  branch.failure = result;
  branch.nextAttemptAt = Date.now()
    + readRetryAfterSeconds(details.retry_after_seconds) * 1000;
  if (details.retryable !== true || branch.attempts >= 2) {
    const correction = getCorrectiveVariant(branch);
    const nextStep = correction?.startsWith('kind:')
      ? `Correct kind to ${correction.slice(5)} once; otherwise use another source.`
      : correction === 'method:GET'
        ? 'Use GET once instead of HEAD; otherwise use another source.'
        : DEFAULT_NEXT_STEP;
    branch.failure = hostFailure(result.details.error_code as string,
      { ...details, retryable: false }, nextStep);
  }
  const record: EgressFailureRecord = {
    branchId: branch.key, scope: context.recoveryScope ?? '',
    revision: context.generationConfigRevision ?? '',
    expiresAt: Math.max(Date.now() + 10 * 60_000, branch.nextAttemptAt),
    attempts: branch.attempts, nextAttemptAt: branch.nextAttemptAt,
    failure: branch.failure.details, requestVariant: branch.requestVariant,
  };
  branch.record = record;
  return toolResult({ ...branch.failure.details, egress_failure: record });
}

/**
 * 执行一次 `agent-host` 调用。
 *
 * 失败一律是**结构化返回**（`details.success === false`），而不是异常：
 * 断路器据此统计软失败，模型也能读到 `reason` 与 `remediation`。
 *
 * @param context - 本轮工具上下文（提供 `apiBaseUrl`、`turnState`、素材库）。
 * @param callId - 工具调用 id，作为 `x-tool-call-id` 幂等键。
 * @param call - 端点、请求体、前端超时与是否计入出口预算。
 */
export async function executeHostTool(
  context: ToolContext,
  callId: string,
  call: HostCall,
) {
  if (context.abortSignal?.aborted || call.signal?.aborted) {
    return hostFailure('cancelled', { failure_class: 'cancelled' });
  }
  if (call.path === '/egress/download' || call.path === '/egress/request') {
    try {
      const url = new URL((call.body as { url: string }).url);
      const refused = unavailableOrigins.get(context.turnState)?.get(url.origin);
      if (refused) return toolResult({ ...refused.details, cached: true,
        next_step: 'robots could not be fetched for this origin. Use another origin or existing media; do not infer an upstream HTTP status without diagnostics.' });
    } catch { /* 参数验证由后端处理。 */ }
  }
  const branch = branchFor(context, call);
  if (branch?.active) return hostFailure('branch_probe_pending', {
    failure_class: 'blocked', retryable: false,
  });
  if (branch?.failure) {
    const details = branch.failure.details.error_details as Record<string, unknown>;
    const correction = getCorrectiveVariant(branch);
    const canCorrect = correction !== undefined
      && correction === readRequestVariant(call);
    if (branch.attempts >= 2 || Date.now() < branch.nextAttemptAt
      || (details.retryable !== true && !canCorrect)) {
      return toolResult({ ...branch.failure.details, egress_failure: branch.record, cached: true });
    }
  }
  const budget = call.egress ? takeEgressBudget(context) : null;
  if (budget) return budget;
  if (branch) {
    branch.active = true;
    branch.attempts++;
    branch.requestVariant = readRequestVariant(call);
  }
  try {
    const response = await toolFetch(context, `/api/agent-host${call.path}`, {
      method: 'POST',
      retry: false,
      timeout: call.timeout ?? HOST_CALL_TIMEOUT_MS,
      signal: call.signal,
      // 写请求必须自带并转发 Origin：BFF 与后端都按它判定「同源 UI 发起」。
      headers: { 'x-tool-call-id': callId, origin: context.apiBaseUrl },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    });
    const envelope = await readEnvelope(response);
    if (context.abortSignal?.aborted || call.signal?.aborted) {
      return hostFailure('cancelled', { failure_class: 'cancelled' });
    }
    if (!response.ok || envelope.success === false) {
      const code = envelope.error_code ?? 'internal_error';
      const advice = call.path === '/egress/download' && ['timeout', 'upstream_timeout', 'network_error'].includes(code)
        ? 'Retry this branch at most once after the retry window; use smaller media, diagnose_url, another source, or existing materials.' : nextStepOf(envelope);
      return rememberEgressFailure(context, branch, hostFailure(
        code,
        { ...envelope.error_details, local_status: response.status },
        advice,
      ));
    }
    const data = (envelope.data ?? {}) as Record<string, unknown>;
    if (call.egress && typeof data.status === 'number' && data.status >= 400) {
      const retryable = data.status === 429 || data.status === 408 || data.status >= 500;
      const headers = (data.headers ?? {}) as Record<string, unknown>;
      return rememberEgressFailure(context, branch, hostFailure('upstream_error', {
        upstream_status: data.status, local_status: response.status,
        failure_class: retryable ? 'transient' : 'user_input', retryable,
        retry_after_seconds: readRetryAfterSeconds(headers['retry-after']),
      }));
    }
    const result = call.importMaterial
      ? importDownloadedMaterial(context, callId, data, call)
      : toolResult({
        ...(call.path === '/shell/run' ? limitShellStreams(data) : data),
        project_id: context.projectId ?? null,
        success: true,
        ...call.successFields,
      });
    if (result.details.success === false) {
      return rememberEgressFailure(context, branch, result);
    }
    if (!branch) return result;
    branch.attempts = 0;
    branch.failure = undefined;
    return toolResult({ ...result.details, egress_recovery: {
      branchId: branch.key, scope: context.recoveryScope ?? '',
      revision: context.generationConfigRevision ?? '',
    } });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const code = context.abortSignal?.aborted || call.signal?.aborted ? 'cancelled'
      : name === 'TimeoutError' ? 'timeout' : error instanceof TypeError ? 'network_error' : 'internal_error';
    return rememberEgressFailure(context, branch, hostFailure(code, {
      failure_class: code === 'cancelled' ? 'cancelled' : code === 'internal_error' ? 'internal' : 'transient',
      retryable: code === 'timeout' || code === 'network_error',
    }, call.path === '/egress/download' && ['timeout', 'network_error'].includes(code)
      ? 'Retry this branch at most once; use smaller media, diagnose_url, another source, or existing materials.' : undefined));
  } finally {
    if (branch) branch.active = false;
  }
}
