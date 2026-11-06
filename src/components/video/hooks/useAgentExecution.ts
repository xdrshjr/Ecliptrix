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
import { readSetupConfigRevision } from '@/lib/setupEvents';
import { readScriptSegments, type ScriptSegmentSnapshot } from '@/lib/video-editing-agent/editorContextPrompt';
import {
  describeServerErrorText,
  describeStreamErrorText,
  type ServerErrorPayload,
} from './agentErrorCopy';
import {
  buildEditorContextField,
  type AgentEditorContext,
  type SendAgentMessageOptions,
} from './agentTurnContext';
import type {
  TimelineState,
  MaterialItem,
  ChatMessage,
  Conversation,
  AgentTrackPatch,
} from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { readLastCompositionId } from '@/lib/api/agentVision';
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
  revertTrackPatches,
} from '@/lib/video-editing-agent/trackPatch';
import { createDefaultAgentTimelineState } from '@/lib/video-editing-agent/defaultTimeline';
import type { StreamError } from '@/lib/video-editing-agent/errorRecovery';
import type {
  AgentAutonomy, LastAgentTurnEnd, SSEEvent, CoverAgentBridge,
} from '@/lib/video-editing-agent/types';
import type { CoverAspectRatio } from '@/types/videoCover';
import type {
  AgentExecutionState,
  StartExecutionParams,
} from './useAgentExecutionState';
import { useAgentExecutionState } from './useAgentExecutionState';
import type { ConversationSendContext, ConversationWriteScope,
  SendMessageResult } from './videoChatSessionModel';
import {
  useAgentExecutionSteering,
  type UseAgentExecutionSteeringReturn,
} from './useAgentExecutionSteering';
import { triggerClipAnimation } from './clipAnimation';
import { useAgentLiveEvents, type AgentLiveEvents } from './useAgentLiveEvents';
import { hasRunningCrew } from './agentLiveProgress';
import {
  createAgentPlaceholder,
  createTurnMessageIds,
  markToolCallUndone,
  rebaseMessagePatches,
  replaceRetiredTurnMessage,
  stripHistoryForRequest,
  stripInlineMediaForAgent,
} from './agentTurnLifecycle';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAgentExecutionParams {
  getScriptSegments?: () => readonly ScriptSegmentSnapshot[];
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
  /** 全自动模式（YOLO）：true 时请求体带 `autonomy: 'yolo'`（§4.3）。 */
  yolo?: boolean;
  /**
   * 工程「全片默认音色」（界面左侧「全片默认音色」底栏的值）。随请求体下发，
   * Agent 侧 TTS 工具在模型省略 `voice_type` 时用它，保证「界面显示的」
   * 与「Agent 实际用的」是同一个音色（docs/diagnoses/
   * agent-tts-ignores-project-default-voice/analysis.md §9.1）。
   */
  defaultVoiceId?: string;
  getConversation?: (id: string) => Conversation | undefined;
  getActiveConversationId?: () => string | null;
  captureWriteScope?: (id: string) => ConversationWriteScope | null;
  isScopeValid?: (scope: ConversationWriteScope) => boolean;
  writeScopedMessages?: (scope: ConversationWriteScope,
    messages: ChatMessage[]) => boolean;
  canStartRequest?: (context?: ConversationSendContext) => boolean;
}

// 回合上下文形状与组装已抽到 `agentTurnContext`（见文件头 §5.2.1 棘轮）；
// 这里原样再导出，既有导入点无需改路径。
export type {
  AgentEditorContext, SendAgentMessageOptions,
} from './agentTurnContext';

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
  sendAgentMessage: (text: string, options?: SendAgentMessageOptions,
    context?: ConversationSendContext) => Promise<SendMessageResult | void>;
  executionConversationId: string | null;
  isConversationBusy: () => boolean;
  consumeDraftRestore: (nonce: number) => void;
  acknowledgeTurnEnd: (turnSeq: number) => void;
  /** Mid-run notes, the follow-up queue, input restore and the skill-skip notice. */
  steering: UseAgentExecutionSteeringReturn['steering'];
  draftRestore: UseAgentExecutionSteeringReturn['draftRestore'];
  skillSkip: UseAgentExecutionSteeringReturn['skillSkip'];
  /** Crew / batch-acquire progress and the latest prompt-size reading. */
  liveEvents: AgentLiveEvents;
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
  /** 最近一次回合结束事实（§4.6.2）：自动续跑只读它，不自己判断时机。 */
  lastTurnEnd: LastAgentTurnEnd | null;
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
  'onEvent' | 'onRestart' | 'onComplete' | 'onError' | 'onCancel'
  | 'onFinishingTimeout' | 'onBeforeTerminal'
