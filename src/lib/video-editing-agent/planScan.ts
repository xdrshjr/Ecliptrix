/**
 * planScan.ts — 从历史里恢复「最后一次生效的计划」。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.5.1。
 *
 * 计划不落库、不写 `ChatMessage` 新字段：它完全由既有的
 * `AgentToolCallRecord` 派生（与 `scanExploredCategories` 同一模式）。
 *
 * 取数规则（评审 C4 钉死）：
 *   - 恢复成功计划，以及明确 `plan_applied` 的 `delivery_incomplete` 信封；
 *   - 取消、未生效或其他错误记录继续向前找；
 *   - 全都没有 → 返回 `null`（不注入 `## 当前计划`）。
 * 绝不用 `params` 猜状态——那会把「没生效的计划」显示成已生效。
 *
 * Pure — no side effects.
 */
import type { ChatMessage } from '@/types';
import type { AgentPlan, EditingGoal, EditingDeliverable, PlanStep, PlanStepStatus } from '@/types/agentToolkit';
import { extractAgentToolCalls } from './historyScan';

const STATUSES: readonly PlanStepStatus[] =
  ['pending', 'in_progress', 'completed', 'blocked'];
const DELIVERABLES = ['editing', 'bgm', 'export', 'inspection'] as const;
const NEW_TASK = /^(?:请|帮我|麻烦)?\s*(?:新任务|重新开始|new task\b|start over\b)/i;
const NEW_VIDEO = /^(?:(?:请|帮我|给我|麻烦)\s*|please\s+)*(?:(?:另(?:外)?|再)?(?:剪辑|制作|做|剪)一个|(?:create|make|edit|produce)\s+(?:another|a new|an?)\b)/i;
const MEDIA_SUBTASK = /封面|字幕轨|音轨|脚本|文案|方案|\b(?:cover|subtitle track|audio track|script|outline|plan)\b/i;

function startsNewTask(text: string): boolean {
  if (NEW_TASK.test(text)) return true;
  const firstClause = text.split(/[，,。！？!?;；]/, 1)[0];
  return NEW_VIDEO.test(text) && /视频|短片|video|film|clip/i.test(firstClause)
    && !MEDIA_SUBTASK.test(firstClause);
}

/** 普通任务也有身份，避免“新任务”没有时长时继承上一任务的失败预算。 */
export function resolveTaskMessageId(messages: readonly ChatMessage[]): string | undefined {
  let id: string | undefined;
  for (const message of messages) {
    if (message.role === 'user' && (!id || startsNewTask(message.content.trim()))) id = message.id;
  }
  return id;
}

/** 只解释当前用户指令；旧的“重试”不能永久清空后续失败。 */
export function readExplicitRecoveryRetry(messages: readonly ChatMessage[]) {
  const latest = messages[messages.length - 1];
  const text = latest?.role === 'user' ? latest.content : '';
  const retry = /重试|重新尝试|再试(?:一次)?|retry|try again/i.test(text)
    && !/(?:不要|别|停止|禁止|do not|don't).{0,12}(?:重试|重新尝试|再试|retry|try again)/i.test(text);
  return {
    video: retry && /视频|生视频|video/i.test(text) && /生成|生视频|generat/i.test(text),
    image: retry && /图|image/i.test(text) && /生成|生图|generat/i.test(text),
    egress: retry && /下载|download|读取网页|fetch/i.test(text),
  };
}

export function readEditingGoal(value: unknown): EditingGoal | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const goal = value as EditingGoal;
  if (typeof goal.taskId !== 'string' || !goal.taskId
    || typeof goal.sourceMessageId !== 'string' || !goal.sourceMessageId
    || !Number.isFinite(goal.targetDurationSeconds) || goal.targetDurationSeconds <= 0
    || !Number.isFinite(goal.fps) || goal.fps <= 0
    || !Array.isArray(goal.commitments)
    || goal.commitments.some(kind => !DELIVERABLES.includes(kind))) return undefined;
  return {
    taskId: goal.taskId, sourceMessageId: goal.sourceMessageId,
    targetDurationSeconds: goal.targetDurationSeconds, fps: goal.fps,
    commitments: Array.from(new Set(goal.commitments)),
    ...(typeof goal.projectId === 'string' ? { projectId: goal.projectId } : {}),
    ...(typeof goal.conversationId === 'string' ? { conversationId: goal.conversationId } : {}),
  };
}

function hasAppliedPlan(call: ReturnType<typeof extractAgentToolCalls>[number]): boolean {
  if (call.name !== 'update_plan' || !call.result || typeof call.result !== 'object') return false;
  const result = call.result as Record<string, unknown>;
  return (call.status === 'completed' && result.success === true)
    || (call.status === 'error' && result.error_code === 'delivery_incomplete'
      && result.plan_applied === true);
}

/** A number in a research question or a clip timestamp is not a film target. */
function readInitialDuration(text: string): RegExpMatchArray | null {
  const creation = /^(?:(?:请|帮我|给我|麻烦)\s*|please\s+)*(?:(?:另(?:外)?|再)?(?:剪辑|制作|生成|做|剪)|create\b|make\b|edit\b|produce\b)/i;
  const request = text.replace(/^(?:新任务|new task)\s*[:：]\s*/i, '');
  if (!creation.test(request)) return null;
  const firstClause = text.split(/[，,。！？!?;；]/, 1)[0];
  if (MEDIA_SUBTASK.test(firstClause)) return null;
  const duration = text.match(/(?:^|[^\d.])(-?\d+(?:\.\d+)?)\s*(秒|分钟|seconds?|secs?|s\b|minutes?|mins?\b)/i);
  if (!duration) return null;
  const prefix = text.slice(0, duration.index! + 1)
    .split(/[，,。！？!?;；]/).pop() ?? '';
  if (/第\s*$|\b(?:at|after|before)\s*$|镜头|片段|旁白|字幕|\b(?:scene|shot|narration|subtitle)\b/i.test(prefix)) return null;
  return duration;
}

