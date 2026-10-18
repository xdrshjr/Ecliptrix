'use client';

/**
 * ToolkitToolCard — Agent Toolkit 工具结果的一级分发器。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §6.2 / R-23。
 *
 * 与 `WebResearchToolCard` 的 `isWebResearchTool` 完全同形：两个分发点
 * （`AgentToolCallCard.tsx`、`timeline/AgentExecutionNode.tsx`）只判断一次工具名，
 * 具体渲染留在这里，避免宿主再长一份 switch。
 *
 * 计划与提问都从既有的 `AgentToolCallRecord` 派生，不新增持久化字段。
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentToolCallRecord } from '@/types';
import type {
  AgentPlan, AskUserOption, AskUserQuestion, PlanStep, PlanStepStatus,
} from '@/types/agentToolkit';
import { isToolkitTool } from '@/types/agentToolkit';
import AskUserCard from './AskUserCard';
import PlanCard from './PlanCard';
import WorkspaceFileCard from './WorkspaceFileCard';

export { isToolkitTool };
export { ASK_ANSWER_EVENT } from './AskUserCard';

export interface ToolkitToolCardProps {
  toolCall: AgentToolCallRecord;
  /** questionIds that already have a [[ask:<id>]] user message after them. */
  answeredQuestionIds?: Set<string>;
  /**
   * questionIds whose turn has already ended with no answer. The card then
   * shows the greyed "not answered" state instead of a dead `awaiting` one
   * (spec §3.5.2 未回答态) — derived purely from "run finished + no answer".
   */
  unresolvedQuestionIds?: Set<string>;
}

const PLAN_STATUSES: readonly PlanStepStatus[] =
  ['pending', 'in_progress', 'completed', 'blocked'];

/** 兼容扁平的 `details` 与旧的 `{content, details}` 两种记录形态。 */
function envelope(result: unknown): Record<string, unknown> {
  const flat = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown> : {};
  const nested = flat.details && typeof flat.details === 'object'
    && !Array.isArray(flat.details) ? flat.details as Record<string, unknown> : {};
  // 旧记录里 `success:false` 必须活下来，不能被内层覆盖掉。
  return flat.success === false
    ? { ...flat, ...nested, success: false } : { ...flat, ...nested };
}

/** `update_plan` 结果 → `AgentPlan`；不是生效的计划信封则返回 null。 */
function readPlan(result: unknown): AgentPlan | null {
  const payload = envelope(result);
  if (payload.success !== true) return null;
  const planId = typeof payload.plan_id === 'string' ? payload.plan_id.trim() : '';
  if (!planId) return null;
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) return null;
  const steps: PlanStep[] = [];
  for (const item of payload.steps) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    const title = typeof entry.title === 'string' ? entry.title : '';
    const status = entry.status as PlanStepStatus;
    if (!title || !PLAN_STATUSES.includes(status)) return null;
    steps.push({
      index: typeof entry.index === 'number' ? entry.index : steps.length,
      title,
      status,
    });
  }
  const active = steps.find(step => step.status === 'in_progress');
  return {
    planId,
    steps,
    activeStep: active ? active.index : null,
    doneCount: steps.filter(step => step.status === 'completed').length,
    total: steps.length,
    ...(typeof payload.note === 'string' && payload.note ? { note: payload.note } : {}),
  };
}

function readOptions(value: unknown): AskUserOption[] {
  if (!Array.isArray(value)) return [];
  const options: AskUserOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) continue;
    options.push({
      label,
      ...(typeof entry.description === 'string' && entry.description
        ? { description: entry.description } : {}),
    });
  }
  return options;
}

/** `ask_user` 结果 → `AskUserQuestion`；只有 `awaiting_user` 信封才算提问。 */
function readQuestion(result: unknown): AskUserQuestion | null {
  const payload = envelope(result);
  if (payload.status !== 'awaiting_user') return null;
  const questionId = typeof payload.question_id === 'string' ? payload.question_id
    : typeof payload.questionId === 'string' ? payload.questionId : '';
  const question = typeof payload.question === 'string' ? payload.question : '';
  if (!questionId || !question) return null;
  return {
    questionId,
    question,
    options: readOptions(payload.options),
    allowFreeText: payload.allow_free_text === true || payload.allowFreeText === true,
    status: 'awaiting',
  };
}

/**
 * `ask_user` 记录 → `question_id`（没有提问信封时返回 null）。
 *
 * 宿主（`timeline/AgentExecutionNode`）用它决定「这一条执行节点里是否还有
 * 未回答的提问」，从而强制展开——否则重新打开会话时提问卡片被折叠隐藏，
 * 用户根本看不到待回答的问题。
 */
export function askQuestionId(result: unknown): string | null {
  return readQuestion(result)?.questionId ?? null;
}

/** 计划尚未生效时的中性状态（不是错误，也不显示任何伪造的步骤）。 */
function PlanEmptyState() {
  const { t } = useLocale();
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-md border border-border
      bg-muted/40 p-3 text-xs text-foreground">
      <p className="font-medium">{t.agentToolkit.planTitle}</p>
      <p role="status" className="mt-1 text-muted-foreground">{t.agentToolkit.planEmpty}</p>
    </section>
  );
}

/** 按工具名分发；不是 toolkit 工具时返回 null（宿主继续走原路径）。 */
export function ToolkitToolCard({
  toolCall, answeredQuestionIds, unresolvedQuestionIds,
}: ToolkitToolCardProps): React.JSX.Element | null {
  if (!isToolkitTool(toolCall.name)) return null;
  if (toolCall.name === 'update_plan') {
    const plan = readPlan(toolCall.result);
    return plan ? <PlanCard plan={plan} /> : <PlanEmptyState />;
  }
  if (toolCall.name === 'ask_user') {
    const question = readQuestion(toolCall.result);
    if (!question) return null;
    // 只读派生：历史里存在 `[[ask:<id>]]` 回答 → 已回答。反之保持可交互——
    // "本轮是否已结束"只有宿主知道，冻结的 prop 契约里没有它，因此这里不猜。
    const answered = answeredQuestionIds?.has(question.questionId) === true;
    return <AskUserCard question={question} answered={answered}
      unresolved={!answered
        && unresolvedQuestionIds?.has(question.questionId) === true} />;
  }
  return <WorkspaceFileCard toolCall={toolCall} />;
}

export default ToolkitToolCard;
