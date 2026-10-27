import { ApiError, TimeoutError, http } from '@/lib/api/http-client';
import type {
  CompactErrorCode, SummarizeResult,
} from '@/lib/video-editing-agent/memory/summarizeConversation';
import type { ChatMessage } from '@/types';

/**
 * `POST /api/video-editing-agent/compact` 的类型化客户端。
 *
 * 设计基线：docs/plans/agent-research-crew-and-context-memory/spec.md §3.4.2 / §5.2。
 * 与 `agentSteer` 同风格：**不对失败抛错**。模型失败、超时、守卫拒绝、网络错误都折叠成
 * `{ success: false, error_code }`（守卫拒绝 / 5xx / 网络错误统一记为 `compact_model_unavailable`），调用方据此「什么都不写」即可（失败即现状）。
 */

export type CompactionFailureCode =
  | CompactErrorCode
  /** 调用方自己取消（切换会话 / 卸载）。 */
  | 'compact_cancelled';

export type CompactionOutcome =
  | Extract<SummarizeResult, { success: true }>
  | { success: false; error_code: CompactionFailureCode };

export interface CompactionRequest {
  /** 待折叠段；调用方已裁剪，并已去掉仅 UI 使用的字段。 */
  messages: ChatMessage[];
  /** 更早一次折叠的摘要文本（滚动合并）。 */
  previousSummary?: string;
  locale?: string;
}

const COMPACT_PATH = '/api/video-editing-agent/compact';
/** 服务端总超时 45 s，留出路由解析与网络的余量。 */
const REQUEST_TIMEOUT_MS = 50_000;
/** 与路由的体积上限一致：超出必然 413，不如不发。 */
export const MAX_COMPACT_BODY_BYTES = 400 * 1024;

function bodyBytes(request: CompactionRequest): number {
  return new TextEncoder().encode(JSON.stringify(request)).length;
}

function classify(error: unknown, signal?: AbortSignal): CompactionOutcome {
  if (signal?.aborted) return { success: false, error_code: 'compact_cancelled' };
  if (error instanceof TimeoutError) return { success: false, error_code: 'compact_timeout' };
  if (error instanceof ApiError && error.status === 413) {
    return { success: false, error_code: 'compact_input_too_large' };
  }
  return { success: false, error_code: 'compact_model_unavailable' };
}

/**
 * Ask the server to fold `request.messages` into a digest.
 *
 * @param request The folded segment, optional previous digest and locale.
 * @param signal Cancels the in-flight request.
 * @returns The digest, or a failure code; never rejects.
 */
export async function requestConversationCompaction(
  request: CompactionRequest,
  signal?: AbortSignal,
): Promise<CompactionOutcome> {
  if (bodyBytes(request) > MAX_COMPACT_BODY_BYTES) {
    return { success: false, error_code: 'compact_input_too_large' };
  }
  try {
    return await http.post<CompactionOutcome>(COMPACT_PATH, request, {
      timeoutMs: REQUEST_TIMEOUT_MS, signal,
    });
  } catch (error) {
    return classify(error, signal);
  }
}