>;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentExecution(params: UseAgentExecutionParams): UseAgentExecutionReturn {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const mounted = useRef(true);
  const handoffRef = useRef<number | null>(null);
  const [, refreshHandoff] = useState(0);
  const [executionConversationId, setExecutionConversationId] = useState<string | null>(null);
  const ownerRef = useRef<string | null>(null);
  const liveTokenRef = useRef<object | null>(null);
  const usageTokenRef = useRef<object | null>(null);
  const executionScopeRef = useRef<ConversationWriteScope | undefined>(undefined);
  const readConversation = useCallback((id: string) =>
    paramsRef.current.getConversation ? paramsRef.current.getConversation(id)
      : paramsRef.current.conversations.find(item => item.id === id), []);
  const readActiveId = useCallback(() => paramsRef.current.getActiveConversationId
    ? paramsRef.current.getActiveConversationId()
    : paramsRef.current.activeConversationId, []);
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
  const yolo = params.yolo === true;
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
    getStatusNow,
  } = useAgentExecutionState();

  // -- Refs for stable access in callbacks --
  const timelineStateRef = useRef(timelineState);
  timelineStateRef.current = timelineState;

  const materialsRef = useRef(materials);
  materialsRef.current = materials;

  // 工程默认音色同样走 ref：`sendAgentMessage` 不必为它重建回调，
  // 而用户刚点完「更换」立刻发消息时读到的一定是最新值（无 800ms 落盘延迟）。
  const defaultVoiceIdRef = useRef(params.defaultVoiceId);
  defaultVoiceIdRef.current = params.defaultVoiceId;

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
  const isStreamLiveNow = useCallback(() =>
    ['executing', 'retrying'].includes(getStatusNow()), [getStatusNow]);

  // -- agentIsExecuting also covers `finishing`: the edit lock, the send
  //    button and agent undo wait until queued operations are applied --
  const agentIsExecuting = isStreamLive || executionState.status === 'finishing';
  const liveEvents = useAgentLiveEvents(agentIsExecuting);

  // -- Re-entry guard for sendAgentMessage until its request has started --
  const sendingRef = useRef(false);

  // -- 看门狗接管收尾时否决续跑：事件链没排干，可能把同一次编辑写两遍。 --
  const finishingTimedOutRef = useRef(false);

  // -- Mid-run steering. It sends follow-ups and stops turns through refs
  //    because `sendAgentMessage` / `cancelByUser` are defined further down. --
  const sendAgentMessageRef = useRef<UseAgentExecutionReturn['sendAgentMessage']>(
    async () => ({ accepted: false, reason: 'not_ready' }));
  const cancelByUserRef = useRef<() => void>(() => undefined);
  const steeringBridge = useAgentExecutionSteering({
    agentIsExecuting,
    executionStatus: executionState.status,
    autonomy: yolo ? 'yolo' : 'interactive',
    finishingTimedOut: finishingTimedOutRef.current,
    activeConversationId,
    getStateManager: () => stateManagerRef.current,
    getMessages: id => readConversation(id ?? ownerRef.current ?? '')?.messages,
    onTurnEndSampled: seq => {
      if (paramsRef.current.captureWriteScope) handoffRef.current = seq;
    },
    sendFollowUp: (text, seq) =>
      sendAgentMessageRef.current(text, undefined, { followUpTurnSeq: seq }),
    cancelTurn: () => cancelByUserRef.current(),
    onNotification,
  });
  const steeringBridgeRef = useRef(steeringBridge);
  steeringBridgeRef.current = steeringBridge;
  const isConversationBusy = useCallback(() => sendingRef.current
    || ['executing', 'retrying', 'finishing'].includes(getStatusNow())
    || handoffRef.current !== null
    || steeringBridgeRef.current.steering.hasPendingInput()
    || steeringBridgeRef.current.hasDraftRestore(), [getStatusNow]);
  const acknowledgeTurnEnd = useCallback((seq: number) => {
    if (handoffRef.current !== seq) return;
    handoffRef.current = null;
    if (mounted.current) refreshHandoff(value => value + 1);
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
    [setTimelineState, onTimelineUpdate],
  );

  /** Localised text for an SSE `error` event; an old server sends no code. */
  const describeServerError = useCallback(
    (payload: ServerErrorPayload): string => describeServerErrorText(t, payload),
    [t],
  );

  /** Localised text for a stream (transport) failure. */
  const describeStreamError = useCallback(
    (error: StreamError): string => describeStreamErrorText(t, error),
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
      onCoverStatus: () => void) => {
      const token = {};
      const requestProjectId = paramsRef.current.projectId;
      liveTokenRef.current = token;
      return new AgentEventRouter({
        isCurrentProject: () => mounted.current && paramsRef.current.projectId === requestProjectId,
        getScriptSegments: () => paramsRef.current.getScriptSegments?.(),
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
        onContextUsage: event => {
          if (liveTokenRef.current !== token) return;
          usageTokenRef.current = token;
          liveEvents.sinks.onContextUsage(event);
        },
        onToolProgress: event => {
          if (liveTokenRef.current === token) liveEvents.sinks.onToolProgress(event);
        },
        onCrewEvent: event => {
          if (liveTokenRef.current === token) liveEvents.sinks.onCrewEvent(event);
        },
      });
    },
    [notifyAgentError, describeServerError, liveEvents.sinks],
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
        onBeforeTerminal: () => {
          if (paramsRef.current.captureWriteScope) handoffRef.current = -1;
        },
        onEvent: (event: SSEEvent) => {
          if (stateManagerRef.current === stateManager
            && steeringBridgeRef.current.routeEvent(event)) return;
          if (event.type === 'tool_call') router.beginCoverOperation(event);
          runAfterQueuedEvents(() => router.handleEvent(event), 'handling event');
        },
        // A restart only happens before any tool call (the stream manager
        // refuses afterwards): nothing was applied, only the text is stale.
        onRestart: () => {
          steeringBridgeRef.current.steering.onRestart();
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
          finishingTimedOutRef.current = true;
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
      scope?: ConversationWriteScope;
    }) => {
      const operationApplier = createOperationApplier();
      operationAppliersRef.current.set(turn.agentMessageId, operationApplier);
      setSingleUndoMessageIds(new Set(operationAppliersRef.current.keys()));
      const stateManager = new AgentStateManager(turn.agentMessageId);
      stateManagerRef.current = stateManager;
      let retired = false;
      const write = (messages: ChatMessage[]) => {
        if (turn.scope && !mounted.current) return;
        if (turn.scope) {
          if (!paramsRef.current.isScopeValid?.(turn.scope)) return;
          paramsRef.current.writeScopedMessages?.(turn.scope, messages);
        } else updateConvMessagesRef.current(turn.convId, messages);
      };
      const writeAgentMessage = (agentMessage: ChatMessage): void => {
        if (!retired) {
          write([...turn.messagesWithUser, agentMessage]);
          return;
        }
        const conversation = readConversation(turn.convId);
        const messages = conversation
          ? replaceRetiredTurnMessage(conversation.messages, agentMessage)
          : null;
        if (!messages) {
          console.warn('[useAgentExecution] Dropped a late write of a retired turn', {
            messageId: agentMessage.id,
          });
          return;
        }
        write(messages);
      };
      const retire = (): void => {
        retired = true;
      };
      turnWriterRef.current = writeAgentMessage;
      retireTurnRef.current = retire;
      const router = createEventRouter(stateManager, operationApplier, () => {
        // The job may outlive SSE. Patch only its card in the current message,
        // retaining newer turns and the final timeline undo snapshot.
        const conversation = readConversation(turn.convId);
        if (!conversation) return;
        write(conversation.messages.map(message =>
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
    [createOperationApplier, createEventRouter, createTurnCallbacks, readConversation],
  );

  // -----------------------------------------------------------------------
  // sendAgentMessage
  // -----------------------------------------------------------------------

  // Over 60 lines: one ordered sequence (drain, retire, snapshot, placeholder,
  // start) whose steps must not interleave with another send.
  const sendAgentMessage = useCallback(async (
    message: string, options?: SendAgentMessageOptions,
    context?: ConversationSendContext,
  ): Promise<SendMessageResult> => {
    const internal = context?.followUpTurnSeq !== undefined
      && context.followUpTurnSeq === handoffRef.current;
    if (!mounted.current || sendingRef.current
      || ['executing', 'retrying', 'finishing'].includes(getStatusNow())
      || (!internal && (handoffRef.current !== null
        || steeringBridgeRef.current.hasDraftRestore()))
      || paramsRef.current.canStartRequest?.(context) === false) {
      return { accepted: false, reason: 'busy' };
    }
    const convId = readActiveId();
    if (!convId) return { accepted: false, reason: 'not_ready' };
    const scope = paramsRef.current.captureWriteScope?.(convId);
    if (paramsRef.current.captureWriteScope && !scope) {
      return { accepted: false, reason: 'stale_scope' };
    }
    sendingRef.current = true;
    finishingTimedOutRef.current = false;
    let rollback = () => {};
    try {
      // Operations still queued from the previous turn must land before the
      // new turn snapshots the timeline, or its patches would swallow them.
      await eventChainRef.current;

      const activeConversation = readConversation(convId);
      if (!mounted.current || !activeConversation || readActiveId() !== convId
        || (scope && !paramsRef.current.isScopeValid?.(scope))) {
        return { accepted: false, reason: 'stale_scope' };
      }
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
        ...(options?.skillId ? { skillId: options.skillId } : {}),
        ...(options?.mentions?.length ? { mentions: options.mentions } : {}),
        // 自动续跑的消息绝不假装是用户亲手打的字（§7.3）。
        ...(options?.automatic ? { metadata: { type: options.automatic } } : {}),
      };
      const messagesWithUser = [...activeConversation.messages, userMessage];
      rollback = () => {
        const latest = readConversation(convId);
        if (!latest || (scope && !paramsRef.current.isScopeValid?.(scope))) return;
        const messages = latest.messages.filter(item =>
          item.id !== userMessageId && item.id !== agentMessageId);
        if (scope) paramsRef.current.writeScopedMessages?.(scope, messages);
        else updateConvMessagesRef.current(convId, messages);
      };
      const nextMessages = [
        ...messagesWithUser,
        createAgentPlaceholder(agentMessageId),
      ];
      if (scope) {
        if (!paramsRef.current.writeScopedMessages?.(scope, nextMessages)) {
          return { accepted: false, reason: 'stale_scope' };
        }
      } else updateConvMessagesRef.current(convId, nextMessages);

      console.log('[useAgentExecution] Sending agent message', {
        messageLength: message.length,
        hasTimelineState: !!currentTL,
        materialsCount: materialsRef.current.length,
      });

      // 3. Per-execution applier, state manager and event router
      const callbacks = createTurnRuntime({
        convId, agentMessageId, messagesWithUser, turnStart,
        scope: scope ?? undefined,
      });

      // 4. Start execution via useAgentExecutionState (owns the SSEStreamManager)
      steeringBridgeRef.current.beginTurn(userMessage, scope ?? undefined);
      const started = startExecution({
        url: '/api/video-editing-agent/chat',
        body: {
          messages: stripHistoryForRequest(messagesWithUser),
          timelineState: { ...baseline,
            aspectRatioId: coverAspectRatioRef.current ?? '16:9' },
          materials: stripInlineMediaForAgent(materialsRef.current),
          scriptSegments: readScriptSegments(paramsRef.current.getScriptSegments?.()),
          projectId,
          conversationId: convId,
          generationConfigRevision: readSetupConfigRevision(),
          // Locator only (spec §4.4 P1-1): the export hook recorded it and
          // `inspect_export` falls back to it when the model omits the id.
          lastCompositionId: readLastCompositionId(projectId),
          ...(options?.skillId ? { skillId: options.skillId } : {}),
          ...(options?.mentions?.length ? { mentions: options.mentions } : {}),
          ...buildEditorContextField(getEditorContextRef.current),
          // 请求即快照：本回合的自主模式（缺省 undefined = 互动模式）。
          ...(yolo ? { autonomy: 'yolo' as AgentAutonomy } : {}),
          // 工程「全片默认音色」：TTS 工具省略 voice_type 时用它。
          ...(defaultVoiceIdRef.current
            ? { defaultVoiceId: defaultVoiceIdRef.current } : {}),
        },
        ...callbacks,
      });
      if (!started) throw new Error('Execution did not start');
      ownerRef.current = convId;
      executionScopeRef.current = scope ?? undefined;
      setExecutionConversationId(convId);
      handoffRef.current = null;
      return { accepted: true };
    } catch (error) {
      console.error('[useAgentExecution] Failed to start request', error);
      steeringBridgeRef.current.abortUnacceptedTurn();
      retireTurnRef.current?.();
      rollback();
      resetState();
      return { accepted: false, reason: 'start_failed' };
    } finally {
      sendingRef.current = false;
    }
  }, [
    createTurnRuntime,
    startExecution,
    getStatusNow, readActiveId, readConversation, resetState,
    projectId,
    // 少了它 `sendAgentMessage` 会一直闭包着首次渲染的 `yolo`（=false）：
    // 开关打开后请求体仍不带 `autonomy`，整个全自动模式静默失效。
    yolo,
  ]);

  sendAgentMessageRef.current = sendAgentMessage;

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
      if (!isStreamLiveNow()) return;
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
    [runAfterQueuedEvents, computeTurnPatches, isStreamLiveNow],
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
  cancelByUserRef.current = cancelByUser;

  /** Clears the error card of a run that already ended; a live run is left alone. */
  const dismissExecutionError = useCallback(() => {
    if (isConversationBusy()) return;
    resetState();
  }, [resetState, isConversationBusy]);

  // -----------------------------------------------------------------------
  // undoAllOperations — revert the track patches of an agent message
  // -----------------------------------------------------------------------

  /**
   * Agent undo is local-only: mid-run the server keeps editing its own copy,
   * so its later operations would miss or delete clips and the turn's patch
   * would contain the revert. Refused (with a notice) until the run ends.
   */
  const isAgentUndoBlocked = useCallback((): boolean => {
    if (!isConversationBusy() && !isEditLocked(useTimelineStore.getState())) return false;
    onNotification?.('warning', t.agentUndo.blockedWhileRunning);
    return true;
  }, [onNotification, t, isConversationBusy]);

  const undoAllOperations = useCallback((messageId: string) => {
    if (isAgentUndoBlocked()) return;
    const convId = readActiveId();
    if (!convId) return;

    const activeConversation = readConversation(convId);
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
  }, [isAgentUndoBlocked, setTimelineState, onTimelineUpdate, onNotification,
    updateConversationMessages, readActiveId, readConversation, t]);

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
    const convId = readActiveId();
    const activeConversation = convId ? readConversation(convId) : undefined;
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
  }, [isAgentUndoBlocked, onTimelineUpdate, onNotification,
    updateConversationMessages, readActiveId, readConversation, t]);

  // -----------------------------------------------------------------------
  // Cancel execution on conversation switch (uses cancelByNavigation —
  // navigating away should NOT pollute the prior conversation's resume
  // system note, per spec §2.6.2 / P1-4).
  // -----------------------------------------------------------------------

  // A `finishing` turn is left alone: its stream already ended, and its
  // remaining writes are bound to its own conversation id.
  useEffect(() => {
    if (isStreamLiveNow()) {
      cancelByNavigation();
    }
    // Single-step undo records belong to the conversation being left.
    if (operationAppliersRef.current.size > 0) {
      operationAppliersRef.current.clear();
      setSingleUndoMessageIds(NO_MESSAGE_IDS);
    }
    if (!['executing', 'retrying', 'finishing'].includes(getStatusNow())) {
      resetState();
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
    mounted.current = true;
    return () => {
      mounted.current = false;
      coverRoutersRef.current.forEach(router => router.cancelCoverOperations(false));
      coverRoutersRef.current.clear();
      if (isStreamLiveNow()) {
        cancelByNavigationRef.current();
        return;
      }
      stateManagerRef.current?.destroy();
    };
  }, []);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  const owner = executionConversationId
    ? readConversation(executionConversationId) : undefined;
  const validOwner = owner && (!executionScopeRef.current
    || params.isScopeValid?.(executionScopeRef.current));
  const toolIds = new Set(validOwner ? owner.messages.flatMap(message =>
    message.agentToolCalls?.map(tool => tool.id) ?? []) : []);
  const crews = Object.fromEntries(Object.entries(liveEvents.crew.crews)
    .filter(([id]) => toolIds.has(id)));
  const acquire = Object.fromEntries(Object.entries(liveEvents.crew.acquire)
    .filter(([id]) => toolIds.has(id)));
  const ownedLiveEvents: AgentLiveEvents = { ...liveEvents,
    contextUsage: validOwner && usageTokenRef.current === liveTokenRef.current
      ? liveEvents.contextUsage : null,
    crew: { ...liveEvents.crew,
      crews, acquire,
      isCrewRunning: agentIsExecuting && hasRunningCrew({ crews, acquire }),
    },
  };
  return {
    executionState,
    agentMode,
    agentIsExecuting,
    setAgentMode,
    sendAgentMessage,
    steering: steeringBridge.steering,
    draftRestore: steeringBridge.draftRestore,
    skillSkip: steeringBridge.skillSkip,
    liveEvents: ownedLiveEvents,
    cancelExecution,
    undoAllOperations,
    undoSingleOperation,
    dismissExecutionError,
    singleUndoMessageIds,
    lastTurnEnd: steeringBridge.lastTurnEnd,
    executionConversationId: validOwner ? executionConversationId : null,
    isConversationBusy, acknowledgeTurnEnd,
    consumeDraftRestore: steeringBridge.consumeDraftRestore,
  };
}
