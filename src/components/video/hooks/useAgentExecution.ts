/**
 * useAgentExecution — Composite hook that assembles SSEStreamManager,
 * AgentEventRouter, AgentStateManager, and OperationApplier into a
 * single React-friendly API for Agent execution lifecycle management.
 *
 * Replaces the ~300 lines of inline agent logic that was in
 * VideoEditingInterface.tsx (handleSendAgentMessage, handleAgentUndo, etc.)
 *
 * @module useAgentExecution
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { describeTtsFailure, getTtsFailure, type TtsFailure } from '@/lib/ttsErrors';
import type {
  TimelineState,
  MaterialItem,
  ChatMessage,
  Conversation,
  AgentTimelineOperation,
  AgentTrackPatch,
} from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { isInlineMediaUrl } from '@/lib/inlineUrl';
import { nextExternalUpdateId } from '@/components/video/timeline/lib/externalUpdateId';
import { useTimelineStore } from '@/components/video/timeline/store/useTimelineStore';
import { isEditLocked } from '@/components/video/timeline/store/editLock';
import { AgentEventRouter } from '@/lib/video-editing-agent/AgentEventRouter';
import { AgentStateManager } from '@/lib/video-editing-agent/AgentStateManager';
import {
  OperationApplier,
  type AgentUndoResult,
} from '@/lib/video-editing-agent/OperationApplier';
import {
  diffTimelineTracks,
  rebaseTrackPatches,
  revertTrackPatches,
} from '@/lib/video-editing-agent/trackPatch';
import { createDefaultAgentTimelineState } from '@/lib/video-editing-agent/defaultTimeline';
import {
  serverErrorMessageKey,
  streamErrorMessageKey,
  type StreamError,
} from '@/lib/video-editing-agent/errorRecovery';
import type {
  AgentStreamErrorCode, SSEEvent, CoverAgentBridge,
} from '@/lib/video-editing-agent/types';
import type { CoverAspectRatio } from '@/types/videoCover';
import type {
  AgentExecutionState,
  StartExecutionParams,
} from './useAgentExecutionState';
import { useAgentExecutionState } from './useAgentExecutionState';
import {
  createTurnMessageIds,
  replaceRetiredTurnMessage,
  stripHistoryForRequest,
} from './agentTurnLifecycle';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAgentExecutionParams {
  coverAgentBridge?: CoverAgentBridge;
  coverAspectRatio?: CoverAspectRatio;
  /** All conversations (array format matching content.conversations). */
  conversations: Conversation[];
  /** Update conversations — receives the conversationId and updated messages array. */
  updateConversationMessages: (conversationId: string, messages: ChatMessage[]) => void;
  /** Currently active conversation ID. */
  activeConversationId: string | null | undefined;
  /** Current timeline state (read). */
  timelineState: TimelineState | null;
  /** Set timeline state (write). */
  setTimelineState: (state: TimelineState | null) => void;
  /** Materials list (read-only). */
  materials: MaterialItem[];
  /** Callback to signal external timeline update (e.g. setExternalTimelineUpdateId). */
  onTimelineUpdate?: (updateId: string) => void;
  /** Notification callback (type: 'error' | 'warning' | 'success', message). */
  onNotification?: (type: string, message: string) => void;
  /** Agent mode state (managed externally for UI persistence). */
  agentMode: boolean;
  /** Agent mode setter (managed externally for UI persistence). */
  setAgentMode: (mode: boolean) => void;
  /** Owning project id forwarded to the agent route so project-scoped tools
   *  (storyboard pack creation, etc.) can include it on backend calls. */
  projectId?: string;
  /** What the user is editing right now (R2 §3.12); sent as `editorContext`. */
  getEditorContext?: () => AgentEditorContext | null;
}

/** The segment the user is working on, so "this segment" means that segment. */
export interface AgentEditorContext {
  selectedSegmentId: string | null;
  segmentLabel: string | null;
  segmentRange: { start: number; end: number } | null;
}

