import { describe, expect, it } from 'vitest';
import type { AgentPlan } from '@/types/agentToolkit';
import type { LastAgentTurnEnd } from '../types';
import {
  YOLO_CONTINUE_LIMIT,
  YOLO_CONTINUE_PROMPT,
  planHasOpenSteps,
  shouldAutoContinue,
} from '../yoloAutonomy';

/**
 * 自动续跑真值表（docs/plans/agent-yolo-autonomous-mode spec.md §4.6.3 /
 * AC-C6）。每一条否决都必须单独可证：只有一条为假就不发。
 */

const OPEN_PLAN: AgentPlan = {
  planId: 'plan-1',
  steps: [
    { index: 0, title: '搜素材', status: 'completed' },
    { index: 1, title: '上轨', status: 'pending' },
  ],
  activeStep: 1,
  doneCount: 1,
  total: 2,
};

const DONE_PLAN: AgentPlan = {
  planId: 'plan-2',
  steps: [{ index: 0, title: '搜素材', status: 'completed' }],
  activeStep: null,
  doneCount: 1,
  total: 1,
};

function end(patch: Partial<LastAgentTurnEnd> = {}): LastAgentTurnEnd {
  return {
    autonomy: 'yolo',
    reason: 'completed',
    finishingTimedOut: false,
    steeredOrQueued: false,
    followUpSent: false,
    endedWithAskUser: false,
    conversationId: 'conv-1',
    turnSeq: 1,
    ...patch,
  };
}

function decide(
  lastTurnEnd: LastAgentTurnEnd | null = end(),
  plan: AgentPlan | null = OPEN_PLAN,
  continueCount = 0,
  activeConversationId: string | null = 'conv-1',
): boolean {
  return shouldAutoContinue({ lastTurnEnd, plan, continueCount, activeConversationId });
}

describe('planHasOpenSteps', () => {
  it('只有 blocked 时不空转续跑', () => {
    expect(planHasOpenSteps({ ...OPEN_PLAN,
      steps: [{ index: 0, title: '待手动导出', status: 'blocked' }],
    })).toBe(false);
  });
  it('is false for a missing or empty plan and true with a pending step', () => {
    expect(planHasOpenSteps(null)).toBe(false);
    expect(planHasOpenSteps(DONE_PLAN)).toBe(false);
    expect(planHasOpenSteps(OPEN_PLAN)).toBe(true);
  });
});

describe('shouldAutoContinue', () => {
  it('continues exactly once in the normal case', () => {
    expect(decide()).toBe(true);
    expect(decide(end(), OPEN_PLAN, YOLO_CONTINUE_LIMIT)).toBe(false);
  });

  it('C1 — never continues outside YOLO', () => {
    expect(decide(end({ autonomy: 'interactive' }))).toBe(false);
  });

  it('C2 — refuses cancelled, error and watchdog-timed-out turns', () => {
    expect(decide(end({ reason: 'cancelled' }))).toBe(false);
    expect(decide(end({ reason: 'error' }))).toBe(false);
    expect(decide(end({ finishingTimedOut: true }))).toBe(false);
  });

  it('C3 — yields to the user (steer/queue) and to steering as sole sender', () => {
    expect(decide(end({ steeredOrQueued: true }))).toBe(false);
    expect(decide(end({ followUpSent: true }))).toBe(false);
  });

  it('C4 — refuses another conversation and a finished plan', () => {
    expect(decide(end(), OPEN_PLAN, 0, 'conv-2')).toBe(false);
    expect(decide(end({ conversationId: null }), OPEN_PLAN, 0, null)).toBe(true);
    expect(decide(end(), DONE_PLAN)).toBe(false);
    expect(decide(end(), null)).toBe(false);
  });

  it('keeps the continue prompt question-free and single-shot', () => {
    // AC-C7 的正文一致性由 `useYoloAutoContinue.test.tsx`（调用参数）与
    // `useAgentExecution.yolo.test.ts`（metadata）钉住；这里只钉这条文案本身
    // 不得反过来索要确认，否则续跑等于把"停下问人"又发了一遍。
    expect(YOLO_CONTINUE_PROMPT).toContain('继续');
    expect(YOLO_CONTINUE_PROMPT).toContain('不要提问');
    expect(YOLO_CONTINUE_LIMIT).toBe(1);
  });
});
