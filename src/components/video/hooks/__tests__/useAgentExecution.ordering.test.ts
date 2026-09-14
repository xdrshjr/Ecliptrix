/**
 * useAgentExecution — event ordering (AG-03), terminal track patches (AG-02)
 * and restart handling (AG-01). The SSE transport is replaced by a fake whose
 * config callbacks the tests drive directly; the applier, router and state
 * manager are real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCallback, useState } from 'react';
import type { ChatMessage, Conversation, MaterialItem, TimelineItem, TimelineState } from '@/types';
import type { SSEStreamManagerConfig } from '@/lib/video-editing-agent/SSEStreamManager';
import type { AgentOperation, SSEEvent } from '@/lib/video-editing-agent/types';
import { AgentEventRouter } from '@/lib/video-editing-agent/AgentEventRouter';
import { StreamErrorType } from '@/lib/video-editing-agent/errorRecovery';
import { useAgentExecution } from '../useAgentExecution';
import { FINISHING_WATCHDOG_MS } from '../useAgentExecutionState';

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
      // Never settles: tests end the stream through the config callbacks.
      return new Promise<void>(() => undefined);
    }
    cancel(): void {
      this.isRunning = false;
    }
  },
}));

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: {
      agentUndo: { conflict: 'conflict', notUndoable: 'not undoable', blockedWhileRunning: 'blocked' },
      agentApply: { finishingTimedOut: 'timed out' },
    },
  }),
}));

const DELETE_A: AgentOperation = { type: 'delete_clip', clipId: 'a', trackId: 'v1' };
const MOVE_B_TO_START: AgentOperation = {
  type: 'move_clip', clipId: 'b', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: 0,
};

function clip(id: string, startTime: number, duration: number): TimelineItem {
  return {
    id, name: id, type: 'video', startTime, duration, trackId: 'v1', color: '#000',
    clipStart: 0, clipEnd: duration, originalDuration: 10, volume: 1,
  };
}

function twoClipTimeline(): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 8,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [{
      id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false, isMuted: false,
      isVisible: true, volume: 100, order: 0, items: [clip('a', 0, 5), clip('b', 5, 3)],
    }],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

function renderAgent(
  options: {
    onNotification?: (type: string, message: string) => void;
    materials?: MaterialItem[];
  } = {},
) {
  const writes: ChatMessage[][] = [];
  const hook = renderHook(() => {
    const [timelineState, setTimelineState] = useState<TimelineState | null>(twoClipTimeline);
    const [conversations, setConversations] = useState<Conversation[]>(() => [
      { id: 'c1', title: 'Chat', messages: [], createdAt: new Date(0), updatedAt: new Date(0) },
    ]);
    const updateConversationMessages = useCallback(
      (conversationId: string, messages: ChatMessage[]) => {
        writes.push(messages);
        setConversations(previous =>
          previous.map(c => (c.id === conversationId ? { ...c, messages } : c)),
        );
      },
      [],
    );
    const agent = useAgentExecution({
      conversations,
      updateConversationMessages,
      activeConversationId: 'c1',
      timelineState,
      setTimelineState,
      materials: options.materials ?? [],
      agentMode: true,
      setAgentMode: () => undefined,
      onNotification: options.onNotification,
    });
    return { agent, timelineState };
  });
  return { ...hook, writes };
}

type AgentHookResult = ReturnType<typeof renderAgent>['result'];

async function startTurn(result: AgentHookResult) {
  await act(async () => {
    await result.current.agent.sendAgentMessage('tidy up the timeline');
  });
  return streams.managers[streams.managers.length - 1];
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function lastAgentMessage(writes: ChatMessage[][]): ChatMessage {
  const messages = writes[writes.length - 1];
  return messages[messages.length - 1];
}

/** Completes the stream the way the real manager does: onComplete, then no longer running. */
function completeStream(stream: { config: SSEStreamManagerConfig; isRunning: boolean }): void {
  stream.config.onComplete();
  stream.isRunning = false;
}

function toolResult(toolCallId: string, operation: AgentOperation): SSEEvent {
  return {
    type: 'tool_result', toolCallId, toolName: operation.type,
    result: { success: true }, operation,
  };
}