/** `{ editorContext }` only when a segment is selected — otherwise nothing (T-AG-1). */
export function buildEditorContextField(
  getEditorContext: (() => AgentEditorContext | null) | undefined,
): { editorContext?: AgentEditorContext } {
  const context = getEditorContext?.() ?? null;
  return context && context.selectedSegmentId ? { editorContext: context } : {};
}

export interface UseAgentExecutionReturn {
  /** Detailed execution state from useAgentExecutionState. */
  executionState: AgentExecutionState;
  /** Whether agent mode is active (vs regular chat). */
  agentMode: boolean;
  /**
   * Whether an agent execution is in progress, including `finishing` (the
   * stream ended but queued operations are still being applied).
   */
  agentIsExecuting: boolean;
  /** Toggle agent mode on/off. */
  setAgentMode: (mode: boolean) => void;
  /** Send a message to the agent (starts SSE execution). */
  sendAgentMessage: (text: string) => Promise<void>;
  /** Cancel the current execution. */
  cancelExecution: () => void;
  /** Undo all operations of an agent message (reverts its track patches). */
  undoAllOperations: (messageId: string) => void;
  /** Undo a single operation by toolCallId within a message. */
  undoSingleOperation: (messageId: string, toolCallId: string) => void;
  /** Clear the error of a run that already ended (the error card's Dismiss). */
  dismissExecutionError: () => void;
  /** Agent messages whose steps can still be undone one at a time this session. */
  singleUndoMessageIds: ReadonlySet<string>;
}

/** Per-turn collaborators the stream callbacks close over. */
interface AgentTurn {
  stateManager: AgentStateManager;
  router: AgentEventRouter;
  /** Timeline when the turn started: baseline for its track patches. */
  turnStart: TimelineState;
  /** Write the turn's agent reply (only that message once retired). */
  writeAgentMessage: (message: ChatMessage) => void;
  /** A newer turn may start: later writes of this one update its own message only. */
  retire: () => void;
}

const NO_MESSAGE_IDS: ReadonlySet<string> = new Set();

type TurnStreamCallbacks = Pick<
  StartExecutionParams,
  'onEvent' | 'onRestart' | 'onComplete' | 'onError' | 'onCancel' | 'onFinishingTimeout'
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Empty streaming reply shown until the first agent event arrives. */
function createAgentPlaceholder(agentMessageId: string): ChatMessage {
  return {
    id: agentMessageId,
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    isStreaming: true,
    isAgentMessage: true,
    agentToolCalls: [],
    pendingOperations: [],
  };
}

/**
 * Request copy of the materials without inline media: `data:` thumbnails
 * would be re-sent (and reach tool results) on every turn, and `blob:` local
 * proxies mean nothing outside this page.
 */
function stripInlineMediaForAgent(materials: readonly MaterialItem[]): MaterialItem[] {
  return materials.map(material => {
    if (!isInlineMediaUrl(material.thumbnailUrl) && material.localProxyUrl === undefined) {
      return material;
    }
    const copy: MaterialItem = { ...material };
    delete copy.localProxyUrl;
    if (isInlineMediaUrl(copy.thumbnailUrl)) delete copy.thumbnailUrl;
    return copy;
  });
}

function markToolCallUndone(
  messages: ChatMessage[],
  messageId: string,
  toolCallId: string,
): ChatMessage[] {
  return messages.map(msg => {
    if (msg.id !== messageId || !msg.agentToolCalls) return msg;
    return {
      ...msg,
      agentToolCalls: msg.agentToolCalls.map(tc =>
        tc.id === toolCallId ? { ...tc, status: 'undone' as const } : tc
      ),
    };
  });
}

/**
 * After one step of a turn was undone, point the turn's patches for the
 * tracks that step touched at the live timeline (see rebaseTrackPatches).
 */
