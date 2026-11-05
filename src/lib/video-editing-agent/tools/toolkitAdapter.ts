import type { ToolContext } from '../types';
import { sanitizeResearchValue } from '../researchEventSanitizer';
import { RESULT_BYTE_CAP } from './webToolAdapter';
import { utf8Slice } from '../modelContextBudget';
import { toolFetch } from './apiHelper';

/**
 * Agent Toolkit 工具的薄适配层。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.3 / §3.8 / §4.4。
 *
 * 与 `webToolAdapter` 同一条纪律：**一次 HTTP 调用、最多一个编辑操作、不做
 * 事后补发**。差别只有三处：
 *   1. 没有 run token（工作区没有网络出口），改用 `x-tool-call-id` 做幂等键；
 *   2. 结果裁剪与 `webToolAdapter` 共用 `RESULT_BYTE_CAP`（12 KiB），不再内联
 *      第二份魔数（R-26）；
 *   3. 失败也是**正常返回**（`details.success === false`），让断路器能统计软失败。
 */

export interface ToolkitCall {
  /** 形如 `/workspace/write`、`/documents/read`（拼到 `basePath` 后）。 */
  path: string;
  /** 默认 `/api/agent-toolkit`；技能库等其它域传自己的前缀，不复制适配器。 */
  basePath?: string;
  /**
   * 只保留响应 `data` 里的这些键。响应里有会撑爆 `RESULT_BYTE_CAP` 的冗余字段
   * （如技能的 `markdown` 原文与 `body` 并存）时用它，免得整体被头尾截断。
   */
  select?: readonly string[];
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeout?: number;
  /** 失败时给模型的下一步建议（不传则按错误码自动补）。 */
  nextStep?: string;
}

const DEFAULT_BASE_PATH = '/api/agent-toolkit';
const DEFAULT_TIMEOUT = 30_000;
const LONG_TIMEOUT = 120_000;

/** 错误码 → 可执行的下一步；模型看到 next_step 才不会原地重试。 */
const NEXT_STEPS: Record<string, string> = {
  toolkit_disabled: 'Ask the user to enable Agent capabilities in Settings.',
  workspace_disabled: 'Ask the user to enable Workspace in Settings → Agent capabilities.',
  documents_disabled: 'Ask the user to enable Documents in Settings → Agent capabilities.',
  analysis_disabled: 'Ask the user to enable Analysis in Settings → Agent capabilities.',
  memory_disabled: 'Ask the user to enable Memory in Settings → Agent capabilities.',
  workspace_quota_exceeded: 'Delete unused workspace files or ask the user to raise the quota.',
  workspace_file_too_large: 'Split the content into smaller files.',
  workspace_not_found: 'Load workspace_list with explore_tools, then call it on the next response. ' +
    'Names are relative to files/: shell output files/bgm.mp3 imports as name="bgm.mp3".',
  binary_file: 'Use read_document for documents, workspace_import_material for media.',
  binary: 'Use read_document for documents, workspace_import_material for media.',
  document_not_found: 'Load workspace_list with explore_tools, then call it on the next response to see documents.',
  cache_commit_failed: 'The material cache record could not be saved. Report the request_id for diagnosis; keep the workspace source.',
  cache_integrity_error: 'The file changed during import. Wait for the writer to finish, then import it again.',
  storage_full: 'Free disk space, then import the existing workspace file again.',
  media_probe_unavailable: 'Restore the bundled ffprobe program, then import again; do not add this material to the timeline.',
  media_probe_timeout: 'Media probing timed out. Check the local file before retrying; do not add it to the timeline.',
  media_probe_failed: 'Generate or obtain a valid audio/video file with a positive duration, then import again.',
  page_out_of_range: 'Request a page within the reported page count.',
  document_unsupported_format: 'Ask the user to convert the file to PDF, DOCX or plain text.',
  document_parse_failed: 'Ask the user for another copy of the file.',
  documents_unavailable: 'Document parsing is unavailable in this build.',
  memory_limit_reached: 'Forget an old memory first.',
  policy_blocked: 'Store the decision without the credential.',
  invalid_workspace_name: 'Use a short relative name such as script/outline.md.',
  invalid_offset: 'Continue from the next_offset the previous page returned; never compute offset yourself.',
  invalid_page_size: 'Use max_bytes between 1 and 8000.',
  invalid_argument: 'Check the parameters and try once more.',
  skill_not_found: 'Pick an id from the 可用技能 list, or continue without a skill.',
  invalid_skill: 'Tell the user the skill file is invalid; continue without it.',
  skill_disabled: 'The skill is turned off; continue without it or ask the user to enable it.',
};

function bytesOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * 单条工具结果的统一裁剪：超 `RESULT_BYTE_CAP` 时保留头尾并明确告知已截断。
 * `next_step` 永远在结果里，避免「结果被截断但模型不知道」。
 */
