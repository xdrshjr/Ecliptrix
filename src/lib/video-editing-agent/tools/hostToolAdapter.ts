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
  ['reason', 'layer', 'sticky', 'remediation'] as const;

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
    failure_class: details.failure_class ?? 'transient',
    retryable: details.retryable === true,
  };
  for (const key of VERBATIM_DETAIL_KEYS) {
    if (details[key] !== undefined) errorDetails[key] = details[key];
  }
  return toolResult({
    success: false,
    error_code: errorCode,
    next_step: nextStep ?? NEXT_STEPS[errorCode] ?? DEFAULT_NEXT_STEP,
    error_details: errorDetails,
    failureClass: errorDetails.failure_class,
  });
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
  const exists = context.materials.some(item => item.id === material.id);
  if (!exists && !context.abortSignal?.aborted) {
    context.recordOperation(callId,
      { type: 'add_materials', materials: [material] });
    context.materials.push(material);
  }
  return toolResult({
    ...data,
    already_in_library: exists,
    project_id: context.projectId ?? null,
    success: true,
    ...call.successFields,
  });
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
  if (context.abortSignal?.aborted) {
    return hostFailure('cancelled', { failure_class: 'cancelled' });
  }
  const budget = call.egress ? takeEgressBudget(context) : null;
  if (budget) return budget;
  try {
    const response = await toolFetch(context, `/api/agent-host${call.path}`, {
      method: 'POST',
      retry: false,
      timeout: call.timeout ?? HOST_CALL_TIMEOUT_MS,
      signal: context.abortSignal,
      // 写请求必须自带并转发 Origin：BFF 与后端都按它判定「同源 UI 发起」。
      headers: { 'x-tool-call-id': callId, origin: context.apiBaseUrl },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    });
    const envelope = await readEnvelope(response);
    if (context.abortSignal?.aborted) {
      return hostFailure('cancelled', { failure_class: 'cancelled' });
    }
    if (!response.ok || envelope.success === false) {
      return hostFailure(
        envelope.error_code ?? 'internal_error',
        envelope.error_details ?? {},
        nextStepOf(envelope),
      );
    }
    const data = (envelope.data ?? {}) as Record<string, unknown>;
    return call.importMaterial
      ? importDownloadedMaterial(context, callId, data, call)
      : toolResult({
        ...(call.path === '/shell/run' ? limitShellStreams(data) : data),
        project_id: context.projectId ?? null,
        success: true,
        ...call.successFields,
      });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const code = context.abortSignal?.aborted ? 'cancelled'
      : name === 'TimeoutError' ? 'timeout' : 'network_error';
    return hostFailure(code, {
      failure_class: code === 'cancelled' ? 'cancelled' : 'transient',
      retryable: code !== 'cancelled',
    });
  }
}
