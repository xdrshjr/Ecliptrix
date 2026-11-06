import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types';
import type { SSEStreamManagerConfig } from '@/lib/video-editing-agent/SSEStreamManager';
import { useAgentExecution } from '../useAgentExecution';

const streams = vi.hoisted(() => ({ failStart: false, managers: [] as Array<{
  config: SSEStreamManagerConfig; isRunning: boolean;
}> }));
vi.mock('@/lib/video-editing-agent/SSEStreamManager', () => ({
  SSEStreamManager: class {
    isRunning = false;
    constructor(public config: SSEStreamManagerConfig) { streams.managers.push(this); }
    start() {
      if (streams.failStart) throw new Error('start failed');
      this.isRunning = true; return new Promise<void>(() => {});
    }
    cancel() { this.isRunning = false; }
  },
}));
vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations } = await import('@/lib/i18n');
  return { useLocale: () => ({ t: getTranslations('en') }) };
});
beforeEach(() => { streams.managers.length = 0; streams.failStart = false; });
afterEach(cleanup);

function setup() {
  const instanceToken = {};
  let epoch = 0;
  let activeId = 'A';
  const conversations: Conversation[] = ['A', 'B'].map(id => ({
    id, title: id, messages: [], createdAt: new Date(0), updatedAt: new Date(0),
  }));
  const writes = vi.fn();
  const hook = renderHook(() => useAgentExecution({
    conversations, activeConversationId: activeId, timelineState: null,
    setTimelineState: vi.fn(), materials: [], agentMode: true,
    setAgentMode: vi.fn(), updateConversationMessages: vi.fn(),
    getActiveConversationId: () => activeId,
    getConversation: id => conversations.find(item => item.id === id),
    captureWriteScope: conversationId => ({ instanceToken, conversationId,
      messagesEpoch: epoch }),
    isScopeValid: scope => scope.instanceToken === instanceToken
      && scope.messagesEpoch === epoch,
    writeScopedMessages: (scope, messages) => {
      if (scope.messagesEpoch !== epoch) return false;
      const conversation = conversations.find(item => item.id === scope.conversationId)!;
      conversation.messages = messages;
      writes(scope.conversationId, messages);
      return true;
    },
    canStartRequest: () => true,
  }));
  return { ...hook, conversations, writes,
    select: (id: string) => { activeId = id; hook.rerender(); },
    clear: () => { epoch++; conversations[0].messages = []; },
  };
}

describe('Agent 会话边界', () => {
  it('清空会话使旧错误的展示 owner 失效', async () => {
    const { result, clear, rerender } = setup();
    await act(async () => { await result.current.sendAgentMessage('A'); });
    await act(async () => {
      streams.managers[0].isRunning = false;
      streams.managers[0].config.onError({ type: 'unknown', message: '失败',
        retryable: false } as never);
    });
    act(() => result.current.acknowledgeTurnEnd(1));
    act(() => { clear(); rerender(); });
    expect(result.current.executionConversationId).toBeNull();
  });
  it('B 开始新回合时不认领 A 的上下文读数，也忽略 A 的迟到读数', async () => {
    const { result, select } = setup();
    await act(async () => { await result.current.sendAgentMessage('A'); });
    const first = streams.managers[0];
    const usage = { type: 'context_usage' as const, usedTokens: 999,
      windowTokens: 1000, maxOutputTokens: 100, dropped: false };
    await act(async () => first.config.onEvent(usage));
    expect(result.current.liveEvents.contextUsage?.usedTokens).toBe(999);
    await act(async () => {
      first.isRunning = false;
      first.config.onComplete();
    });
    act(() => result.current.acknowledgeTurnEnd(1));
    act(() => select('B'));
    await act(async () => { await result.current.sendAgentMessage('B'); });
    expect(result.current.liveEvents.contextUsage).toBeNull();
    await act(async () => first.config.onEvent(usage));
    expect(result.current.liveEvents.contextUsage).toBeNull();
  });

  it('接纳前启动异常释放锁并移除未接纳的消息，不制造结束事实', async () => {
    streams.failStart = true;
    const { result, conversations } = setup();
    await act(async () => {
      expect(await result.current.sendAgentMessage('failed'))
        .toEqual({ accepted: false, reason: 'start_failed' });
    });
    expect(result.current.isConversationBusy()).toBe(false);
    expect(result.current.lastTurnEnd).toBeNull();
    expect(conversations[0].messages).toEqual([]);
  });

  it('极快完成在首个展示 render 前也产生可确认的结束事实', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.sendAgentMessage('fast');
      const stream = streams.managers[0];
      stream.isRunning = false;
      stream.config.onComplete();
    });
    expect(result.current.lastTurnEnd).toMatchObject({
      conversationId: 'A', reason: 'completed', turnSeq: 1,
    });
    expect(result.current.isConversationBusy()).toBe(true);
    act(() => result.current.acknowledgeTurnEnd(1));
    expect(result.current.isConversationBusy()).toBe(false);
  });

  it('发送首个 await 前即锁定；start 后 render 前仍忙碌', async () => {
    const { result } = setup();
    await act(async () => {
      const pending = result.current.sendAgentMessage('hello');
      expect(result.current.isConversationBusy()).toBe(true);
      expect(await result.current.sendAgentMessage('duplicate'))
        .toMatchObject({ accepted: false });
      expect(await pending).toMatchObject({ accepted: true });
      expect(result.current.isConversationBusy()).toBe(true);
    });
    expect(streams.managers).toHaveLength(1);
    expect(result.current.executionConversationId).toBe('A');
  });

  it('终态后交接确认前仍锁定，停止回填消费恰一次', async () => {
    const { result } = setup();
    await act(async () => { await result.current.sendAgentMessage('hello'); });
    act(() => result.current.steering.submit('draft', 'queue'));
    await act(async () => result.current.cancelExecution());
    const restore = result.current.draftRestore!;
    expect(restore).toMatchObject({ conversationId: 'A', text: 'draft' });
    expect(result.current.isConversationBusy()).toBe(true);
    act(() => result.current.acknowledgeTurnEnd(result.current.lastTurnEnd!.turnSeq));
    expect(result.current.isConversationBusy()).toBe(true);
    act(() => result.current.consumeDraftRestore(restore.nonce));
    expect(result.current.isConversationBusy()).toBe(false);
    act(() => result.current.consumeDraftRestore(restore.nonce));
    expect(result.current.draftRestore).toBeNull();
  });

  it('清空消息后旧流的写入不能复活记录，切换隔离 owner', async () => {
    const { result, clear, conversations, writes, select } = setup();
    await act(async () => { await result.current.sendAgentMessage('hello'); });
    clear();
    writes.mockClear();
    await act(async () => {
      streams.managers[0].config.onEvent({ type: 'text_delta', content: 'late' });
      streams.managers[0].isRunning = false;
      streams.managers[0].config.onComplete();
    });
    expect(writes).not.toHaveBeenCalled();
    expect(conversations[0].messages).toEqual([]);
    act(() => result.current.acknowledgeTurnEnd(result.current.lastTurnEnd!.turnSeq));
    act(() => select('B'));
    expect(result.current.executionState.status).toBe('idle');
    expect(result.current.executionConversationId).toBeNull();
  });
});
