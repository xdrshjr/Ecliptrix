import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types';

/**
 * 自动续跑 hook 的时机与唯一发送者
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.6 / AC-C6 / AC-C8）。
 *
 * 关键回归：
 *   ① 没有回合结束事实（stream 仍在 executing/finishing）时一次都不发；
 *   ② 落回空闲且 completed 才发，且恰好一次；
 *   ③ steering 已发（followUpSent）时让位；
 *   ④ 同一个 lastTurnEnd 反复重渲染只发一次。
 */

const mocks = vi.hoisted(() => ({ scan: vi.fn() }));

vi.mock('@/lib/video-editing-agent/planScan', () => ({ scanLatestPlan: mocks.scan }));

import { useYoloAutoContinue, type UseYoloAutoContinueArgs } from '../useYoloAutoContinue';
import { YOLO_CONTINUE_PROMPT } from '@/lib/video-editing-agent/yoloAutonomy';
import type { LastAgentTurnEnd } from '@/lib/video-editing-agent/types';

const OPEN_PLAN = {
  planId: 'plan-1',
  steps: [
    { index: 0, title: 'a', status: 'completed' as const },
    { index: 1, title: 'b', status: 'pending' as const },
  ],
  activeStep: 1, doneCount: 1, total: 2,
};

const DONE_PLAN = { ...OPEN_PLAN, steps: [], total: 0, doneCount: 0, activeStep: null };

function end(patch: Partial<LastAgentTurnEnd> = {}): LastAgentTurnEnd {
  return {
    autonomy: 'yolo', reason: 'completed', finishingTimedOut: false,
    steeredOrQueued: false, followUpSent: false, endedWithAskUser: false,
    conversationId: 'conv-1', turnSeq: 1, ...patch,
  };
}

type AgentStub = UseYoloAutoContinueArgs['agent'];

function agentStub(fact: LastAgentTurnEnd | null = null): AgentStub {
  return { lastTurnEnd: fact, sendAgentMessage: vi.fn(async () => undefined) };
}

const agentMessage = {
  id: 'a1', role: 'assistant' as const, content: '完成', timestamp: new Date(),
  isAgentMessage: true,
};

function conversation(
  messages: Conversation['messages'] = [agentMessage],
  id = 'conv-1',
): Conversation {
  return {
    id, title: 't', messages, createdAt: new Date(), updatedAt: new Date(),
  } as Conversation;
}

function args(
  agent: AgentStub,
  overrides: Partial<UseYoloAutoContinueArgs> = {},
): UseYoloAutoContinueArgs {
  return { agent, yolo: true, conversation: conversation(), ...overrides };
}

function setup(initial: UseYoloAutoContinueArgs) {
  return renderHook((props: UseYoloAutoContinueArgs) => useYoloAutoContinue(props),
    { initialProps: initial });
}

/** Mount with no fact yet, then land the fact — the real turn-end ordering. */
async function mountThenEnd(fact: LastAgentTurnEnd, overrides: Partial<UseYoloAutoContinueArgs> = {}) {
  const agent = agentStub(null);
  const view = setup(args(agent, overrides));
  agent.lastTurnEnd = fact;
  view.rerender(args(agent, overrides));
  await waitFor(() => expect(mocks.scan).toHaveBeenCalled());
  return { view, agent };
}

beforeEach(() => {
  mocks.scan.mockReset().mockReturnValue(OPEN_PLAN);
});

describe('useYoloAutoContinue', () => {
  it('does nothing while the turn is not over (no fact yet)', () => {
    const agent = agentStub(null);
    setup(args(agent));
    expect(agent.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('sends exactly one "continue" once the turn ended idle and completed', async () => {
    const { agent } = await mountThenEnd(end());
    expect(agent.sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(agent.sendAgentMessage).toHaveBeenCalledWith(
      YOLO_CONTINUE_PROMPT, { automatic: 'yolo_continue' });
  });

  it('is idempotent: re-rendering the same fact sends nothing more', async () => {
    const fact = end();
    const { view, agent } = await mountThenEnd(fact);
    view.rerender(args(agent));
    view.rerender(args(agent));
    expect(agent.sendAgentMessage).toHaveBeenCalledTimes(1);
  });

  it('yields to steering (followUpSent) and to a user steer', async () => {
    const steering = await mountThenEnd(end({ followUpSent: true }));
    expect(steering.agent.sendAgentMessage).not.toHaveBeenCalled();
    const userSteer = await mountThenEnd(end({ steeredOrQueued: true }));
    expect(userSteer.agent.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('never continues for stop / error / watchdog / non-YOLO', async () => {
    for (const fact of [
      end({ reason: 'cancelled' }), end({ reason: 'error' }),
      end({ finishingTimedOut: true }), end({ autonomy: 'interactive' }),
    ]) {
      const { agent } = await mountThenEnd(fact);
      expect(agent.sendAgentMessage).not.toHaveBeenCalled();
    }
  });

  it('never continues when the plan is already complete', async () => {
    mocks.scan.mockReturnValue(DONE_PLAN);
    const { agent } = await mountThenEnd(end());
    expect(agent.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('never continues when YOLO is off', async () => {
    const agent = agentStub(end());
    setup(args(agent, { yolo: false }));
    expect(agent.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('never continues against another conversation (P2-06)', async () => {
    const agent = agentStub(null);
    const view = setup(args(agent));
    agent.lastTurnEnd = end();
    view.rerender(args(agent, { conversation: conversation([agentMessage], 'conv-2') }));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalled());
    expect(agent.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('refuses when the last message is not this turn\'s agent message', async () => {
    const agent = agentStub(end());
    setup(args(agent, {
      conversation: conversation([
        agentMessage,
        { id: 'u2', role: 'user', content: '我来说', timestamp: new Date() },
      ]),
    }));
    expect(agent.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('counts the continue once: a second turn end does not send again (AC-C6 ⑤)', async () => {
    const { view, agent } = await mountThenEnd(end({ turnSeq: 1 }));
    expect(agent.sendAgentMessage).toHaveBeenCalledTimes(1);
    agent.lastTurnEnd = end({ turnSeq: 2 });
    await act(async () => { view.rerender(args(agent)); });
    expect(agent.sendAgentMessage).toHaveBeenCalledTimes(1);
  });
});