beforeEach(() => {
  streams.managers.length = 0;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAgentExecution — serialised events and terminal patches', () => {
  it('applies tool results in arrival order when delete_clip precedes move_clip', async () => {
    const { result } = renderAgent();
    const stream = await startTurn(result);

    act(() => {
      // delete_clip waits for its animation; move_clip must not overtake it,
      // or the move collides with clip a and gets packed to 5 s.
      stream.config.onEvent(toolResult('tc-delete', DELETE_A));
      stream.config.onEvent(toolResult('tc-move', MOVE_B_TO_START));
    });
    await advance(100);

    const items = result.current.timelineState?.tracks[0].items ?? [];
    expect(items.map(i => [i.id, i.startTime])).toEqual([['b', 0]]);
  });

  it('finalizes only after the event chain drains', async () => {
    const { result, writes } = renderAgent();
    const stream = await startTurn(result);

    act(() => {
      stream.config.onEvent(toolResult('tc-delete', DELETE_A));
      stream.config.onComplete();
    });
    const streamingBeforeDrain = lastAgentMessage(writes).isStreaming;
    await advance(100);

    expect(streamingBeforeDrain).toBe(true);
    expect(lastAgentMessage(writes)).toMatchObject({
      isStreaming: false,
      timelineTrackPatches: [expect.objectContaining({ trackId: 'v1' })],
    });
  });

  it('onRestart clears the partial agent message', async () => {
    const { result, writes } = renderAgent();
    const stream = await startTurn(result);

    act(() => stream.config.onEvent({ type: 'text_delta', content: 'partial answer' }));
    await advance(20);
    const shownBeforeRestart = lastAgentMessage(writes).content;
    act(() => stream.config.onRestart?.(1));
    await advance(20);

    expect(shownBeforeRestart).toBe('partial answer');
    expect(lastAgentMessage(writes).content).toBe('');
    expect(result.current.agent.executionState.pendingMessage).toBe('');
  });

  it.each(['cancelled', 'errored'] as const)(
    'cancelled and errored turns still record timelineTrackPatches (%s)',
    async (ending) => {
      const { result, writes } = renderAgent();
      const stream = await startTurn(result);
      act(() => stream.config.onEvent(toolResult('tc-delete', DELETE_A)));
      await advance(100);

      act(() => {
        if (ending === 'cancelled') {
          result.current.agent.cancelExecution();
        } else {
          stream.config.onError({
            type: StreamErrorType.NETWORK_DROP,
            message: 'socket closed',
            userMessage: 'connection lost',
            recoverable: false,
          });
        }
      });
      await advance(100);

      expect(lastAgentMessage(writes).timelineTrackPatches)
        .toEqual([expect.objectContaining({ trackId: 'v1' })]);
    },
  );

  it('undo turn still reverts the turn after one of its steps was undone', async () => {
    const onNotification = vi.fn();
    const { result, writes } = renderAgent({ onNotification });
    const stream = await startTurn(result);
    act(() => {
      stream.config.onEvent(toolResult('tc-delete', DELETE_A));
      stream.config.onEvent(toolResult('tc-move', MOVE_B_TO_START));
      stream.config.onComplete();
    });
    await advance(100);
    const messageId = lastAgentMessage(writes).id;

    act(() => result.current.agent.undoSingleOperation(messageId, 'tc-move'));
    act(() => result.current.agent.undoAllOperations(messageId));

    expect(onNotification).not.toHaveBeenCalledWith('error', expect.anything());
    expect(result.current.timelineState?.tracks[0].items.map(i => [i.id, i.startTime]))
      .toEqual([['a', 0], ['b', 5]]);
  });

  it('agentIsExecuting stays true until queued tool results are applied', async () => {
    const { result } = renderAgent();
    const stream = await startTurn(result);

    act(() => {
      // delete_clip waits 50 ms for its animation before it applies.
      stream.config.onEvent(toolResult('tc-delete', DELETE_A));
      stream.config.onComplete();
    });
    const whileDraining = {
      status: result.current.agent.executionState.status,
      executing: result.current.agent.agentIsExecuting,
    };
    await advance(100);

    expect({
      whileDraining,
      afterDrain: {
        status: result.current.agent.executionState.status,
        executing: result.current.agent.agentIsExecuting,
      },
    }).toEqual({
      whileDraining: { status: 'finishing', executing: true },
      afterDrain: { status: 'completed', executing: false },
    });
  });

  it('a turn sent right after completion snapshots the drained timeline', async () => {
    const { result } = renderAgent();
    const first = await startTurn(result);
    act(() => {
      first.config.onEvent(toolResult('tc-delete', DELETE_A));
      completeStream(first);
    });

    // Refused while the first turn is still applying its queued delete.
    await startTurn(result);
    const managersWhileFinishing = streams.managers.length;
    await advance(100);
    const second = await startTurn(result);

    const body = second.config.body as { timelineState: TimelineState };
    expect({
      managersWhileFinishing,
      managers: streams.managers.length,
      sentItems: body.timelineState.tracks[0].items.map(i => i.id),
    }).toEqual({ managersWhileFinishing: 1, managers: 2, sentItems: ['b'] });
  });

  it('unmount during a turn writes timelineTrackPatches for the sealed message', async () => {
    const { result, writes, unmount } = renderAgent();
    const stream = await startTurn(result);
    act(() => stream.config.onEvent(toolResult('tc-delete', DELETE_A)));
    await advance(100);

    unmount();
    await advance(100);

    expect(lastAgentMessage(writes)).toMatchObject({
      isStreaming: false,
      timelineTrackPatches: [expect.objectContaining({ trackId: 'v1' })],
    });
  });

  it('undo is refused while a turn is executing', async () => {
    const onNotification = vi.fn();
    const { result, writes } = renderAgent({ onNotification });
    const first = await startTurn(result);
    act(() => {
      first.config.onEvent(toolResult('tc-delete', DELETE_A));
      completeStream(first);
    });
    await advance(100);
    const messageId = lastAgentMessage(writes).id;
    await startTurn(result);

    act(() => result.current.agent.undoAllOperations(messageId));

    expect({
      notified: onNotification.mock.calls,
      items: result.current.timelineState?.tracks[0].items.map(i => i.id),
    }).toEqual({ notified: [['warning', 'blocked']], items: ['b'] });
  });

  it('the request body carries no inline thumbnails', async () => {
    const material = {
      id: 'm1', name: 'clip', type: 'video', format: 'mp4', size: 1, createdAt: new Date(0),
      url: '/api/storage/files/video/clip.mp4',
      thumbnailUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      localProxyUrl: 'blob:http://localhost/1',
    } as MaterialItem;
    const { result } = renderAgent({ materials: [material] });

    const stream = await startTurn(result);

    const [sent] = (stream.config.body as { materials: MaterialItem[] }).materials;
    expect({ url: sent.url, thumbnail: 'thumbnailUrl' in sent, proxy: 'localProxyUrl' in sent })
      .toEqual({ url: '/api/storage/files/video/clip.mp4', thumbnail: false, proxy: false });
  });

  it('a turn whose queued event never settles unlocks after the finishing watchdog', async () => {
    const onNotification = vi.fn();
    const { result } = renderAgent({ onNotification });
    const stream = await startTurn(result);
    const stuck = vi
      .spyOn(AgentEventRouter.prototype, 'handleEvent')
      .mockImplementationOnce(() => new Promise<void>(() => undefined));

    act(() => {
      stream.config.onEvent({ type: 'text_delta', content: 'working' });
      stream.config.onComplete();
    });
    await advance(FINISHING_WATCHDOG_MS - 1000);
    const beforeWatchdog = result.current.agent.agentIsExecuting;
    await advance(1000);
    stuck.mockRestore();

    expect({
      beforeWatchdog,
      executing: result.current.agent.agentIsExecuting,
      status: result.current.agent.executionState.status,
      warned: onNotification.mock.calls.some(([type, message]) => type === 'warning' && message === 'timed out'),
    }).toEqual({ beforeWatchdog: true, executing: false, status: 'completed', warned: true });
  });

  it('new agent messages no longer carry timelineSnapshot', async () => {
    const { result, writes } = renderAgent();
    const stream = await startTurn(result);

    act(() => {
      stream.config.onEvent({ type: 'text_delta', content: 'Done.' });
      stream.config.onComplete();
    });
    await advance(100);

    const agentMessages = writes.map(messages => messages[messages.length - 1]);
    expect(agentMessages.length).toBeGreaterThan(1);
    expect(agentMessages.filter(message => 'timelineSnapshot' in message)).toEqual([]);
  });

  it('a turn can be sent after the finishing watchdog gave up on a stuck event', async () => {
    const { result } = renderAgent();
    const first = await startTurn(result);
    const stuck = vi
      .spyOn(AgentEventRouter.prototype, 'handleEvent')
      .mockImplementationOnce(() => new Promise<void>(() => undefined));
    act(() => {
      first.config.onEvent({ type: 'text_delta', content: 'working' });
      completeStream(first);
    });
    await advance(FINISHING_WATCHDOG_MS);
    stuck.mockRestore();

    act(() => {
      void result.current.agent.sendAgentMessage('try again');
    });
    await advance(0);

    expect(streams.managers.length).toBe(2);
  });

  it('unmounting while finishing leaves no watchdog to report a timeout', async () => {
    const onNotification = vi.fn();
    const { result, unmount } = renderAgent({ onNotification });
    const stream = await startTurn(result);
    const stuck = vi
      .spyOn(AgentEventRouter.prototype, 'handleEvent')
      .mockImplementationOnce(() => new Promise<void>(() => undefined));
    act(() => {
      stream.config.onEvent({ type: 'text_delta', content: 'working' });
      completeStream(stream);
    });

    unmount();
    const timersAfterUnmount = vi.getTimerCount();
    await advance(FINISHING_WATCHDOG_MS);
    stuck.mockRestore();

    expect({
      timersAfterUnmount,
      warned: onNotification.mock.calls.some(([type]) => type === 'warning'),
    }).toEqual({ timersAfterUnmount: 0, warned: false });
  });
});