export function toolkitResult(details: Record<string, unknown>) {
  const safe = sanitizeResearchValue(details) as Record<string, unknown>;
  let visible: Record<string, unknown> = safe;
  if (bytesOf(visible) > RESULT_BYTE_CAP) {
    visible = shrinkOversizedValues(safe);
  }
  if (bytesOf(visible) > RESULT_BYTE_CAP) {
    visible = boundedPreview(visible);
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(visible) }],
    details: visible,
  };
}

const TRUNCATED_NOTE =
  'Read the object in smaller pieces (offset/page) instead of one big result.';

/**
 * 第一层收缩：长字符串与长数组。
 *
 * `webToolAdapter` 只压 `summary` 一个字段，这里的结果形状更多（文件列表、
 * 分析产物、记忆条目），必须逐字段压，否则「标了 truncated 却仍然超限」。
 */
function shrinkOversizedValues(value: Record<string, unknown>) {
  const head: Record<string, unknown> = { ...value, truncated: true };
  for (const [key, item] of Object.entries(head)) {
    if (key === 'next_step' || key === 'truncated' || key === 'success') continue;
    if (typeof item === 'string' && item.length > 1200) {
      head[key] = utf8Slice(item, 1200) + '…';
    } else if (Array.isArray(item) && item.length > 20) {
      head[key] = item.slice(0, 20);
      head[`${key}_omitted`] = item.length - 20;
    }
  }
  head.next_step = head.next_step ?? TRUNCATED_NOTE;
  return head;
}

/** 第二层兜底：把整条结果换成**有界**预览，保证 bytes ≤ `RESULT_BYTE_CAP`。 */
function boundedPreview(value: Record<string, unknown>) {
  const omitted = Object.keys(value);
  const serialized = JSON.stringify(value);
  const base = { success: value.success, truncated: true, omitted_keys: omitted };
  // 预览是嵌进 JSON 的**字符串**：引号/换行会被再次转义，所以按字节切片后
  // 仍可能超限，必须实测着收敛，而不是切一次就当完成。
  let budget = RESULT_BYTE_CAP - bytesOf({ ...base, preview: '' }) - 64;
  let preview = budget > 0 ? utf8Slice(serialized, budget) : '';
  let candidate = { ...base, preview, next_step: TRUNCATED_NOTE };
  while (preview && bytesOf(candidate) > RESULT_BYTE_CAP) {
    budget = Math.floor(budget / 2);
    preview = budget > 0 ? utf8Slice(serialized, budget) : '';
    candidate = { ...base, preview, next_step: TRUNCATED_NOTE };
  }
  return candidate;
}

/** 统一失败信封（不抛异常，让断路器统计软失败）。 */
export function toolkitFailure(
  errorCode: string,
  extra: Record<string, unknown> = {},
  nextStep?: string,
) {
  const details = (extra.error_details ?? {}) as { failure_class?: string };
  return toolkitResult({
    success: false,
    error_code: errorCode,
    next_step: nextStep ?? NEXT_STEPS[errorCode]
      ?? 'Report the limitation to the user; do not retry the same call.',
    failureClass: details.failure_class,
    ...extra,
  });
}

function buildQuery(query: ToolkitCall['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function selectKeys(
  data: Record<string, unknown>, keys: ToolkitCall['select'],
): Record<string, unknown> {
  if (!keys) return data;
  return Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]]));
}

function timeoutFor(call: ToolkitCall): number {
  if (call.timeout) return call.timeout;
  if (call.path.startsWith('/analysis/run')
    || call.path.startsWith('/documents/upload')) return LONG_TIMEOUT;
  return DEFAULT_TIMEOUT;
}

/**
 * 请求头。`x-tool-call-id` 是后端的幂等键（读操作后端也要这个头存在），
 * 写方法再声明 `Origin`：BFF 与后端都以它判定「同源 UI 发起的写」。服务端
 * 工具没有浏览器上下文，只能自己声明 —— 用 `apiBaseUrl`，它正是打包时注入的
 * `RESEARCH_RENDERER_ORIGIN`（desktop/main/frontendService.js:29）。
 */
function toolkitHeaders(
  context: ToolContext,
  callId: string,
  method: string,
): Record<string, string> {
  return {
    'x-tool-call-id': callId,
    ...(method === 'GET' ? {} : { origin: context.apiBaseUrl }),
  };
}

/**
 * 执行一次工具调用。`callId` 同时是 `x-tool-call-id` 与后端幂等键，
 * SSE 重试时同一 `callId` 不会重放写盘（§3.8）。
 */
