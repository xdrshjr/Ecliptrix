/**
 * 一次 Agent 回合的上下文形状与组装（纯类型 + 纯函数）。
 *
 * 从 `useAgentExecution` 抽出，用于给 YOLO 的新增行腾出行数预算
 * （docs/plans/agent-yolo-autonomous-mode/spec.md §5.2.1：`useAgentExecution.ts`
 * 基线 855 行已越过 800 行线，净增必须 ≤ 0，允许"抽到新文件"）。
 * `useAgentExecution` 仍原样再导出这些名字，既有导入点无需改动。
 *
 * @module hooks/agentTurnContext
 */

import type { MaterialMention } from '@/types/agentSteering';

/** The segment the user is working on, so "this segment" means that segment. */
export interface AgentEditorContext {
  selectedSegmentId: string | null;
  segmentLabel: string | null;
  segmentRange: { start: number; end: number } | null;
}

/** `{ editorContext }` only when a segment is selected — otherwise nothing (T-AG-1). */
export function buildEditorContextField(
  getEditorContext: (() => AgentEditorContext | null) | undefined,
): { editorContext?: AgentEditorContext } {
  const context = getEditorContext?.() ?? null;
  return context && context.selectedSegmentId ? { editorContext: context } : {};
}

/** Extras the composer attaches to a turn: a `/` skill and `@` material mentions. */
export interface SendAgentMessageOptions {
  skillId?: string;
  mentions?: MaterialMention[];
  /** 客户端自动发起的回合（当前只有 YOLO 续跑）；时间线据此显示小标记。 */
  automatic?: 'yolo_continue';
}
