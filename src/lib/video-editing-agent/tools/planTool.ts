import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { AgentPlan, PlanStep, PlanStepStatus } from '@/types/agentToolkit';
import { toolkitResult } from './toolkitAdapter';

/**
 * `update_plan`：显式执行计划（常驻工具，界面可见）。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.5.1。
 *
 * 计划**不落库、不加 ChatMessage 字段**：`turnState.plan` 只服务本轮，跨轮由
 * `planScan.scanLatestPlan()` 从最后一条 `update_plan` 工具记录派生。
 */

const DEFAULT_MAX_STEPS = 12;

const parameters = Type.Object({
  steps: Type.Array(Type.Object({
    title: Type.String({ minLength: 1, maxLength: 90,
      description: 'Short imperative step title.' }),
    status: Type.Optional(Type.Union([
      Type.Literal('pending'), Type.Literal('in_progress'),
      Type.Literal('completed'), Type.Literal('blocked')])),
  }), { minItems: 1, maxItems: 20,
    description: 'Ordered steps. At most one may be in_progress.' }),
  note: Type.Optional(Type.String({ maxLength: 200,
    description: 'Optional note shown above the list.' })),
});

type Params = Static<typeof parameters>;

const STATUSES: readonly PlanStepStatus[] =
  ['pending', 'in_progress', 'completed', 'blocked'];

/**
 * 确定性短哈希：同一 seed 永远得到同一个 8 位十六进制串（R-15 的 `plan-`/`q-` id）。
 *
 * 用纯 TS 的 FNV-1a 而不是 `node:crypto`：这两个工具在浏览器与 Node 两侧都会被
 * import（聊天卡片也会读同一份记录），运行时不保证有 `node:` 内置模块；而且
 * 这里只需要「确定性」，不需要密码学强度。
 */
export function stableHex(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // 再做一次混合，让长度相近的 seed 也不会撞在同一段前缀上。
  hash ^= Math.imul(seed.length, 0x9e3779b1) >>> 0;
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function planIdFor(steps: readonly PlanStep[]): string {
  return 'plan-' + stableHex(
    steps.map(step => `${step.title}\u001f${step.status}`).join('\u001e'));
}

/** 归一化：多个 `in_progress` 只保留第一个，其余降级为 `pending`。 */
export function normalizePlanSteps(
  raw: ReadonlyArray<{ title: string; status?: string }>,
  maxSteps = DEFAULT_MAX_STEPS,
): { steps: PlanStep[]; normalized: boolean } {
  let normalized = false;
  let seenInProgress = false;
  const steps: PlanStep[] = [];
  for (const item of raw) {
    const title = (item.title ?? '').trim();
    if (!title) {
      normalized = true;
      continue;
    }
    if (steps.length >= maxSteps) {
      normalized = true;
      break;
    }
    let status = (item.status ?? 'pending') as PlanStepStatus;
    if (!STATUSES.includes(status)) {
      status = 'pending';
      normalized = true;
    }
    if (status === 'in_progress') {
      if (seenInProgress) {
        status = 'pending';
        normalized = true;
      } else {
        seenInProgress = true;
      }
    }
    steps.push({ index: steps.length, title, status });
  }
  return { steps, normalized };
}

export function summarizePlan(
  planId: string, steps: readonly PlanStep[], note?: string,
): AgentPlan {
  const doneCount = steps.filter(step => step.status === 'completed').length;
  const active = steps.find(step => step.status === 'in_progress');
  return {
    planId,
    steps: [...steps],
    activeStep: active ? active.index : null,
    doneCount,
    total: steps.length,
    ...(note ? { note } : {}),
  };
}

export function createPlanTool(
  context: ToolContext,
  maxSteps = DEFAULT_MAX_STEPS,
): AgentTool<typeof parameters> {
  return {
    name: 'update_plan',
    label: 'Update Plan',
    description:
      'Publish or update the visible execution plan for a multi-step task (3+ steps). ' +
      'Call it once at the start, again whenever a step changes state, and a final time ' +
      'with every step completed. At most one step may be in_progress.',
    parameters,
    execute: async (_toolCallId: string, params: Params) => {
      if (params.steps.length > maxSteps) {
        return toolkitResult({
          success: false,
          error: 'invalid_argument',
          error_code: 'invalid_argument',
          next_step: `Reduce the plan to at most ${maxSteps} steps.`,
        });
      }
      const { steps, normalized } = normalizePlanSteps(params.steps, maxSteps);
      if (steps.length === 0) {
        return toolkitResult({
          success: false,
          error: 'invalid_argument',
          error_code: 'invalid_argument',
          next_step: 'Give every step a non-empty title.',
        });
      }
      const planId = planIdFor(steps);
      const plan = summarizePlan(planId, steps, params.note?.trim() || undefined);
      // 本轮权威状态；跨轮由 planScan 从工具记录派生。
      context.turnState.plan = plan;
      return toolkitResult({
        success: true,
        plan_id: planId,
        steps: plan.steps,
        active_step: plan.activeStep,
        done_count: plan.doneCount,
        total: plan.total,
        note: plan.note ?? null,
        normalized,
      });
    },
  };
}
