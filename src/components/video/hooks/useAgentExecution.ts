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
} from '@/types';
import { SSEStreamManager } from '@/lib/video-editing-agent/SSEStreamManager';
import { AgentEventRouter } from '@/lib/video-editing-agent/AgentEventRouter';
import { AgentStateManager } from '@/lib/video-editing-agent/AgentStateManager';
import { OperationApplier } from '@/lib/video-editing-agent/OperationApplier';
import type { SSEEvent } from '@/lib/video-editing-agent/types';
import type { AgentExecutionState } from './useAgentExecutionState';
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
  /** Undo all operations from a specific agent message (restore timeline snapshot). */
  undoAllOperations: (messageId: string) => void;
  /** Undo a single operation by toolCallId within a message. */
  undoSingleOperation: (messageId: string, toolCallId: string) => void;
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

  // -- Timeline snapshot ref (for undoAll via message.timelineSnapshot) --
  const timelineSnapshotRef = useRef<TimelineState | undefined>(undefined);

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
  // sendAgentMessage
  // -----------------------------------------------------------------------

  const sendAgentMessage = useCallback(async (message: string) => {
    const convId = activeConversationIdRef.current;
    if (!convId || agentIsExecuting) return;

    const convs = conversationsRef.current;
    const activeConversation = convs.find(c => c.id === convId);
    if (!activeConversation) return;

    // 1. Save timeline snapshot for undo
    const currentTL = timelineStateRef.current;
    const timelineSnapshot: TimelineState | undefined = currentTL
      ? JSON.parse(JSON.stringify(currentTL))
      : undefined;
    timelineSnapshotRef.current = timelineSnapshot;

    // 2. Add user message
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    const messagesWithUser = [...activeConversation.messages, userMessage];
    messagesBeforeAgentRef.current = messagesWithUser;

    // 3. Create agent reply placeholder
    const agentMessageId = `msg-${Date.now()}-agent`;
    const agentMessage: ChatMessage = {
      id: agentMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
      isAgentMessage: true,
      agentToolCalls: [],
      timelineSnapshot,
      pendingOperations: [],
    };

    const messagesWithAgent = [...messagesWithUser, agentMessage];
    updateConversationMessages(convId, messagesWithAgent);

    console.log('[useAgentExecution] Sending agent message', {
      messageLength: message.length,
      hasTimelineState: !!currentTL,
      materialsCount: materialsRef.current.length,
    });

    // 4. Create OperationApplier for this execution
    const operationApplier = new OperationApplier({
      getTimelineState: () => timelineStateRef.current,
      setTimelineState: (state) => {
        setTimelineState(state);
        timelineStateRef.current = state;
      },
      onTimelineUpdate: () => {
        onTimelineUpdate?.(`agent-op-${Date.now()}`);
      },
      onTriggerAnimation: triggerClipAnimation,
    });
    operationApplierRef.current = operationApplier;

    // 5. Create AgentStateManager for this execution
    const stateManager = new AgentStateManager(agentMessageId);
    stateManagerRef.current = stateManager;

    // Subscribe to state changes → update conversation messages
    const capturedConvId = convId;
    const unsubscribe = stateManager.subscribe(() => {
      const msgUpdate = stateManager.toMessageUpdate(timelineSnapshot);
      const baseMessages = messagesBeforeAgentRef.current;
      updateConvMessagesRef.current(capturedConvId, [...baseMessages, msgUpdate]);
    });

    // 6. Create AgentEventRouter
    const router = new AgentEventRouter({
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
    });

    // 7. Start execution via useAgentExecutionState (manages SSEStreamManager lifecycle)
    startExecution({
      url: '/api/video-editing-agent/chat',
      body: {
        messages: messagesWithUser,
        timelineState: currentTL,
        materials: materialsRef.current,
        projectId,
      },
      onEvent: (event: SSEEvent) => {
        // Route event through AgentEventRouter (async for timeline operations)
        router.handleEvent(event).catch((err) => {
          console.error('[useAgentExecution] Error handling event:', err);
        });
      },
      onComplete: () => {
        // Finalize: ensure isStreaming is false
        stateManager.finalize();
        unsubscribe();

        const finalMsg = stateManager.toMessageUpdate(timelineSnapshot);
        const baseMessages = messagesBeforeAgentRef.current;
        updateConvMessagesRef.current(capturedConvId, [...baseMessages, finalMsg]);

        console.log('[useAgentExecution] Agent message completed', {
          contentLength: stateManager.getAccumulatedContent().length,
          toolCallsCount: stateManager.getToolCalls().length,
          operationsCount: stateManager.getPendingOperations().length,
        });
      },
      onError: (error) => {
        unsubscribe();
        onNotification?.('error', `Agent error: ${error.message}`);

        // Safety: finalize the message so it doesn't stay in streaming state
        stateManager.setError(error.userMessage);
        const finalMsg = stateManager.toMessageUpdate(timelineSnapshot);
        const baseMessages = messagesBeforeAgentRef.current;
        updateConvMessagesRef.current(capturedConvId, [...baseMessages, finalMsg]);
      },
    });
  }, [
    agentIsExecuting,
    setTimelineState,
    onTimelineUpdate,
    onNotification,
    triggerClipAnimation,
    startExecution,
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
      if (options.byUser) {
        sm.markCancelled({ appendMarker: true });
      } else {
        // Navigation/unmount path — demote in-flight tool calls but DO NOT
        // flag the assistant message as cancelled (spec §2.6.2).
        sm.markCancelled({ appendMarker: false });
      }
      sm.destroy();

      const convId = activeConversationIdRef.current;
      if (convId) {
        const finalMsg = sm.toMessageUpdate(timelineSnapshotRef.current);
        if (!options.byUser) {
          // Per spec §2.6.2 — keep isCancelled false for the nav path so
          // the next-turn converter does not emit the resume system note.
          finalMsg.isCancelled = undefined;
        }
        const baseMessages = messagesBeforeAgentRef.current;
        updateConvMessagesRef.current(convId, [...baseMessages, finalMsg]);
      }
    },
    [],
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
  // undoAllOperations — restore timeline snapshot from agent message
  // -----------------------------------------------------------------------

  const undoAllOperations = useCallback((messageId: string) => {
    const convId = activeConversationIdRef.current;
    if (!convId) return;

    const convs = conversationsRef.current;
    const activeConversation = convs.find(c => c.id === convId);
    if (!activeConversation) return;

    const agentMessage = activeConversation.messages.find(m => m.id === messageId);
    if (!agentMessage?.timelineSnapshot) return;

    console.log('[useAgentExecution] Agent undo: restoring timeline snapshot');

    // Restore timeline to snapshot
    setTimelineState(agentMessage.timelineSnapshot);
    onTimelineUpdate?.(`agent-undo-${Date.now()}`);

    // Mark message as undone
    const updatedMessages = activeConversation.messages.map(msg =>
      msg.id === messageId
        ? { ...msg, isUndone: true, pendingOperations: [] }
        : msg
    );
    updateConversationMessages(convId, updatedMessages);
  }, [setTimelineState, onTimelineUpdate, updateConversationMessages]);

  // -----------------------------------------------------------------------
  // undoSingleOperation — undo one specific tool call's operation
  // -----------------------------------------------------------------------

  const undoSingleOperation = useCallback((messageId: string, toolCallId: string) => {
    const applier = operationApplierRef.current;
    if (!applier) {
      console.warn('[useAgentExecution] undoSingleOperation: no OperationApplier available');
      return;
    }

    const success = applier.undoOperation(toolCallId);
    if (success) {
      onTimelineUpdate?.(`agent-undo-single-${Date.now()}`);

      // Update the conversation message to mark the tool call as 'undone'
      const convId = activeConversationIdRef.current;
      if (convId) {
        const convs = conversationsRef.current;
        const activeConversation = convs.find(c => c.id === convId);
        if (activeConversation) {
          const updatedMessages = activeConversation.messages.map(msg => {
            if (msg.id !== messageId || !msg.agentToolCalls) return msg;
            return {
              ...msg,
              agentToolCalls: msg.agentToolCalls.map(tc =>
                tc.id === toolCallId ? { ...tc, status: 'undone' as const } : tc
              ),
            };
          });
          updateConversationMessages(convId, updatedMessages);
        }
      }

      console.log('[useAgentExecution] Single operation undone:', toolCallId);
    }
  }, [onTimelineUpdate, updateConversationMessages]);

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
