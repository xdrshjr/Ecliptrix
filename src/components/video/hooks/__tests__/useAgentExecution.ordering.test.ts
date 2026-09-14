/**
 * useAgentExecution — event ordering (AG-03), terminal track patches (AG-02)
 * and restart handling (AG-01); round 3: sealing only live turns (AG3-04),
 * retired turns (AG3-05 / N-21), default baseline (AG2-04), per-message
 * single-step undo (AG2-05) and the request body (AG2-13). The SSE transport
 * is replaced by a fake whose config callbacks the tests drive directly; the
 * applier, router and state manager are real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCallback, useState } from 'react';
import type { ChatMessage, Conversation, MaterialItem, TimelineItem, TimelineState } from '@/types';
import type { SSEStreamManagerConfig } from '@/lib/video-editing-agent/SSEStreamManager';
import type { AgentOperation, SSEEvent } from '@/lib/video-editing-agent/types';
import { AgentEventRouter } from '@/lib/video-editing-agent/AgentEventRouter';
import { StreamErrorType, type StreamError } from '@/lib/video-editing-agent/errorRecovery';
import { createDefaultAgentTimelineState } from '@/lib/video-editing-agent/defaultTimeline';
import { getTranslations } from '@/lib/i18n';
import { useAgentExecution } from '../useAgentExecution';
import { FINISHING_WATCHDOG_MS } from '../useAgentExecutionState';

const en = getTranslations('en');

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

vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations: translationsFor } = await import('@/lib/i18n');
  const t = translationsFor('en');
  return { useLocale: () => ({ locale: 'en', setLocale: () => undefined, t }) };
});

const DELETE_A: AgentOperation = { type: 'delete_clip', clipId: 'a', trackId: 'v1' };
const MOVE_B_TO_START: AgentOperation = {
  type: 'move_clip', clipId: 'b', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: 0,
};
const ADD_TO_DEFAULT_VIDEO_TRACK: AgentOperation = {
  type: 'add_clip',
  clip: {
    id: 'added', materialId: 'm1', trackId: 'video-track-1', startTime: 0, duration: 4,
    clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1,
  },
  material: { id: 'm1', name: 'clip', type: 'video', url: '/api/storage/files/video/clip.mp4' },
};
const ADD_TO_V1_END: AgentOperation = {
  type: 'add_clip',
  clip: {
    id: 'c', materialId: 'm1', trackId: 'v1', startTime: 3, duration: 2,
    clipStart: 0, clipEnd: 2, originalDuration: 10, volume: 1,
  },
  material: { id: 'm1', name: 'clip', type: 'video', url: '/api/storage/files/video/clip.mp4' },
};
const CONNECTION_LOST: StreamError = {
  type: StreamErrorType.NETWORK_DROP,
  message: 'socket closed',
  userMessage: 'connection lost',
  recoverable: false,
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
    initialTimeline?: TimelineState | null;
    initialMessages?: ChatMessage[];
  } = {},
) {
  const writes: ChatMessage[][] = [];
  const hook = renderHook(() => {
    const [timelineState, setTimelineState] = useState<TimelineState | null>(() =>
      options.initialTimeline === undefined ? twoClipTimeline() : options.initialTimeline,
    );
    const [conversations, setConversations] = useState<Conversation[]>(() => [
      {
        id: 'c1', title: 'Chat', messages: options.initialMessages ?? [],
        createdAt: new Date(0), updatedAt: new Date(0),
      },
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
  // Date is faked too, so a test can send two turns in the same millisecond.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'],
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
          stream.config.onError(CONNECTION_LOST);
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
    // Since N-10 a delete packs the track, so a later move of b to 0 would be
    // a no-op step; the undone step must be one that changed the timeline.
    act(() => {
      stream.config.onEvent(toolResult('tc-delete', DELETE_A));
      stream.config.onEvent(toolResult('tc-add', ADD_TO_V1_END));
      stream.config.onComplete();
    });
    await advance(100);
    const messageId = lastAgentMessage(writes).id;

    act(() => result.current.agent.undoSingleOperation(messageId, 'tc-add'));
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
    }).toEqual({ notified: [['warning', en.agentUndo.blockedWhileRunning]], items: ['b'] });
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
      warned: onNotification.mock.calls.some(
        ([type, message]) => type === 'warning' && message === en.agentApply.finishingTimedOut,
      ),
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

  it('cancel after a turn ended does not mark it stopped by the user', async () => {
    const { result, writes } = renderAgent();
    const stream = await startTurn(result);
    act(() => stream.config.onEvent({ type: 'text_delta', content: 'Deleting clip a.' }));
    await advance(20);
    act(() => {
      stream.config.onError(CONNECTION_LOST);
      stream.isRunning = false;
    });
    await advance(100);
    const writesAfterError = writes.length;

    act(() => result.current.agent.cancelExecution());
    await advance(100);

    const message = lastAgentMessage(writes);
    expect({
      status: result.current.agent.executionState.status,
      newWrites: writes.length - writesAfterError,
      isCancelled: message.isCancelled,
      stoppedMarker: message.content.includes('_[Stopped by user]_'),
    }).toEqual({ status: 'error', newWrites: 0, isCancelled: undefined, stoppedMarker: false });
  });

  it('dismissing the error of an ended run clears the error state', async () => {
    const { result } = renderAgent();
    const stream = await startTurn(result);
    act(() => {
      stream.config.onError(CONNECTION_LOST);
      stream.isRunning = false;
    });
    await advance(100);
    const statusBefore = result.current.agent.executionState.status;

    act(() => result.current.agent.dismissExecutionError());

    expect({ statusBefore, status: result.current.agent.executionState.status })
      .toEqual({ statusBefore: 'error', status: 'idle' });
  });

  it('a stream error is reported in the UI language', async () => {
    const onNotification = vi.fn();
    const { result, writes } = renderAgent({ onNotification });
    const stream = await startTurn(result);

    act(() => {
      stream.config.onError(CONNECTION_LOST);
      stream.isRunning = false;
    });
    await advance(100);

    const text = en.agentStream.errors.connectionLost;
    expect({
      notified: onNotification.mock.calls,
      content: lastAgentMessage(writes).content.includes(text),
    }).toEqual({
      notified: [['error', en.agentTimeline.errorPrefix.replace('{message}', text)]],
      content: true,
    });
  });

  it('the finishing watchdog seals the stuck turn\'s message as not streaming', async () => {
    const { result, writes } = renderAgent();
    const stream = await startTurn(result);
    const stuck = vi
      .spyOn(AgentEventRouter.prototype, 'handleEvent')
      .mockImplementationOnce(() => new Promise<void>(() => undefined));
    act(() => {
      stream.config.onEvent({ type: 'text_delta', content: 'working' });
      completeStream(stream);
    });

    await advance(FINISHING_WATCHDOG_MS);
    stuck.mockRestore();

    expect({
      status: result.current.agent.executionState.status,
      streaming: lastAgentMessage(writes).isStreaming,
    }).toEqual({ status: 'completed', streaming: false });
  });

  it('a stuck step that settles after the next turn started updates only its own message', async () => {
    const { result, writes } = renderAgent();
    const first = await startTurn(result);
    const realHandleEvent = AgentEventRouter.prototype.handleEvent;
    let releaseStuckStep: () => void = () => undefined;
    const stuck = vi
      .spyOn(AgentEventRouter.prototype, 'handleEvent')
      .mockImplementationOnce(function stuckStep(this: AgentEventRouter, event: SSEEvent) {
        return new Promise<void>((resolve) => {
          releaseStuckStep = () => {
            void realHandleEvent.call(this, event).then(resolve);
          };
        });
      });
    act(() => {
      first.config.onEvent({ type: 'text_delta', content: 'first answer' });
      completeStream(first);
    });
    await advance(FINISHING_WATCHDOG_MS);
    stuck.mockRestore();

    const second = await startTurn(result);
    act(() => {
      second.config.onEvent({ type: 'text_delta', content: 'second answer' });
      completeStream(second);
    });
    await advance(100);
    act(() => releaseStuckStep());
    await advance(100);

    const conversation = writes[writes.length - 1];
    expect(conversation.map(message => [message.role, message.content, !!message.isStreaming])).toEqual([
      ['user', 'tidy up the timeline', false],
      ['assistant', 'first answer', false],
      ['user', 'tidy up the timeline', false],
      ['assistant', 'second answer', false],
    ]);
  });

  it('a turn that starts from no timeline can be undone as a whole', async () => {
    const { result, writes } = renderAgent({ initialTimeline: null });
    const stream = await startTurn(result);
    act(() => {
      stream.config.onEvent(toolResult('tc-add', ADD_TO_DEFAULT_VIDEO_TRACK));
      completeStream(stream);
    });
    await advance(100);
    const message = lastAgentMessage(writes);
    const clipsBeforeUndo = result.current.timelineState?.tracks.flatMap(track => track.items).length;

    act(() => result.current.agent.undoAllOperations(message.id));

    const sent = (stream.config.body as { timelineState: TimelineState }).timelineState;
    expect({
      sentTracks: sent.tracks.map(track => track.id),
      patches: message.timelineTrackPatches?.map(patch => patch.trackId),
      clipsBeforeUndo,
      clipsAfterUndo: result.current.timelineState?.tracks.flatMap(track => track.items).length,
    }).toEqual({
      sentTracks: createDefaultAgentTimelineState().tracks.map(track => track.id),
      patches: ['video-track-1'],
      clipsBeforeUndo: 1,
      clipsAfterUndo: 0,
    });
  });

  it('undo single works on a step of an earlier turn in the same session', async () => {
    const onNotification = vi.fn();
    const { result, writes } = renderAgent({ onNotification });
    const first = await startTurn(result);
    act(() => {
      first.config.onEvent(toolResult('tc-delete', DELETE_A));
      completeStream(first);
    });
    await advance(100);
    const firstTurnId = lastAgentMessage(writes).id;
    const second = await startTurn(result);
    act(() => {
      second.config.onEvent({ type: 'text_delta', content: 'Nothing else to do.' });
      completeStream(second);
    });
    await advance(100);

    act(() => result.current.agent.undoSingleOperation(firstTurnId, 'tc-delete'));

    expect({
      errors: onNotification.mock.calls.filter(([type]) => type === 'error'),
      clips: result.current.timelineState?.tracks[0].items.map(i => i.id).sort(),
    }).toEqual({ errors: [], clips: ['a', 'b'] });
  });

  it('turns without live undo records hide undo single', async () => {
    const earlier: ChatMessage = {
      id: 'msg-earlier-agent', role: 'assistant', content: 'Deleted a clip.', timestamp: new Date(0),
      isAgentMessage: true,
      agentToolCalls: [
        { id: 'tc-old', name: 'delete_clip', params: {}, status: 'completed', changedTimeline: true },
      ],
    };
    const { result, writes } = renderAgent({ initialMessages: [earlier] });
    const stream = await startTurn(result);
    act(() => {
      stream.config.onEvent(toolResult('tc-delete', DELETE_A));
      completeStream(stream);
    });
    await advance(100);

    const ids = result.current.agent.singleUndoMessageIds;
    expect({ earlier: ids.has(earlier.id), live: ids.has(lastAgentMessage(writes).id) })
      .toEqual({ earlier: false, live: true });
  });

  it('two turns sent in the same millisecond get distinct message ids', async () => {
    const { result, writes } = renderAgent();
    vi.setSystemTime(1_000);
    const first = await startTurn(result);
    act(() => completeStream(first));
    await advance(100);
    vi.setSystemTime(1_000);

    await startTurn(result);

    const ids = writes[writes.length - 1].map(message => message.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the request body carries no timelineTrackPatches', async () => {
    const earlier: ChatMessage = {
      id: 'msg-earlier-agent', role: 'assistant', content: 'Deleted a clip.', timestamp: new Date(0),
      isAgentMessage: true,
      agentToolCalls: [{ id: 'tc-old', name: 'delete_clip', params: {}, status: 'completed' }],
      timelineTrackPatches: [{ trackId: 'v1', before: null, after: null }],
      pendingOperations: [DELETE_A],
      thinkingContent: 'plan the edit',
    };
    const { result } = renderAgent({ initialMessages: [earlier] });

    const stream = await startTurn(result);

    const [sent] = (stream.config.body as { messages: ChatMessage[] }).messages;
    expect({
      patches: 'timelineTrackPatches' in sent,
      operations: 'pendingOperations' in sent,
      thinking: 'thinkingContent' in sent,
      toolCalls: sent.agentToolCalls?.length,
    }).toEqual({ patches: false, operations: false, thinking: false, toolCalls: 1 });
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
