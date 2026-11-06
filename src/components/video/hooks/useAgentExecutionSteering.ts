import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentStateManager } from '@/lib/video-editing-agent/AgentStateManager';
import { endsWithUnansweredQuestion } from '@/lib/video-editing-agent/askScan';
import type {
  AgentAutonomy, LastAgentTurnEnd, SSEEvent,
} from '@/lib/video-editing-agent/types';
import type { ChatMessage } from '@/types';
import type { AgentExecutionStatus } from './useAgentExecutionState';
import type { SteeringNotice } from './steeringMachine';
import type { ConversationWriteScope, SendMessageResult } from './videoChatSessionModel';
import { useAgentSteering, type UseAgentSteeringReturn } from './useAgentSteering';

/**
 * `useAgentExecution` 与插话/技能状态之间的接线：SSE 新事件分流、回合结束的
 * 「自动发送 / 回填输入框」决策、技能降级提示。独立成文件，使
 * `useAgentExecution.ts` 不因新功能而增长（spec AC-G2 棘轮）。
 */

export interface DraftRestore {
  text: string;
  conversationId?: string | null;
  instanceToken?: object;
  messagesEpoch?: number;
  /** 递增：同一段文本连续回填两次也能被输入框识别为两次事件。 */
  nonce: number;
}

export interface SkillSkipNotice {
  messageId: string;
  skillId: string;
}

export interface UseAgentExecutionSteeringArgs {
  agentIsExecuting: boolean;
  executionStatus: AgentExecutionStatus;
  /** 本回合发起时快照的自主模式（请求体里发出去的那个值）。 */
  autonomy: AgentAutonomy;
  /** 15s finishing 看门狗是否接管了本回合的收尾（`onFinishingTimeout`）。 */
  finishingTimedOut: boolean;
  /** 采样时绑定当前活动会话，防止切换会话后对着新会话求值。 */
  activeConversationId?: string | null;
  getStateManager: () => AgentStateManager | null;
  getMessages: (conversationId?: string | null) => readonly ChatMessage[] | undefined;
  sendFollowUp: (text: string, turnSeq: number) =>
    void | Promise<SendMessageResult | void>;
  onTurnEndSampled?: (turnSeq: number) => void;
  cancelTurn: () => void;
  onNotification?: (type: string, message: string) => void;
}

export interface UseAgentExecutionSteeringReturn {
  steering: UseAgentSteeringReturn;
  draftRestore: DraftRestore | null;
  skillSkip: SkillSkipNotice | null;
  /** 服务端新事件分流；返回 true 表示已处理，不必再交给 AgentEventRouter。 */
  routeEvent: (event: SSEEvent) => boolean;
  /** 新回合开始：登记承载技能的用户消息，清空上一回合的提示。 */
  beginTurn: (userMessage: ChatMessage, scope?: ConversationWriteScope) => void;
  abortUnacceptedTurn: () => void;
  consumeDraftRestore: (nonce: number) => void;
  hasDraftRestore: () => boolean;
  /**
   * 回合结束事实（评审 P0-1 / P1-1）：在既有 turn-end edge 上**先采样**，
   * 再交给 steering 与 YOLO 消费。`steeredOrQueued` / `followUpSent` 必须在
   * `onTurnEnd` drain 之前取值——drain 之后队列恒为空，读到的是假象。
   */
  lastTurnEnd: LastAgentTurnEnd | null;
}

function toReason(status: AgentExecutionStatus): 'completed' | 'cancelled' | 'error' {
  if (status === 'cancelled') return 'cancelled';
  return status === 'error' ? 'error' : 'completed';
}

