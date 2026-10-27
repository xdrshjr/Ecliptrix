import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentStateManager } from '@/lib/video-editing-agent/AgentStateManager';
import { endsWithUnansweredQuestion } from '@/lib/video-editing-agent/askScan';
import type { SSEEvent } from '@/lib/video-editing-agent/types';
import type { ChatMessage } from '@/types';
import type { AgentExecutionStatus } from './useAgentExecutionState';
import type { SteeringNotice } from './steeringMachine';
import { useAgentSteering, type UseAgentSteeringReturn } from './useAgentSteering';

/**
 * `useAgentExecution` 与插话/技能状态之间的接线：SSE 新事件分流、回合结束的
 * 「自动发送 / 回填输入框」决策、技能降级提示。独立成文件，使
 * `useAgentExecution.ts` 不因新功能而增长（spec AC-G2 棘轮）。
 */

export interface DraftRestore {
  text: string;
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
  getStateManager: () => AgentStateManager | null;
  getMessages: () => readonly ChatMessage[] | undefined;
  sendFollowUp: (text: string) => void;
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
  beginTurn: (userMessage: ChatMessage) => void;
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
  const [skillSkip, setSkillSkip] = useState<SkillSkipNotice | null>(null);
  const nonceRef = useRef(0);
  const turnUserMessageRef = useRef<ChatMessage | null>(null);

  const notify = useCallback((notice: SteeringNotice) => {
    const copy = t.agentCollab;
    const text = notice === 'queue_full' ? copy.noticeQueueFull
      : notice === 'restored_after_question' ? copy.noticeRestoredAfterQuestion
        : copy.noticeRestoredAfterStop;
    argsRef.current.onNotification?.(notice === 'queue_full' ? 'warning' : 'info', text);
  }, [t]);

  const steering = useAgentSteering({
    persistApplied: notes => argsRef.current.getStateManager()?.setSteers(notes),
    sendFollowUp: text => argsRef.current.sendFollowUp(text),
    restoreDraft: text => setDraftRestore({ text, nonce: ++nonceRef.current }),
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
      steeringRef.current.onTurnEnd({
        reason: toReason(args.executionStatus),
        endedWithAskUser: endsWithUnansweredQuestion(args.getMessages()),
      });
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

  const beginTurn = useCallback((userMessage: ChatMessage) => {
    turnUserMessageRef.current = userMessage;
    setSkillSkip(null);
    steeringRef.current.startTurn();
  }, []);

  return { steering, draftRestore, skillSkip, routeEvent, beginTurn };
}