function rebaseMessagePatches(
  messages: ChatMessage[],
  messageId: string,
  trackIds: readonly string[],
  live: TimelineState | null,
): ChatMessage[] {
  if (!live || trackIds.length === 0) return messages;
  return messages.map(msg =>
    msg.id === messageId && msg.timelineTrackPatches
      ? {
        ...msg,
        timelineTrackPatches: rebaseTrackPatches(
          msg.timelineTrackPatches, trackIds, live,
        ),
      }
      : msg
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentExecution(params: UseAgentExecutionParams): UseAgentExecutionReturn {
  const {
    conversations,
    updateConversationMessages,
    activeConversationId,
    timelineState,
    setTimelineState,
    materials,
    onTimelineUpdate,
    onNotification,
    agentMode,
    setAgentMode,
    projectId,
  } = params;
  const getEditorContextRef = useRef(params.getEditorContext);
  const coverBridgeRef = useRef(params.coverAgentBridge);
  coverBridgeRef.current = params.coverAgentBridge;
  const coverAspectRatioRef = useRef(params.coverAspectRatio);
  coverAspectRatioRef.current = params.coverAspectRatio;
  const coverRoutersRef = useRef(new Set<AgentEventRouter>());
  const currentRouterRef = useRef<AgentEventRouter | null>(null);
  getEditorContextRef.current = params.getEditorContext;

  const { t } = useLocale();

  // -- Execution state (lifecycle, tool tracking, etc.) --
  const {
    state: executionState,
    startExecution,
    cancelExecution: cancelExecState,
    resetState,
  } = useAgentExecutionState();

  // -- Refs for stable access in callbacks --
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const timelineStateRef = useRef(timelineState);
  timelineStateRef.current = timelineState;

  const materialsRef = useRef(materials);
  materialsRef.current = materials;

  const updateConvMessagesRef = useRef(updateConversationMessages);
  updateConvMessagesRef.current = updateConversationMessages;

  // -- OperationApplier per agent message (for single-step undo). Kept for
  //    the session so a step of an earlier turn stays undoable; cleared on a
  //    conversation switch. --
  const operationAppliersRef = useRef(new Map<string, OperationApplier>());
  const [singleUndoMessageIds, setSingleUndoMessageIds] =
    useState<ReadonlySet<string>>(NO_MESSAGE_IDS);

  // -- Per-execution state manager ref --
  const stateManagerRef = useRef<AgentStateManager | null>(null);

  // -- Timeline at the start of the running turn: in-memory baseline for
  //    the turn's track patches (no longer persisted on the message) --
  const timelineSnapshotRef = useRef<TimelineState | undefined>(undefined);

  // -- The latest turn's message writer (bound to its conversation) and its
  //    retirement switch --
  const turnWriterRef = useRef<((message: ChatMessage) => void) | null>(null);
  const retireTurnRef = useRef<(() => void) | null>(null);

  // -- Serialises SSE event handling. Every event, and every terminal write
  //    of the agent message, waits for the previous one, so a delete_clip's
  //    animation delay can no longer let later operations land first. --
  const eventChainRef = useRef<Promise<void>>(Promise.resolve());

  // -- The SSE stream is still open (tools may still be called) --
  const isStreamLive =
    executionState.status === 'executing' || executionState.status === 'retrying';
  const streamLiveRef = useRef(isStreamLive);
  streamLiveRef.current = isStreamLive;

  // -- agentIsExecuting also covers `finishing`: the edit lock, the send
  //    button and agent undo wait until queued operations are applied --
  const agentIsExecuting = isStreamLive || executionState.status === 'finishing';
  const agentIsExecutingRef = useRef(agentIsExecuting);
  agentIsExecutingRef.current = agentIsExecuting;

  // -- Re-entry guard for sendAgentMessage until its request has started --
  const sendingRef = useRef(false);

  // -----------------------------------------------------------------------
  // triggerClipAnimation — visual feedback for timeline operations
  // -----------------------------------------------------------------------

  const triggerClipAnimation = useCallback((operation: AgentTimelineOperation) => {
    let clipId = '';
    let animClass = '';

    switch (operation.type) {
      case 'add_clip':
        clipId = operation.clip.id;
        animClass = 'agent-clip-added';
        break;
      case 'trim_clip':
        clipId = operation.clipId;
        animClass = 'agent-clip-trimmed';
        break;
      case 'delete_clip':
        clipId = operation.clipId;
        animClass = 'agent-clip-deleting';
        break;
      case 'move_clip':
        clipId = operation.clipId;
        animClass = 'agent-clip-moving';
        break;
      case 'resize_clip':
        clipId = operation.clipId;
        animClass = 'agent-clip-resized';
        break;
    }

    if (clipId && animClass) {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-clip-id="${clipId}"]`);
        if (el) {
          el.classList.add(animClass);
          setTimeout(() => el.classList.remove(animClass), 700);
        }
      });
    }
  }, []);

  // -----------------------------------------------------------------------
  // Event chain, turn patches and per-turn collaborators
  // -----------------------------------------------------------------------

  /**
   * Run `task` after every previously received event has been handled.
   * Returns the new chain tail, which settles once `task` has run.
   */
  const runAfterQueuedEvents = useCallback(
    (task: () => void | Promise<void>, context: string): Promise<void> => {
      eventChainRef.current = eventChainRef.current
        .then(task)
        .catch((err) => {
          console.error(`[useAgentExecution] Error ${context}:`, err);
        });
      return eventChainRef.current;
    },
    [],
  );

  /** Tracks the turn changed, from its start to the current timeline. */
  const computeTurnPatches = useCallback(
    (turnStart: TimelineState | undefined): AgentTrackPatch[] => {
      const turnEnd = timelineStateRef.current;
      return turnStart && turnEnd ? diffTimelineTracks(turnStart, turnEnd) : [];
    },
    [],
  );

  const createOperationApplier = useCallback(
    (): OperationApplier =>
      new OperationApplier({
        getTimelineState: () => timelineStateRef.current,
        setTimelineState: (state) => {
          setTimelineState(state);
          timelineStateRef.current = state;
        },
        onTimelineUpdate: () => {
          onTimelineUpdate?.(nextExternalUpdateId('agent-op'));
        },
        onTriggerAnimation: triggerClipAnimation,
      }),
    [setTimelineState, onTimelineUpdate, triggerClipAnimation],
  );

  /** Localised text for an SSE `error` event; an old server sends no code. */
  const describeServerError = useCallback(
    ({ message, code, cause }: {
      message: string; code?: AgentStreamErrorCode; cause?: TtsFailure;
    }): string => {
      if (code === 'tool_failures') {
        const failure = getTtsFailure(cause);
        if (!failure) return t.agentStream.errors.toolFailures;
        const description = describeTtsFailure(failure, t);
        return t.agentStream.errors.toolFailuresWithCause.replace(
          '{detail}', [description.summary, description.action]
            .filter(Boolean).join(' '),
        );
      }
      return code
        ? t.agentStream.errors[serverErrorMessageKey(code)].replace('{detail}', message)
        : message;
    },
    [t],
  );

  /** Localised text for a stream (transport) failure. */
  const describeStreamError = useCallback(
    (error: StreamError): string => t.agentStream.errors[streamErrorMessageKey(error)],
    [t],
  );

  const notifyAgentError = useCallback(
    (text: string): void => {
      onNotification?.('error', t.agentTimeline.errorPrefix.replace('{message}', text));
    },
    [onNotification, t],
  );

  const createEventRouter = useCallback(
    (stateManager: AgentStateManager, operationApplier: OperationApplier,
      onCoverStatus: () => void) =>
      new AgentEventRouter({
        coverAgentBridge: coverBridgeRef.current,
        onCoverStatus,
        stateManager,
        operationApplier,
        onOperationApplied: (event) => {
          // Track operation in state manager for pendingOperations
          if (event.operation) {
            stateManager.addOperation(event.operation);
          }
        },
        onError: notifyAgentError,
        describeError: describeServerError,
      }),
    [notifyAgentError, describeServerError],
  );

  // Over 60 lines: every callback closes over this turn's subscription and
  // final write, so splitting them would only thread those through.
  const createTurnCallbacks = useCallback(
    (turn: AgentTurn): TurnStreamCallbacks => {
      const { stateManager, router, turnStart, writeAgentMessage, retire } = turn;
      // Subscribe to state changes → update conversation messages
      const unsubscribe = stateManager.subscribe(() => {
        writeAgentMessage(stateManager.toMessageUpdate());
      });
      const writeFinalMessage = (): void => {
        writeAgentMessage({
          ...stateManager.toMessageUpdate(),
          timelineTrackPatches: computeTurnPatches(turnStart),
        });
      };

      return {
        onEvent: (event: SSEEvent) => {
          if (event.type === 'tool_call') router.beginCoverOperation(event);
          runAfterQueuedEvents(() => router.handleEvent(event), 'handling event');
        },
        // A restart only happens before any tool call (the stream manager
        // refuses afterwards): nothing was applied, only the text is stale.
        onRestart: () => {
          runAfterQueuedEvents(
            () => stateManager.resetForRestart(),
            'restarting agent message',
          );
        },
        // The terminal callbacks return the chain tail, so the execution
        // stays `finishing` (timeline still locked) until every queued
        // operation has been applied.
        onComplete: () =>
          runAfterQueuedEvents(() => {
            stateManager.finalize();
            unsubscribe();
            writeFinalMessage();
            console.log('[useAgentExecution] Agent message completed', {
              contentLength: stateManager.getAccumulatedContent().length,
              toolCallsCount: stateManager.getToolCalls().length,
              operationsCount: stateManager.getPendingOperations().length,
            });
          }, 'finalizing agent message'),
        onError: (error) => {
          router.cancelCoverOperations(true);
          const text = describeStreamError(error);
          notifyAgentError(text);
          return runAfterQueuedEvents(() => {
            unsubscribe();
            // Safety: finalize the message so it doesn't stay in streaming state
            stateManager.setError(text);
            writeFinalMessage();
          }, 'finalizing failed agent message');
        },
        // cancelByUser queues the sealing write before cancelling the
        // stream, so the tail read here already includes it.
        onCancel: () => eventChainRef.current,
        // The watchdog gave up on a step that never settled. The message is
        // sealed now (not streaming, patches so far) and the turn retired:
        // the stuck step stays on the old chain and still applies if it ever
        // settles, but then updates only this message. Later turns must not
        // queue behind it (sending awaits the chain and would wait forever).
        onFinishingTimeout: () => {
          router.cancelCoverOperations(true);
          unsubscribe();
          writeAgentMessage({
            ...stateManager.toMessageUpdate(),
            isStreaming: false,
            isThinking: false,
            timelineTrackPatches: computeTurnPatches(turnStart),
          });
          retire();
          eventChainRef.current = Promise.resolve();
          onNotification?.('warning', t.agentApply.finishingTimedOut);
        },
      };
    },
    [
      runAfterQueuedEvents, computeTurnPatches, describeStreamError, notifyAgentError,
      onNotification, t,
    ],
  );

  /** Per-execution applier, state manager, event router and callbacks. */
  const createTurnRuntime = useCallback(
    (turn: {
      convId: string;
      agentMessageId: string;
      messagesWithUser: ChatMessage[];
      turnStart: TimelineState;
    }) => {
      const operationApplier = createOperationApplier();
      operationAppliersRef.current.set(turn.agentMessageId, operationApplier);
      setSingleUndoMessageIds(new Set(operationAppliersRef.current.keys()));
      const stateManager = new AgentStateManager(turn.agentMessageId);
      stateManagerRef.current = stateManager;
      let retired = false;
      const writeAgentMessage = (agentMessage: ChatMessage): void => {
        if (!retired) {
          updateConvMessagesRef.current(turn.convId, [...turn.messagesWithUser, agentMessage]);
          return;
        }
        const conversation = conversationsRef.current.find(c => c.id === turn.convId);
        const messages = conversation
          ? replaceRetiredTurnMessage(conversation.messages, agentMessage)
          : null;
        if (!messages) {
          console.warn('[useAgentExecution] Dropped a late write of a retired turn', {
            messageId: agentMessage.id,
          });
          return;
        }
        updateConvMessagesRef.current(turn.convId, messages);
      };
      const retire = (): void => {
        retired = true;
      };
      turnWriterRef.current = writeAgentMessage;
      retireTurnRef.current = retire;
      const router = createEventRouter(stateManager, operationApplier, () => {
        // The job may outlive SSE. Patch only its card in the current message,
        // retaining newer turns and the final timeline undo snapshot.
        const conversation = conversationsRef.current.find(c => c.id === turn.convId);
        if (!conversation) return;
        updateConvMessagesRef.current(turn.convId, conversation.messages.map(message =>
          message.id === turn.agentMessageId
            ? { ...message, agentToolCalls: stateManager.toMessageUpdate().agentToolCalls }
            : message));
      });
      coverRoutersRef.current.add(router);
      currentRouterRef.current = router;
      return createTurnCallbacks({
        stateManager,
        router,
        turnStart: turn.turnStart,
        writeAgentMessage,
        retire,
      });
    },
    [createOperationApplier, createEventRouter, createTurnCallbacks],
  );

  // -----------------------------------------------------------------------
  // sendAgentMessage
  // -----------------------------------------------------------------------

  // Over 60 lines: one ordered sequence (drain, retire, snapshot, placeholder,
  // start) whose steps must not interleave with another send.
  const sendAgentMessage = useCallback(async (message: string) => {
    if (sendingRef.current || agentIsExecutingRef.current) return;
    if (!activeConversationIdRef.current) return;
    sendingRef.current = true;
    try {
      // Operations still queued from the previous turn must land before the
      // new turn snapshots the timeline, or its patches would swallow them.
      await eventChainRef.current;

      const convId = activeConversationIdRef.current;
      const activeConversation = conversationsRef.current.find(c => c.id === convId);
      if (!convId || !activeConversation) return;
      // Writes the previous turn still owes may only touch its own message.
      retireTurnRef.current?.();

      // 1. Remember where the turn starts (baseline for its track patches).
      //    With no timeline yet the turn starts from the shared default one,
      //    so it can still be undone as a whole.
      const currentTL = timelineStateRef.current;
      const baseline = currentTL ?? createDefaultAgentTimelineState();
      const turnStart: TimelineState = JSON.parse(JSON.stringify(baseline));
      timelineSnapshotRef.current = turnStart;

      // 2. Add user message and the agent reply placeholder
      const { userMessageId, agentMessageId } = createTurnMessageIds();
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };
      const messagesWithUser = [...activeConversation.messages, userMessage];
      updateConversationMessages(convId, [
        ...messagesWithUser,
        createAgentPlaceholder(agentMessageId),
      ]);

      console.log('[useAgentExecution] Sending agent message', {
        messageLength: message.length,
        hasTimelineState: !!currentTL,
        materialsCount: materialsRef.current.length,
      });

      // 3. Per-execution applier, state manager and event router
      const callbacks = createTurnRuntime({
        convId, agentMessageId, messagesWithUser, turnStart,
      });

      // 4. Start execution via useAgentExecutionState (owns the SSEStreamManager)
      startExecution({
        url: '/api/video-editing-agent/chat',
        body: {
          messages: stripHistoryForRequest(messagesWithUser),
          timelineState: { ...baseline,
            aspectRatioId: coverAspectRatioRef.current ?? '16:9' },
          materials: stripInlineMediaForAgent(materialsRef.current),
          projectId,
          ...buildEditorContextField(getEditorContextRef.current),
        },
        ...callbacks,
      });
    } finally {
      sendingRef.current = false;
    }
  }, [
    updateConversationMessages,
    createTurnRuntime,
    startExecution,
    projectId,
  ]);

  // -----------------------------------------------------------------------
  // cancelByUser / cancelByNavigation (spec §2.6)
  // -----------------------------------------------------------------------
  //
  // Two cancel paths so user-initiated stops and incidental teardowns
  // (conversation switch, unmount) do not produce identical artifacts in
  // the conversation history.
  //
  //   • cancelByUser()      — primary path; flags `isCancelled`, appends
  //     `_[Stopped by user]_` marker, seals in-flight tools as `cancelled`.
  //     Next turn's messageConverter injects the resume system note.
  //
  //   • cancelByNavigation() — incidental; stops the stream only. Leaves
  //     `isCancelled` undefined so navigating back and continuing the turn
  //     does NOT confuse the LLM with a "the user stopped you" message.

  const sealMessage = useCallback(
    (options: { byUser: boolean }): void => {
      // Only a live stream can be stopped. A turn that already ended (done,
      // failed, or sealed by the watchdog) is final: sealing it again would
      // record it as stopped by the user and rewrite its message.
      if (!streamLiveRef.current) return;
      const sm = stateManagerRef.current;
      const writeAgentMessage = turnWriterRef.current;
      if (!sm || !writeAgentMessage) return;
      // The navigation/unmount path demotes in-flight tool calls but does
      // NOT flag the assistant message as cancelled (spec §2.6.2), so the
      // next-turn converter does not emit the resume system note.
      sm.markCancelled({ appendMarker: options.byUser, byUser: options.byUser });
      sm.destroy();

      // Capture the turn now: the write waits for already-received
      // operations, and a new turn may replace these refs in the meantime.
      const turnStart = timelineSnapshotRef.current;
      runAfterQueuedEvents(() => {
        writeAgentMessage({
          ...sm.toMessageUpdate(),
          timelineTrackPatches: computeTurnPatches(turnStart),
        });
      }, 'sealing agent message');
    },
    [runAfterQueuedEvents, computeTurnPatches],
  );

  // Seal first: the cancel's `finishing` phase waits for the chain tail, and
  // that tail must already contain the sealing write.
  const cancelByUser = useCallback(() => {
    currentRouterRef.current?.cancelCoverOperations(true);
    sealMessage({ byUser: true });
    cancelExecState();
    console.log('[useAgentExecution] Execution cancelled by user');
  }, [cancelExecState, sealMessage]);

  const cancelByNavigation = useCallback(() => {
    coverRoutersRef.current.forEach(router => router.cancelCoverOperations(false));
    coverRoutersRef.current.clear();
    sealMessage({ byUser: false });
    cancelExecState();
    console.log('[useAgentExecution] Execution cancelled by navigation/unmount');
  }, [cancelExecState, sealMessage]);

  // Back-compat alias — external callers (VideoChatWindow stop button) go
  // through cancelByUser. The exposed name `cancelExecution` stays for the
  // existing prop wiring in VideoEditingInterface.
  const cancelExecution = cancelByUser;

  /** Clears the error card of a run that already ended; a live run is left alone. */
  const dismissExecutionError = useCallback(() => {
    if (agentIsExecutingRef.current) return;
    resetState();
  }, [resetState]);

  // -----------------------------------------------------------------------
  // undoAllOperations — revert the track patches of an agent message
  // -----------------------------------------------------------------------

  /**
   * Agent undo is local-only: mid-run the server keeps editing its own copy,
   * so its later operations would miss or delete clips and the turn's patch
   * would contain the revert. Refused (with a notice) until the run ends.
   */
  const isAgentUndoBlocked = useCallback((): boolean => {
    if (!agentIsExecutingRef.current && !isEditLocked(useTimelineStore.getState())) return false;
    onNotification?.('warning', t.agentUndo.blockedWhileRunning);
    return true;
  }, [onNotification, t]);

  const undoAllOperations = useCallback((messageId: string) => {
    if (isAgentUndoBlocked()) return;
    const convId = activeConversationIdRef.current;
    if (!convId) return;

    const activeConversation = conversationsRef.current.find(c => c.id === convId);
    const patches = activeConversation?.messages
      .find(m => m.id === messageId)?.timelineTrackPatches;
    const current = timelineStateRef.current;
    // Messages from before track patches carry none: their button is hidden
    // and a whole-timeline restore is never attempted.
    if (!activeConversation || !patches || patches.length === 0 || !current) return;

    const result = revertTrackPatches(current, patches);
    if (!result.ok) {
      console.warn('[useAgentExecution] Agent undo refused: tracks changed after the turn', {
        messageId,
        conflictTrackIds: result.conflictTrackIds,
      });
      onNotification?.('error', t.agentUndo.conflict);
      return;
    }

    console.log('[useAgentExecution] Agent undo: reverting turn track patches', {
      messageId,
      trackCount: patches.length,
    });
    setTimelineState(result.state);
    timelineStateRef.current = result.state;
    onTimelineUpdate?.(nextExternalUpdateId('agent-undo'));

    // Mark message as undone
    const updatedMessages = activeConversation.messages.map(msg =>
      msg.id === messageId
        ? { ...msg, isUndone: true, pendingOperations: [] }
        : msg
    );
    updateConversationMessages(convId, updatedMessages);
  }, [isAgentUndoBlocked, setTimelineState, onTimelineUpdate, onNotification, updateConversationMessages, t]);

  // -----------------------------------------------------------------------
  // undoSingleOperation — undo one specific tool call's operation
  // -----------------------------------------------------------------------

  const undoSingleOperation = useCallback((messageId: string, toolCallId: string) => {
    if (isAgentUndoBlocked()) return;
    const applier = operationAppliersRef.current.get(messageId);
    // Read before undoing: a successful undo drops the step's records.
    const affectedTrackIds = applier?.affectedTrackIds(toolCallId) ?? [];
    const result: AgentUndoResult = applier
      ? applier.undoOperation(toolCallId)
      : { ok: false, reason: 'not-found' };
    if (!result.ok) {
      // Records live only in this session's appliers, so steps of turns
      // from before a reload (or another conversation) report "not undoable".
      console.warn('[useAgentExecution] Single operation undo refused', {
        toolCallId,
        reason: result.reason,
      });
      onNotification?.(
        'error',
        result.reason === 'conflict' ? t.agentUndo.conflict : t.agentUndo.notUndoable,
      );
      return;
    }

    onTimelineUpdate?.(nextExternalUpdateId('agent-undo-single'));

    // Mark the tool call 'undone' and keep the turn's own undo usable.
    const convId = activeConversationIdRef.current;
    const activeConversation = conversationsRef.current.find(c => c.id === convId);
    if (convId && activeConversation) {
      updateConversationMessages(
        convId,
        rebaseMessagePatches(
          markToolCallUndone(activeConversation.messages, messageId, toolCallId),
          messageId,
          affectedTrackIds,
          timelineStateRef.current,
        ),
      );
    }

    console.log('[useAgentExecution] Single operation undone:', toolCallId);
  }, [isAgentUndoBlocked, onTimelineUpdate, onNotification, updateConversationMessages, t]);

  // -----------------------------------------------------------------------
  // Cancel execution on conversation switch (uses cancelByNavigation —
  // navigating away should NOT pollute the prior conversation's resume
  // system note, per spec §2.6.2 / P1-4).
  // -----------------------------------------------------------------------

  // A `finishing` turn is left alone: its stream already ended, and its
  // remaining writes are bound to its own conversation id.
  useEffect(() => {
    if (streamLiveRef.current) {
      cancelByNavigation();
    }
    // Single-step undo records belong to the conversation being left.
    if (operationAppliersRef.current.size > 0) {
      operationAppliersRef.current.clear();
      setSingleUndoMessageIds(NO_MESSAGE_IDS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  // -----------------------------------------------------------------------
  // Cleanup on unmount (same nav-style teardown)
  // -----------------------------------------------------------------------
  //
  // Unmounting mid-stream seals the turn like a conversation switch, so its
  // timelineTrackPatches and the last batched update are still written (the
  // conversation owner outlives this editor). Refs keep the cleanup reading
  // the latest callbacks without re-running the effect.

  const cancelByNavigationRef = useRef(cancelByNavigation);
  cancelByNavigationRef.current = cancelByNavigation;

  useEffect(() => {
    return () => {
      coverRoutersRef.current.forEach(router => router.cancelCoverOperations(false));
      coverRoutersRef.current.clear();
      if (streamLiveRef.current) {
        cancelByNavigationRef.current();
        return;
      }
      stateManagerRef.current?.destroy();
    };
  }, []);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    executionState,
    agentMode,
    agentIsExecuting,
    setAgentMode,
    sendAgentMessage,
    cancelExecution,
    undoAllOperations,
    undoSingleOperation,
    dismissExecutionError,
    singleUndoMessageIds,
  };
}
