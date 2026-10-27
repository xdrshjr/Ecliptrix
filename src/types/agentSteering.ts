/**
 * 运行中插话（steer）与排队（queue）的前端类型。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.2.4。
 */

/**
 * - local：已输入，尚无 runId（思考阶段）或 SSE 重连后待补发
 * - sent：已提交服务端（202），等待当前工具结束后送达
 * - applied：已送达模型
 * - queued：转为「回合结束后发送」
 * - failed：被拒绝（如待送达已满），文本已放回输入框
 */
export type SteerStatus = 'local' | 'sent' | 'applied' | 'queued' | 'failed';

export interface SteerNote {
  /** steerId，`crypto.randomUUID().replace(/-/g, '')`。 */
  id: string;
  text: string;
  status: SteerStatus;
  createdAt: number;
  /** 仅 `applied` 有意义；null = 本回合开头送达。 */
  afterToolCallId?: string | null;
}

export interface QueuedFollowUp {
  id: string;
  text: string;
  createdAt: number;
}

/** 用户用 `@` 引用的素材。 */
export interface MaterialMention {
  materialId: string;
  label: string;
}

/**
 * Fields this feature adds to `ChatMessage`.
 *
 * Declared here by module augmentation instead of in `types/index.ts` because
 * that file is already past the 800-line limit and must not grow (spec AC-G2
 * ratchet). All three are optional, so old conversations read as "none".
 */
declare module './index' {
  interface ChatMessage {
    /** Notes the user added while this agent turn ran (agent message). */
    steers?: SteerNote[];
    /** Skill the user picked with `/` for this turn (user message). */
    skillId?: string;
    /** Materials the user referenced with `@` (user message). */
    mentions?: MaterialMention[];
  }
}
