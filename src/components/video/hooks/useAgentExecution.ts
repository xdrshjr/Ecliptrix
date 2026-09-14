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

import { useCallback, useRef, useEffect } from 'react';
import type {
  TimelineState,
  MaterialItem,
  ChatMessage,
  Conversation,
  AgentToolCallRecord,
  AgentTimelineOperation,
  AgentTrackPatch,
} from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { nextExternalUpdateId } from '@/components/video/timeline/lib/externalUpdateId';
import { SSEStreamManager } from '@/lib/video-editing-agent/SSEStreamManager';
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
import type { SSEEvent } from '@/lib/video-editing-agent/types';
import type {
  AgentExecutionState,
  StartExecutionParams,
} from './useAgentExecutionState';
import { useAgentExecutionState } from './useAgentExecutionState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAgentExecutionParams {
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
  /** Notification callback (type: 'error' | 'success', message). */
  onNotification?: (type: string, message: string) => void;
  /** Agent mode state (managed externally for UI persistence). */
  agentMode: boolean;
  /** Agent mode setter (managed externally for UI persistence). */
  setAgentMode: (mode: boolean) => void;
  /** Owning project id forwarded to the agent route so project-scoped tools
   *  (storyboard pack creation, etc.) can include it on backend calls. */
  projectId?: string;
}

export interface UseAgentExecutionReturn {
  /** Detailed execution state from useAgentExecutionState. */
  executionState: AgentExecutionState;
  /** Whether agent mode is active (vs regular chat). */
  agentMode: boolean;
  /** Whether an agent execution is currently in progress. */
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
}

/** Per-turn collaborators the stream callbacks close over. */
interface AgentTurn {
  stateManager: AgentStateManager;
  router: AgentEventRouter;
  /** Timeline when the turn started: baseline for its track patches. */
  turnStart: TimelineState | undefined;
  /** Replace the turn's agent reply in the turn's conversation. */
  writeAgentMessage: (message: ChatMessage) => void;
}