export function useAgentExecutionSteering(
  args: UseAgentExecutionSteeringArgs,
): UseAgentExecutionSteeringReturn {
  const { t } = useLocale();
  const argsRef = useRef(args);
  argsRef.current = args;
  const [draftRestore, setDraftRestore] = useState<DraftRestore | null>(null);
  const draftRestoreRef = useRef<DraftRestore | null>(null);
  const turnScopeRef = useRef<ConversationWriteScope | undefined>(undefined);
  const turnOwnerRef = useRef(args.activeConversationId);
  const autonomyRef = useRef(args.autonomy);
  const [skillSkip, setSkillSkip] = useState<SkillSkipNotice | null>(null);
  const nonceRef = useRef(0);
  const turnUserMessageRef = useRef<ChatMessage | null>(null);
  const [lastTurnEnd, setLastTurnEnd] = useState<LastAgentTurnEnd | null>(null);
  /** 递增：每次回合结束都是一个新事实（幂等判据，§4.6.5）。 */
  const turnSeqRef = useRef(0);

  const notify = useCallback((notice: SteeringNotice) => {
    const copy = t.agentCollab;
    const text = notice === 'queue_full' ? copy.noticeQueueFull
      : notice === 'restored_after_question' ? copy.noticeRestoredAfterQuestion
        : copy.noticeRestoredAfterStop;
    argsRef.current.onNotification?.(notice === 'queue_full' ? 'warning' : 'info', text);
  }, [t]);

  const restoreDraft = useCallback((text: string) => {
    draftRestoreRef.current = { text, nonce: ++nonceRef.current,
      conversationId: turnOwnerRef.current, ...turnScopeRef.current };
    setDraftRestore(draftRestoreRef.current);
  }, []);

  const steering = useAgentSteering({
    persistApplied: notes => argsRef.current.getStateManager()?.setSteers(notes),
    sendFollowUp: text => {
      const pending = argsRef.current.sendFollowUp(text, turnSeqRef.current);
      if (pending) void pending.then(result => {
        if (result && !result.accepted) restoreDraft(text);
      }).catch(() => restoreDraft(text));
    },
    restoreDraft,
    notify,
    cancelTurn: () => argsRef.current.cancelTurn(),
  });
  const steeringRef = useRef(steering);
  steeringRef.current = steering;

  // Turn-end edge: the execution state falls back to idle once the stream has
  // ended AND every queued operation has landed, so the queue is drained then.
  const wasExecuting = useRef(args.agentIsExecuting);
  useEffect(() => {
    if (wasExecuting.current && !args.agentIsExecuting) {
      const reason = toReason(args.executionStatus);
      const endedWithAskUser = endsWithUnansweredQuestion(
        args.getMessages(turnOwnerRef.current));
      // 1) 先采样：此刻 steering 还没 drain，队列内容就是「用户是否在管」的证据。
      //    判定走 SteeringMachine 自己的 `hasPendingInput()`，不在这里复制
      //    「哪些 note 算未送达」那条规则。
      const steeringNow = steeringRef.current;
      const steeredOrQueued = steeringNow.hasPendingInput();
      const turnSeq = ++turnSeqRef.current;
      argsRef.current.onTurnEndSampled?.(turnSeq);
      setLastTurnEnd({
        autonomy: autonomyRef.current,
        reason,
        finishingTimedOut: argsRef.current.finishingTimedOut,
        steeredOrQueued,
        // steering 只在「正常完成且没有未回答提问」时自行发下一轮；有文本
        // 要发却没发（非正常终态/以提问收尾）时它回填输入框，不算发送者。
        followUpSent: steeredOrQueued && reason === 'completed'
          && !endedWithAskUser,
        endedWithAskUser,
        conversationId: turnOwnerRef.current ?? null,
        turnSeq,
      });
      // 2) 再交给 steering：有排队文本就在这一步发出（followUpSent 已定格）。
      steeringNow.onTurnEnd({ reason, endedWithAskUser });
    }
    wasExecuting.current = args.agentIsExecuting;
  }, [args, args.agentIsExecuting, args.executionStatus]);

  const routeEvent = useCallback((event: SSEEvent): boolean => {
    switch (event.type) {
      case 'run_started': steeringRef.current.onRunStarted(event.runId); return true;
      case 'steer_applied': steeringRef.current.onSteerApplied(event); return true;
      case 'steer_dropped': steeringRef.current.onSteerDropped(event); return true;
      case 'skill_skipped': {
        const message = turnUserMessageRef.current;
        if (!message) return true;
        // The captured turn messages still reference this very object, so
        // clearing the field here keeps later writes from restoring it, and
        // the model is no longer told "this turn used skill X".
        message.skillId = undefined;
        setSkillSkip({ messageId: message.id, skillId: event.skillId });
        return true;
      }
      default: return false;
    }
  }, []);

  const beginTurn = useCallback((userMessage: ChatMessage,
    scope?: ConversationWriteScope) => {
    wasExecuting.current = true;
    turnScopeRef.current = scope;
    turnOwnerRef.current = scope?.conversationId ?? argsRef.current.activeConversationId;
    autonomyRef.current = argsRef.current.autonomy;
    turnUserMessageRef.current = userMessage;
    setSkillSkip(null);
    steeringRef.current.startTurn();
  }, []);

  const consumeDraftRestore = useCallback((nonce: number) => {
    if (draftRestoreRef.current?.nonce !== nonce) return;
    draftRestoreRef.current = null;
    setDraftRestore(null);
  }, []);
  const abortUnacceptedTurn = useCallback(() => {
    wasExecuting.current = false;
  }, []);
  const hasDraftRestore = useCallback(() => draftRestoreRef.current !== null, []);

  return {
    steering, draftRestore, skillSkip, routeEvent, beginTurn, lastTurnEnd,
    consumeDraftRestore, hasDraftRestore, abortUnacceptedTurn,
  };
}
