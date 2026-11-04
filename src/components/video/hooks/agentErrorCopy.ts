/**
 * Agent 流式错误的本地化文案（纯函数）。
 *
 * 从 `useAgentExecution` 抽出的等量代码，用于给 YOLO 的新增行腾出行数预算
 * （docs/plans/agent-yolo-autonomous-mode/spec.md §5.2.1：`useAgentExecution.ts`
 * 基线 855 行已越过 800 行线，净增必须 ≤ 0）。行为与抽出前逐字一致。
 *
 * @module hooks/agentErrorCopy
 */

import { describeTtsFailure, getTtsFailure, type TtsFailure } from '@/lib/ttsErrors';
import type { Translations } from '@/lib/i18n';
import {
  serverErrorMessageKey,
  streamErrorMessageKey,
  type StreamError,
} from '@/lib/video-editing-agent/errorRecovery';
import type { AgentStreamErrorCode } from '@/lib/video-editing-agent/types';

/** SSE `error` 事件携带的字段（老服务端只发 `message`）。 */
export interface ServerErrorPayload {
  message: string;
  code?: AgentStreamErrorCode;
  cause?: TtsFailure;
}

/**
 * SSE `error` 事件 → 本地化文案。`tool_failures` 需要把 TTS 失败原因拼进去，
 * 其余按错误码查表；没有错误码（旧服务端）就原样显示服务端消息。
 */
export function describeServerErrorText(
  t: Translations,
  { message, code, cause }: ServerErrorPayload,
): string {
  if (code === 'tool_failures') {
    const failure = getTtsFailure(cause);
    if (!failure) return t.agentStream.errors.toolFailures;
    const description = describeTtsFailure(failure, t);
    return t.agentStream.errors.toolFailuresWithCause.replace(
      '{detail}', [description.summary, description.action]
        .filter(Boolean).join(' '),
    );
  }
  return code
    ? t.agentStream.errors[serverErrorMessageKey(code)].replace('{detail}', message)
    : message;
}

/** 传输层失败（断流/重试耗尽/超时）→ 本地化文案。 */
export function describeStreamErrorText(
  t: Translations,
  error: StreamError,
): string {
  return t.agentStream.errors[streamErrorMessageKey(error)];
}