type TurnStreamCallbacks = Pick<
  StartExecutionParams,
  'onEvent' | 'onRestart' | 'onComplete' | 'onError'
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

  // -- SSEStreamManager ref (for cancel) --
  const streamManagerRef = useRef<SSEStreamManager | null>(null);

  // -- OperationApplier ref (for undo, persists across renders) --
  const operationApplierRef = useRef<OperationApplier | null>(null);

  // -- Per-execution state manager ref --
  const stateManagerRef = useRef<AgentStateManager | null>(null);

  // -- Track messages-before-agent for building final message array --
  const messagesBeforeAgentRef = useRef<ChatMessage[]>([]);

  // -- Timeline at the start of the running turn: in-memory baseline for
  //    the turn's track patches (no longer persisted on the message) --
  const timelineSnapshotRef = useRef<TimelineState | undefined>(undefined);

  // -- Conversation the running turn belongs to. On a conversation switch
  //    activeConversationIdRef has already moved when the turn is sealed. --
  const turnConversationIdRef = useRef<string | null>(null);

  // -- Serialises SSE event handling. Every event, and every terminal write
  //    of the agent message, waits for the previous one, so a delete_clip's
  //    animation delay can no longer let later operations land first. --
  const eventChainRef = useRef<Promise<void>>(Promise.resolve());

  // -- agentIsExecuting derived from executionState --
  const agentIsExecuting =
    executionState.status === 'executing' || executionState.status === 'retrying';

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

  /** Run `task` after every previously received event has been handled. */
  const runAfterQueuedEvents = useCallback(
    (task: () => void | Promise<void>, context: string): void => {
      eventChainRef.current = eventChainRef.current
        .then(task)
        .catch((err) => {
          console.error(`[useAgentExecution] Error ${context}:`, err);
        });
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

  const createEventRouter = useCallback(
    (stateManager: AgentStateManager, operationApplier: OperationApplier) =>
      new AgentEventRouter({
        stateManager,
        operationApplier,
        onOperationApplied: (event) => {
          // Track operation in state manager for pendingOperations
          if (event.operation) {
            stateManager.addOperation(event.operation);
          }
        },
        onError: (errorMsg) => {
          onNotification?.('error', `Agent error: ${errorMsg}`);
        },
      }),
    [onNotification],
  );

  const createTurnCallbacks = useCallback(
    (turn: AgentTurn): TurnStreamCallbacks => {
      const { stateManager, router, turnStart, writeAgentMessage } = turn;
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
        onComplete: () => {
          runAfterQueuedEvents(() => {
            stateManager.finalize();
            unsubscribe();
            writeFinalMessage();
            console.log('[useAgentExecution] Agent message completed', {
              contentLength: stateManager.getAccumulatedContent().length,
              toolCallsCount: stateManager.getToolCalls().length,
              operationsCount: stateManager.getPendingOperations().length,
            });
          }, 'finalizing agent message');
        },
        onError: (error) => {
          onNotification?.('error', `Agent error: ${error.message}`);
          runAfterQueuedEvents(() => {
            unsubscribe();
            // Safety: finalize the message so it doesn't stay in streaming state
            stateManager.setError(error.userMessage);
            writeFinalMessage();
          }, 'finalizing failed agent message');
        },
      };
    },
    [runAfterQueuedEvents, computeTurnPatches, onNotification],
  );

  /** Per-execution applier, state manager, event router and callbacks. */
  const createTurnRuntime = useCallback(
    (turn: {
      convId: string;
      agentMessageId: string;
      messagesWithUser: ChatMessage[];
      turnStart: TimelineState | undefined;
    }) => {
      const operationApplier = createOperationApplier();
      operationApplierRef.current = operationApplier;
      const stateManager = new AgentStateManager(turn.agentMessageId);
      stateManagerRef.current = stateManager;
      return createTurnCallbacks({
        stateManager,
        router: createEventRouter(stateManager, operationApplier),
        turnStart: turn.turnStart,
        writeAgentMessage: (agentMessage) => {
          updateConvMessagesRef.current(turn.convId, [
            ...turn.messagesWithUser,
            agentMessage,
          ]);
        },
      });
    },
    [createOperationApplier, createEventRouter, createTurnCallbacks],
  );

  // -----------------------------------------------------------------------
  // sendAgentMessage
  // -----------------------------------------------------------------------

  const sendAgentMessage = useCallback(async (message: string) => {
    const convId = activeConversationIdRef.current;
    if (!convId || agentIsExecuting) return;

    const activeConversation = conversationsRef.current.find(c => c.id === convId);
    if (!activeConversation) return;

    // 1. Remember where the turn starts (baseline for its track patches)
    const currentTL = timelineStateRef.current;
    const turnStart: TimelineState | undefined = currentTL
      ? JSON.parse(JSON.stringify(currentTL))
      : undefined;
    timelineSnapshotRef.current = turnStart;
    turnConversationIdRef.current = convId;

    // 2. Add user message and the agent reply placeholder
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    const messagesWithUser = [...activeConversation.messages, userMessage];
    messagesBeforeAgentRef.current = messagesWithUser;
    const agentMessageId = `msg-${Date.now()}-agent`;
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
        messages: messagesWithUser,
        timelineState: currentTL,
        materials: materialsRef.current,
        projectId,
      },
      ...callbacks,
    });
  }, [
    agentIsExecuting,
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
      const sm = stateManagerRef.current;
      if (!sm) return;
      // The navigation/unmount path demotes in-flight tool calls but does
      // NOT flag the assistant message as cancelled (spec §2.6.2).
      sm.markCancelled({ appendMarker: options.byUser });
      sm.destroy();

      // Capture the turn now: the write waits for already-received
      // operations, and a new turn may replace these refs in the meantime.
      const convId = turnConversationIdRef.current;
      const baseMessages = messagesBeforeAgentRef.current;
      const turnStart = timelineSnapshotRef.current;
      if (!convId) return;

      runAfterQueuedEvents(() => {
        const finalMsg: ChatMessage = {
          ...sm.toMessageUpdate(),
          timelineTrackPatches: computeTurnPatches(turnStart),
        };
        if (!options.byUser) {
          // Per spec §2.6.2 — keep isCancelled false for the nav path so
          // the next-turn converter does not emit the resume system note.
          finalMsg.isCancelled = undefined;
        }
        updateConvMessagesRef.current(convId, [...baseMessages, finalMsg]);
      }, 'sealing agent message');
    },
    [runAfterQueuedEvents, computeTurnPatches],
  );

  const cancelByUser = useCallback(() => {
    cancelExecState();
    sealMessage({ byUser: true });
    console.log('[useAgentExecution] Execution cancelled by user');
  }, [cancelExecState, sealMessage]);

  const cancelByNavigation = useCallback(() => {
    cancelExecState();
    sealMessage({ byUser: false });
    console.log('[useAgentExecution] Execution cancelled by navigation/unmount');
  }, [cancelExecState, sealMessage]);

  // Back-compat alias — external callers (VideoChatWindow stop button) go
  // through cancelByUser. The exposed name `cancelExecution` stays for the
  // existing prop wiring in VideoEditingInterface.
  const cancelExecution = cancelByUser;

  // -----------------------------------------------------------------------
  // undoAllOperations — revert the track patches of an agent message
  // -----------------------------------------------------------------------

  const undoAllOperations = useCallback((messageId: string) => {
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
  }, [setTimelineState, onTimelineUpdate, onNotification, updateConversationMessages, t]);

  // -----------------------------------------------------------------------
  // undoSingleOperation — undo one specific tool call's operation
  // -----------------------------------------------------------------------

  const undoSingleOperation = useCallback((messageId: string, toolCallId: string) => {
    const applier = operationApplierRef.current;
    // Read before undoing: a successful undo drops the step's records.
    const affectedTrackIds = applier?.affectedTrackIds(toolCallId) ?? [];
    const result: AgentUndoResult = applier
      ? applier.undoOperation(toolCallId)
      : { ok: false, reason: 'not-found' };
    if (!result.ok) {
      // Records live only in the latest run's applier, so steps of earlier
      // turns report "not undoable".
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
  }, [onTimelineUpdate, onNotification, updateConversationMessages, t]);

  // -----------------------------------------------------------------------
  // Cleanup stale streaming messages on mount (e.g. after page refresh)
  // -----------------------------------------------------------------------
  //
  // Per spec §2.6.3 — the on-mount sweep makes the resume contract
  // identical regardless of how the prior turn ended:
  //   • `isStreaming: true` is demoted to false.
  //   • The same messages are flagged `isCancelled: true` so the next-turn
  //     converter knows to inject the resume system note.
  //   • Any tool call still in `executing` status is demoted to `cancelled`.
  //   • Empty stub turns (no content, no tool calls) are dropped.

  useEffect(() => {
    for (const conv of conversations) {
      const dirty = conv.messages.some(
        m => m.isStreaming || (m.agentToolCalls?.some(tc => tc.status === 'executing'))
      );
      if (!dirty) continue;
      const cleaned: ChatMessage[] = [];
      for (const msg of conv.messages) {
        const hasInFlightTool = msg.agentToolCalls?.some(tc => tc.status === 'executing');
        if (!msg.isStreaming && !hasInFlightTool) {
          cleaned.push(msg);
          continue;
        }
        const isStub =
          !msg.content &&
          (!msg.agentToolCalls || msg.agentToolCalls.length === 0);
        if (isStub) {
          // Drop empty turns — matches existing behaviour where a stub is
          // never displayed to the user.
          continue;
        }
        cleaned.push({
          ...msg,
          isStreaming: false,
          isCancelled: true,
          agentToolCalls: msg.agentToolCalls?.map(tc =>
            tc.status === 'executing' ? { ...tc, status: 'cancelled' as const } : tc
          ),
        });
      }
      updateConversationMessages(conv.id, cleaned);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Cancel execution on conversation switch (uses cancelByNavigation —
  // navigating away should NOT pollute the prior conversation's resume
  // system note, per spec §2.6.2 / P1-4).
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (agentIsExecuting) {
      cancelByNavigation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  // -----------------------------------------------------------------------
  // Cleanup on unmount (same nav-style teardown)
  // -----------------------------------------------------------------------

  useEffect(() => {
    return () => {
      cancelExecState();
      stateManagerRef.current?.destroy();
    };
  }, [cancelExecState]);

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
  };
}
