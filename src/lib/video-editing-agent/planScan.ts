/**
 * planScan.ts — 从历史里恢复「最后一次生效的计划」。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.5.1。
 *
 * 计划不落库、不写 `ChatMessage` 新字段：它完全由既有的
 * `AgentToolCallRecord` 派生（与 `scanExploredCategories` 同一模式）。
 *
 * 取数规则（评审 C4 钉死）：
 *   - 只认 `status === 'completed'` **且** `result` 是计划信封的记录；
 *   - 最后一次调用是 `cancelled` / `error` 时继续向前找；
 *   - 全都没有 → 返回 `null`（不注入 `## 当前计划`）。
 * 绝不用 `params` 猜状态——那会把「没生效的计划」显示成已生效。
 *
 * Pure — no side effects.
 */
import type { ChatMessage } from '@/types';
import type { AgentPlan, PlanStep, PlanStepStatus } from '@/types/agentToolkit';
import { extractAgentToolCalls } from './historyScan';

const STATUSES: readonly PlanStepStatus[] =
  ['pending', 'in_progress', 'completed', 'blocked'];

function readEnvelope(result: unknown): AgentPlan | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as Record<string, unknown>;
  if (payload.success !== true) return null;
  const rawSteps = payload.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;
  const steps: PlanStep[] = [];
  for (const item of rawSteps) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    const title = typeof entry.title === 'string' ? entry.title : '';
    const status = entry.status as PlanStepStatus;
    if (!title || !STATUSES.includes(status)) return null;
    steps.push({
      index: typeof entry.index === 'number' ? entry.index : steps.length,
      title,
      status,
    });
  }
  const planId = typeof payload.plan_id === 'string'
    ? payload.plan_id
    : 'plan-unknown';
  const doneCount = steps.filter(step => step.status === 'completed').length;
  const active = steps.find(step => step.status === 'in_progress');
  return {
    planId,
    steps,
    activeStep: active ? active.index : null,
    doneCount,
    total: steps.length,
    ...(typeof payload.note === 'string' && payload.note
      ? { note: payload.note } : {}),
  };
}

/** 返回最近一条**生效**的计划；没有则 null。 */
export function scanLatestPlan(messages: readonly ChatMessage[]): AgentPlan | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const calls = extractAgentToolCalls(messages[index]);
    for (let cursor = calls.length - 1; cursor >= 0; cursor--) {
      const call = calls[cursor];
      if (call.name !== 'update_plan') continue;
      // 取消态/错误态不算生效：继续向前找（C4）。
      if (call.status !== 'completed') continue;
      const plan = readEnvelope(call.result);
      if (plan) return plan;
    }
  }
  return null;
}
