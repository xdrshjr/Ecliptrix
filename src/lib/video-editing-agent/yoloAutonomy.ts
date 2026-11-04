/**
 * 「不能停」的最后一公里：一次有界自动续跑的纯逻辑
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.6.3 / §4.6.5 / D-07）。
 *
 * 全部是纯函数与常量，便于用真值表逐条单测（AC-C6）。hook 只负责时机，
 * 判定只在这里——两处分开，才能证明"不续跑"是被条件否决的，而不是没触发。
 */

import type { AgentPlan } from '@/types/agentToolkit';
import type { LastAgentTurnEnd } from './types';

/** 每个「用户回合链」内最多自动续跑几次。 */
export const YOLO_CONTINUE_LIMIT = 1;

/**
 * 自动续跑发出去的那句话。它是一条**普通用户消息**（不进 SSE、不改协议），
 * 因此模型看到的是用户语气，不像系统注入；界面上另有 `yolo_continue` 标记，
 * 绝不假装是用户亲手打的字（§7.3）。
 */
export const YOLO_CONTINUE_PROMPT =
  '继续：把计划里剩下的步骤自己做完，不要提问；只报告结果与假设。';

export interface ShouldAutoContinueInput {
  /** 回合结束事实；null = 还没有回合结束过。 */
  lastTurnEnd: LastAgentTurnEnd | null;
  /** 该回合的计划（`scanLatestPlan` 的结果）；null/已完成都不续跑。 */
  plan: AgentPlan | null;
  /** 本用户回合链内已续跑次数。 */
  continueCount: number;
  /** 当前活动会话 id；与事实里的会话不一致即否决（评审 P2-06）。 */
  activeConversationId?: string | null;
}

/** 计划里还有没有未完成的步骤（C4 的客观依据）。 */
export function planHasOpenSteps(plan: AgentPlan | null): boolean {
  if (!plan || plan.steps.length === 0) return false;
  return plan.steps.some(step => step.status !== 'completed');
}

/**
 * 是否应当自动续跑一次。逐条对应 §4.6.3 的 C1–C5：
 *
 * - C1 `autonomy === 'yolo'`
 * - C2 正常完成，且 15s finishing 看门狗没有接管收尾
 * - C3 用户没在管（无插话/无排队），且 steering 没有自行发下一轮
 * - C4 绑定当前会话，且计划至少还有 1 个未完成步骤
 * - C5 本回合链内续跑次数 < 1
 */
export function shouldAutoContinue(input: ShouldAutoContinueInput): boolean {
  const end = input.lastTurnEnd;
  if (!end) return false;
  if (end.autonomy !== 'yolo') return false;
  if (end.reason !== 'completed' || end.finishingTimedOut) return false;
  if (end.steeredOrQueued || end.followUpSent) return false;
  if ((input.activeConversationId ?? null) !== end.conversationId) return false;
  if (input.continueCount >= YOLO_CONTINUE_LIMIT) return false;
  return planHasOpenSteps(input.plan);
}