export async function executeToolkitTool(
  context: ToolContext,
  callId: string,
  call: ToolkitCall,
) {
  const stopped = () => context.abortSignal?.aborted === true;
  if (stopped()) {
    return toolkitFailure('cancelled', {}, 'The turn was cancelled; do nothing.');
  }
  const method = call.method ?? (call.body === undefined ? 'GET' : 'POST');
  const headers = toolkitHeaders(context, callId, method);
  try {
    const response = await toolFetch(
      context,
      `${call.basePath ?? DEFAULT_BASE_PATH}${call.path}${buildQuery(call.query)}`,
      {
        method,
        headers,
        retry: false,
        timeout: timeoutFor(call),
        signal: context.abortSignal,
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      },
    );
    const envelope = await response.json() as {
      success?: boolean; data?: unknown; error_code?: string;
      message?: string; error_details?: Record<string, unknown>;
    };
    if (stopped()) {
      return toolkitFailure('cancelled', {}, 'The turn was cancelled; do nothing.');
    }
    if (!response.ok || !envelope.success) {
      return toolkitFailure(
        envelope.error_code ?? 'internal_error',
        {
          message: envelope.message,
          error_details: envelope.error_details,
          status: response.status,
        },
        call.nextStep ?? (envelope.error_details?.next_step as string | undefined),
      );
    }
    const data = selectKeys((envelope.data ?? {}) as Record<string, unknown>, call.select);
    return toolkitResult({
      ...data,
      project_id: context.projectId ?? null,
      success: true,
      ...(call.nextStep ? { next_step: call.nextStep } : {}),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const code = stopped() ? 'cancelled'
      : name === 'TimeoutError' ? 'upstream_timeout'
        : 'network_error';
    return toolkitFailure(code, {
      error_details: {
        failure_class: code === 'cancelled' ? 'cancelled' : 'transient',
        retryable: false,
      },
    });
  }
}

/** 工具参数里取 project_id：优先参数，其次会话上下文。 */
export function resolveProjectId(
  context: ToolContext,
  explicit?: unknown,
): string | undefined {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  return context.projectId;
}

/** `executeToolkitRaw` 的返回：成功给**未裁剪**的 `data`，失败给稳定错误码。 */
export type ToolkitRawResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; nextStep?: string };

interface ToolkitEnvelope {
  success?: boolean;
  data?: unknown;
  error_code?: string;
  message?: string;
  error_details?: Record<string, unknown>;
}

/**
 * 不裁剪的读取通道（docs/plans/agent-subtitles/spec.md §6.5 / P0-1）。
 *
 * **为什么必须另开一条**：`executeToolkitTool` 的返回值一律经 `toolkitResult`，
 * 序列化后一旦超过 `RESULT_BYTE_CAP`（12 KiB），`shrinkOversizedValues` 会把
 * 任何 > 1200 字符的字符串字段截成 1200 字符 + `…`。于是哪怕只读 4000 字节一页
 * 的工作区 SRT，`content` 也会被砍掉一半：cue 数与时间全错，工具却照样回
 * `success:true` —— 静默错字幕。
 *
 * 因此这条通道**只在工具内部**把 `content` 拼成完整文件时使用：它不裁剪、
 * 不抛异常（失败回稳定错误码），调用方也**不得**把 `content` 原样放回工具结果
 * （只回解析后的统计）。其余工具继续走 `executeToolkitTool`。
 */
export async function executeToolkitRaw(
  context: ToolContext,
  callId: string,
  call: ToolkitCall,
): Promise<ToolkitRawResult> {
  if (context.abortSignal?.aborted) {
    return { ok: false, code: 'cancelled', nextStep: 'The turn was cancelled; do nothing.' };
  }
  const method = call.method ?? (call.body === undefined ? 'GET' : 'POST');
  try {
    const response = await toolFetch(
      context,
      `${call.basePath ?? DEFAULT_BASE_PATH}${call.path}${buildQuery(call.query)}`,
      {
        method,
        headers: toolkitHeaders(context, callId, method),
        retry: false,
        timeout: timeoutFor(call),
        signal: context.abortSignal,
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      },
    );
    const envelope = await response.json() as ToolkitEnvelope;
    if (!response.ok || !envelope.success) {
      return rawFailure(
        envelope.error_code ?? 'internal_error',
        call.nextStep ?? (envelope.error_details?.next_step as string | undefined),
      );
    }
    return { ok: true, data: (envelope.data ?? {}) as Record<string, unknown> };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const code = context.abortSignal?.aborted ? 'cancelled'
      : name === 'TimeoutError' ? 'upstream_timeout'
        : 'network_error';
    return rawFailure(code, undefined);
  }
}

/** 失败信封：错误码原样透传，`next_step` 取调用方或通用建议。 */
function rawFailure(code: string, nextStep?: string): ToolkitRawResult {
  return {
    ok: false,
    code,
    nextStep: nextStep ?? NEXT_STEPS[code]
      ?? 'Report the limitation to the user; do not retry the same call.',
  };
}
