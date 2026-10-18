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
  /** 形如 `/workspace/write`、`/documents/read`（拼到 `/api/agent-toolkit` 后）。 */
  path: string;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeout?: number;
  /** 失败时给模型的下一步建议（不传则按错误码自动补）。 */
  nextStep?: string;
}

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
  workspace_not_found: 'Call workspace_list to see the files that exist.',
  binary_file: 'Use read_document for documents, workspace_import_material for media.',
  binary: 'Use read_document for documents, workspace_import_material for media.',
  document_not_found: 'Call workspace_list to see the documents that exist.',
  page_out_of_range: 'Request a page within the reported page count.',
  document_unsupported_format: 'Ask the user to convert the file to PDF, DOCX or plain text.',
  document_parse_failed: 'Ask the user for another copy of the file.',
  documents_unavailable: 'Document parsing is unavailable in this build.',
  memory_limit_reached: 'Forget an old memory first.',
  policy_blocked: 'Store the decision without the credential.',
  invalid_workspace_name: 'Use a short relative name such as script/outline.md.',
  invalid_argument: 'Check the parameters and try once more.',
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

function timeoutFor(call: ToolkitCall): number {
  if (call.timeout) return call.timeout;
  if (call.path.startsWith('/analysis/run')
    || call.path.startsWith('/documents/upload')) return LONG_TIMEOUT;
  return DEFAULT_TIMEOUT;
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
  /**
   * 写方法必须带 `Origin`：BFF 与后端都以它判定「同源 UI 发起的写」。
   * 服务端工具没有浏览器上下文，只能自己声明 —— 用 `apiBaseUrl`，它正是
   * 打包时注入的 `RESEARCH_RENDERER_ORIGIN`（desktop/main/frontendService.js:29），
   * 与 `chat/route.ts` 取记忆摘要时的做法一致。
   */
  const headers: Record<string, string> = {
    'x-tool-call-id': callId,
    ...(method === 'GET' ? {} : { origin: context.apiBaseUrl }),
  };
  try {
    const response = await toolFetch(
      context,
      `/api/agent-toolkit${call.path}${buildQuery(call.query)}`,
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
    const data = (envelope.data ?? {}) as Record<string, unknown>;
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