function isAffirmativeDuration(text: string, match: RegExpMatchArray): boolean {
  const textRequest = /^(?:(?:请|帮我|给我|麻烦)\s*|please\s+)*(?:写|撰写|解释|研究|搜索|查找|总结|write\b|draft\b|explain\b|research\b|summarize\b|search\b|find\b)/i;
  if (textRequest.test(text)) return false;
  const prefix = text.slice(0, match.index).split(/[，,。！？!?;；]/).pop() ?? '';
  return !/(?:不要|别|不想|无需|禁止|\b(?:do not|don't|never)\b)/i.test(prefix);
}

/** 保守提取明确数字时长，不从计划标题/模型叙述猜目标。导出当前固定 30fps。 */
export function resolveEditingGoal(
  messages: readonly ChatMessage[],
  scope: { projectId?: string; conversationId?: string } = {},
): EditingGoal | undefined {
  let goal: EditingGoal | undefined;
  let taskId: string | undefined;
  for (const message of messages) {
    for (const call of extractAgentToolCalls(message)) {
      if (!hasAppliedPlan(call)) continue;
      const saved = readEditingGoal((call.result as Record<string, unknown>).editing_goal);
      if (saved && saved.projectId === scope.projectId
        && saved.conversationId === scope.conversationId
        && (!taskId || saved.taskId === taskId)) { goal = saved; taskId = saved.taskId; }
    }
    if (message.role !== 'user') continue;
    const text = message.content.trim();
    const newTask = startsNewTask(text);
    if (newTask) { goal = undefined; taskId = message.id; }
    const explicitTotal = text.match(/(?:总时长|总长|整片时长|目标时长|total duration)\s*(?:改为|改成|调整为|是|为|=|到|:|：|to|is)?\s*(-?\d+(?:\.\d+)?)\s*(秒|分钟|seconds?|secs?|s\b|minutes?|mins?\b)/i);
    const amendment = text.match(/^(?:请)?(?:改为|改成|调整为|缩短至|延长至|make it|change duration to)\s*(-?\d+(?:\.\d+)?)\s*(秒|分钟|seconds?|secs?|s\b|minutes?|mins?\b)/i);
    const duration = explicitTotal ?? amendment ?? (!goal
      ? readInitialDuration(text) : null);
    const isEditing = /视频|短片|剪辑|video|film|clip/i.test(text);
    if (!duration || !isAffirmativeDuration(text, duration)
      || (!isEditing && !goal)) continue;
    const target = Number(duration[1]) * (/分钟|minute|min/i.test(duration[2]) ? 60 : 1);
    if (!Number.isFinite(target) || target <= 0) continue;
    goal = {
      ...scope, taskId: goal?.taskId ?? message.id, sourceMessageId: message.id,
      targetDurationSeconds: target, fps: 30,
      commitments: goal?.commitments ?? ['editing'],
    };
    taskId = goal.taskId;
  }
  return goal;
}

function readEnvelope(result: unknown): AgentPlan | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as Record<string, unknown>;
  if (payload.success !== true && !(payload.error_code === 'delivery_incomplete'
    && payload.plan_applied === true)) return null;
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
      ...(DELIVERABLES.includes(entry.deliverable as EditingDeliverable)
        ? { deliverable: entry.deliverable as EditingDeliverable } : {}),
      ...(Array.isArray(entry.materialIds)
        ? { materialIds: entry.materialIds.filter((id): id is string => typeof id === 'string') } : {}),
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
    ...(readEditingGoal(payload.editing_goal)
      ? { editingGoal: readEditingGoal(payload.editing_goal) } : {}),
    ...(typeof payload.note === 'string' && payload.note
      ? { note: payload.note } : {}),
  };
}

/** 返回最近一条**生效**的计划；没有则 null。 */
export function scanLatestPlan(messages: readonly ChatMessage[], goal?: EditingGoal): AgentPlan | null {
  const taskId = goal?.taskId ?? resolveTaskMessageId(messages);
  const boundary = taskId ? Math.max(0, messages.findIndex(message => message.id === taskId)) : 0;
  for (let index = messages.length - 1; index >= boundary; index--) {
    const calls = extractAgentToolCalls(messages[index]);
    for (let cursor = calls.length - 1; cursor >= 0; cursor--) {
      const call = calls[cursor];
      if (!hasAppliedPlan(call)) continue;
      const plan = readEnvelope(call.result);
      if (goal && (plan?.editingGoal?.taskId !== goal.taskId
        || plan.editingGoal.projectId !== goal.projectId
        || plan.editingGoal.conversationId !== goal.conversationId)) continue;
      if (plan) return plan;
    }
  }
  return null;
}

export interface ActiveStep {
  /** 1-based，给人看的步骤序号。 */
  index: number;
  total: number;
  title: string;
}

/**
 * 忙碌条要显示的「步骤 i/n · 标题」：优先 `in_progress` 的那一步，没有则取第一个
 * 未完成的；全部完成或没有计划时返回 null（调用方回退为「正在运行 xxx 工具」）。
 */
export function selectActiveStep(plan: AgentPlan | null | undefined): ActiveStep | null {
  if (!plan || plan.steps.length === 0) return null;
  const current = plan.activeStep !== null
    ? plan.steps.find(step => step.index === plan.activeStep)
    : plan.steps.find(step => step.status !== 'completed');
  if (!current) return null;
  return {
    index: plan.steps.indexOf(current) + 1,
    total: plan.total,
    title: current.title,
  };
}
