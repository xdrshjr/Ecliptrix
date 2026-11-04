/**
 * useAgentExecution — YOLO 接线
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.3 / §4.6 / AC-C6 / AC-C8）。
 *
 * 三个事实必须同时成立：
 *   ① 请求体带 `autonomy: 'yolo'`（缺省不带）；
 *   ② 自动续跑消息带 `metadata.type === 'yolo_continue'`；
 *   ③ `lastTurnEnd.steeredOrQueued / followUpSent` 在 `onTurnEnd` drain **之前**
 *      采样，且 YOLO 回合在 steering 已发送时让位（唯一发送者）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCallback, useState } from 'react';
import type { ChatMessage, Conversation, TimelineState } from '@/types';
import type { SSEStreamManagerConfig } from '@/lib/video-editing-agent/SSEStreamManager';
import { createDefaultAgentTimelineState } from '@/lib/video-editing-agent/defaultTimeline';
import { useAgentExecution } from '../useAgentExecution';

const streams = vi.hoisted(() => ({
  managers: [] as Array<{ config: SSEStreamManagerConfig; isRunning: boolean }>,
}));

vi.mock('@/lib/video-editing-agent/SSEStreamManager', () => ({
  SSEStreamManager: class {
    readonly config: SSEStreamManagerConfig;
    isRunning = false;
    constructor(config: SSEStreamManagerConfig) {
      this.config = config;
      streams.managers.push(this);
    }
    start(): Promise<void> {
      this.isRunning = true;
      return new Promise<void>(() => undefined);
    }
    cancel(): void {
      this.isRunning = false;
    }
  },
}));

vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations } = await import('@/lib/i18n');
  const t = getTranslations('en');
  return { useLocale: () => ({ locale: 'en', setLocale: () => undefined, t }) };
});

function renderAgent(initial: { yolo?: boolean } = {}) {
  const writes: ChatMessage[][] = [];
  // `initialProps` 让用例能在挂载**之后**再打开开关——真实用户就是这样用的，
  // 也正是 `sendAgentMessage` 闭包陈旧（P0）会暴露的地方。
  const hook = renderHook((props: { yolo?: boolean }) => {
    const [timelineState, setTimelineState] = useState<TimelineState | null>(
      () => createDefaultAgentTimelineState());
    const [conversations, setConversations] = useState<Conversation[]>(() => [{
      id: 'c1', title: 'Chat', messages: [], createdAt: new Date(0), updatedAt: new Date(0),
    }]);
    const updateConversationMessages = useCallback(
      (conversationId: string, messages: ChatMessage[]) => {
        writes.push(messages);
        setConversations(previous =>
          previous.map(c => (c.id === conversationId ? { ...c, messages } : c)));
      },
      [],
    );
    const agent = useAgentExecution({
      conversations, updateConversationMessages, activeConversationId: 'c1',
      timelineState, setTimelineState, materials: [],
      agentMode: true, setAgentMode: () => undefined,
      yolo: props.yolo,
    });
    return { agent };
  }, { initialProps: initial });
  return { ...hook, writes };
}

async function startTurn(result: ReturnType<typeof renderAgent>['result'],
  options?: { automatic?: 'yolo_continue' }) {
  await act(async () => {
    await result.current.agent.sendAgentMessage('做一条 60 秒资讯视频', options);
  });
  return streams.managers[streams.managers.length - 1];
}

function completeStream(stream: { config: SSEStreamManagerConfig; isRunning: boolean }) {
  stream.config.onComplete();
  stream.isRunning = false;
}

beforeEach(() => {
  streams.managers.length = 0;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAgentExecution — YOLO', () => {
  it('sends autonomy: "yolo" only when the switch is on', async () => {
    const yolo = renderAgent({ yolo: true });
    const stream = await startTurn(yolo.result);
    expect((stream.config.body as { autonomy?: string }).autonomy).toBe('yolo');

    const interactive = renderAgent();
    const plain = await startTurn(interactive.result);
    expect((plain.config.body as { autonomy?: string }).autonomy).toBeUndefined();
  });

  it('picks up a switch turned on after mount (no stale closure)', async () => {
    // 真实顺序：面板先挂载（yolo=false），用户再点开关，然后才发任务。
    // 若 `sendAgentMessage` 的依赖数组漏了 `yolo`，它的闭包里永远是 false，
    // 请求体就不带 `autonomy` —— 整个全自动模式"看着正常但从不生效"。
    const { result, rerender } = renderAgent();
    const before = await startTurn(result);
    expect((before.config.body as { autonomy?: string }).autonomy).toBeUndefined();

    // 第一回合必须先正常收尾，否则发送守卫会拦住第二次发送。
    await act(async () => {
      completeStream(before);
      await vi.advanceTimersByTimeAsync(50);
    });
    rerender({ yolo: true });
    const after = await startTurn(result);
    expect((after.config.body as { autonomy?: string }).autonomy).toBe('yolo');
  });

  it('marks an automatic turn with metadata.type = yolo_continue (AC-C7)', async () => {
    const { result, writes } = renderAgent({ yolo: true });
    await startTurn(result, { automatic: 'yolo_continue' });
    const userMessage = writes[writes.length - 1]
      .find(message => message.role === 'user');
    expect(userMessage?.metadata?.type).toBe('yolo_continue');
  });

  it('exposes the turn-end fact only after the turn really ended', async () => {
    const { result } = renderAgent({ yolo: true });
    const stream = await startTurn(result);
    expect(result.current.agent.lastTurnEnd).toBeNull();
    await act(async () => {
      completeStream(stream);
      await vi.advanceTimersByTimeAsync(50);
    });
    const fact = result.current.agent.lastTurnEnd;
    expect(fact).toMatchObject({
      autonomy: 'yolo', reason: 'completed', finishingTimedOut: false,
      steeredOrQueued: false, followUpSent: false, conversationId: 'c1',
    });
    expect(fact?.turnSeq).toBe(1);
  });

  it('samples steeredOrQueued before steering drains the queue (P1-1 / AC-C8)', async () => {
    const { result } = renderAgent({ yolo: true });
    const stream = await startTurn(result);
    // Alt+Enter queue while the turn runs.
    await act(async () => {
      result.current.agent.steering.submit('顺便把 BGM 调低', 'queue');
    });
    expect(result.current.agent.steering.queued).toHaveLength(1);
    await act(async () => {
      completeStream(stream);
      await vi.advanceTimersByTimeAsync(50);
    });
    // The fact still says "the user was steering", even though onTurnEnd has
    // already drained the queue and sent the follow-up.
    expect(result.current.agent.lastTurnEnd?.steeredOrQueued).toBe(true);
    expect(result.current.agent.lastTurnEnd?.followUpSent).toBe(true);
    expect(result.current.agent.steering.queued).toHaveLength(0);
  });

  it('marks a cancelled turn as such and leaves followUpSent false', async () => {
    const { result } = renderAgent({ yolo: true });
    await startTurn(result);
    await act(async () => {
      result.current.agent.cancelExecution();
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.agent.lastTurnEnd?.reason).toBe('cancelled');
    expect(result.current.agent.lastTurnEnd?.followUpSent).toBe(false);
  });
});
