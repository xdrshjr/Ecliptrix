import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { AgentPlan, EditingDeliverable, PlanStep, PlanStepStatus } from '@/types/agentToolkit';
import { toolkitResult } from './toolkitAdapter';
import { lintTimeline } from './qualityLint';
import { readEditingGoal } from '../planScan';
import { isTrackRendered } from '@/components/video/timeline/infrastructure/renderableTimeline';

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
    deliverable: Type.Optional(Type.Union([
      Type.Literal('editing'), Type.Literal('bgm'),
      Type.Literal('export'), Type.Literal('inspection'),
    ], { description: 'Editing commitment.' })),
    material_ids: Type.Optional(Type.Array(Type.String(), {
      description: 'Downloaded BGM ids on audible tracks.',
    })),
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
  raw: ReadonlyArray<{ title: string; status?: string;
    deliverable?: EditingDeliverable; material_ids?: string[] }>,
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
    steps.push({ index: steps.length, title, status,
      ...(item.deliverable ? { deliverable: item.deliverable } : {}),
      ...(item.material_ids ? { materialIds: item.material_ids } : {}),
    });
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
      'Update a multi-step plan. Declare editing deliverables; completion needs evidence. '
      + 'Keep blocked work blocked. At most one in_progress step.',
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
      const failures = checkEditingDelivery(context, steps);
      const planId = planIdFor(steps);
      const plan = summarizePlan(planId, steps, params.note?.trim() || undefined);
      if (context.turnState.editingGoal) plan.editingGoal = context.turnState.editingGoal;
      // 本轮权威状态；跨轮由 planScan 从工具记录派生。
      context.turnState.plan = plan;
      return toolkitResult({
        success: failures.length === 0,
        ...(failures.length ? {
          error_code: 'delivery_incomplete',
          plan_applied: true,
          failureClass: 'validation',
          error_details: { failure_class: 'validation', retryable: false },
          next_step: failures.join(' '),
        } : {}),
        plan_id: planId,
        steps: plan.steps,
        active_step: plan.activeStep,
        done_count: plan.doneCount,
        total: plan.total,
        note: plan.note ?? null,
        normalized,
        ...(plan.editingGoal ? { editing_goal: plan.editingGoal } : {}),
      });
    },
  };
}

/** 只约束有用户目标的编辑计划；不从自然语言标题推断交付类型。 */
function checkEditingDelivery(context: ToolContext, steps: PlanStep[]): string[] {
  const goal = context.turnState.editingGoal;
  if (!goal) return [];
  if (!readEditingGoal(goal)) {
    steps.forEach(step => { if (step.status === 'completed') step.status = 'blocked'; });
    return ['编辑目标必须有有效来源及有限正数时长/帧率。'];
  }
  const previous = context.turnState.plan;
  goal.commitments = Array.from(new Set([...goal.commitments,
    ...steps.flatMap(step => step.deliverable ? [step.deliverable] : [])]));
  const requestedComplete = steps.every(step => step.status === 'completed');
  const failures: string[] = [];
  for (const kind of goal.commitments) {
    let step = steps.find(item => item.deliverable === kind);
    if (!step) {
      const old = previous?.steps.find(item => item.deliverable === kind);
      step = { ...old, index: steps.length, title: old?.title ?? `交付：${kind}`,
        deliverable: kind, status: requestedComplete ? 'completed' : old?.status ?? 'pending' };
      steps.push(step);
    }
    if (step.status !== 'completed') continue;
    const problem = deliveryProblem(context, kind, step.materialIds);
    if (problem) { step.status = 'blocked'; failures.push(problem); }
  }
  return failures;
}

function deliveryProblem(context: ToolContext, kind: EditingDeliverable, ids?: string[]): string | undefined {
  if (kind === 'export' || kind === 'inspection') {
    return '当前没有绑定本项目和当前编辑版本的导出完成回执；保留 blocked，并交接编辑器导出/检查。';
  }
  if (kind === 'bgm') {
    const audible = context.timelineState.tracks.filter(track => track.type === 'audio'
      && isTrackRendered(track) && track.volume > 0).flatMap(track => track.items);
    const verified = ids?.length && ids.every(id => audible.some(item => item.materialId === id
      && (item.volume ?? 1) > 0) && context.materials.some(material => material.id === id
      && material.type === 'audio' && !id.startsWith('tts-')
      && (!!material.cacheUrl || !!material.storageKey
        || (typeof material.url === 'string' && material.url.startsWith('/api/storage/files/')))));
    return verified ? undefined : 'BGM 尚无已下载且实际落在可听音轨的素材证据；保留 blocked，说明纯旁白降级。';
  }
  const usedIds = new Set(context.timelineState.tracks
    .filter(isTrackRendered)
    .flatMap(track => track.items.map(item => item.materialId)));
  if (context.materials.some(material => usedIds.has(material.id)
    && material.metadata?.candidate === true && material.metadata?.materialized !== true)) {
    return '当前使用的搜索候选尚无下载回执；下载并使用实际素材后再完成编辑验收。';
  }
  const report = lintTimeline({ timelineState: context.timelineState,
    materials: context.materials, targetWidth: 1920, targetHeight: 1080,
    targetDurationSeconds: context.turnState.editingGoal!.targetDurationSeconds,
    fps: context.turnState.editingGoal!.fps });
  return report.ok ? undefined : `编辑验收未通过：${report.issues
    .filter(issue => issue.severity === 'blocker').map(issue => issue.code).join(', ')}。`;
}
