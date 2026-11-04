'use client';

/**
 * useYoloAutoContinue — 一次有界自动续跑
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.6 / AC-C6 / AC-C8）。
 *
 * 触发点**不是** `onComplete`（那时 `status === 'finishing'`，`sendAgentMessage`
 * 的 guard 会把发送静默吞掉，评审 P0-1），而是 `lastTurnEnd` 这个**回合结束
 * 事实**：它在执行态空闲边沿上被采样一次、带单调 `turnSeq`，因此反复重渲染
 * 天然幂等——同一个事实只会被处理一次。
 *
 * 判定全部交给纯函数 `shouldAutoContinue`（真值表可单测）。本文件只做三件事：
 * 取事实 → 扫计划 → 发一次"继续"。
 *
 * @module hooks/useYoloAutoContinue
 */

import { useEffect, useRef } from 'react';
import type { Conversation } from '@/types';
import type { UseAgentExecutionReturn } from './useAgentExecution';
import { scanLatestPlan } from '@/lib/video-editing-agent/planScan';
import {
  YOLO_CONTINUE_PROMPT,
  shouldAutoContinue,
} from '@/lib/video-editing-agent/yoloAutonomy';

export interface UseYoloAutoContinueArgs {
  /** `useAgentExecution` 的返回值：提供回合结束事实与发送通道。 */
  agent: Pick<UseAgentExecutionReturn, 'lastTurnEnd' | 'sendAgentMessage'>;
  /** 当前是否开启 YOLO（关闭即清零计数并取消待发）。 */
  yolo: boolean;
  /** 当前活动会话（消息与 id 都从它取，绑定会话防止跨会话续跑）。 */
  conversation: Conversation | undefined;
}

export function useYoloAutoContinue({
  agent, yolo, conversation,
}: UseYoloAutoContinueArgs): void {
  /** 本用户回合链内已续跑次数；会话变化或用户自己发消息即清零。 */
  const continueCountRef = useRef(0);
  /** 已处理过的事实（幂等：同一 turnSeq 只处理一次）。 */
  const handledSeqRef = useRef(0);
  /** 绑定计数所属的会话。 */
  const boundConversationRef = useRef<string | null>(null);

  const conversationId = conversation?.id ?? null;
  const { lastTurnEnd } = agent;
  const send = agent.sendAgentMessage;

  // 用户自己发了消息（消息数增长且最后一条是 user）或关掉 YOLO → 计数清零。
  const lastMessage = conversation?.messages[conversation?.messages.length - 1];
  const lastMessageIsUser = lastMessage?.role === 'user';

  useEffect(() => {
    if (!yolo) {
      continueCountRef.current = 0;
      return;
    }
    if (boundConversationRef.current !== conversationId) {
      // 切换会话：挂起而不是清零（P2-06），回到原会话仍沿用本链计数。
      boundConversationRef.current = conversationId;
      continueCountRef.current = 0;
    }
    if (lastMessageIsUser && lastMessage?.metadata?.type !== 'yolo_continue') {
      continueCountRef.current = 0;
    }
  }, [yolo, conversationId, lastMessageIsUser, lastMessage]);

  useEffect(() => {
    if (!lastTurnEnd || !yolo) return;
    if (lastTurnEnd.turnSeq <= handledSeqRef.current) return;
    handledSeqRef.current = lastTurnEnd.turnSeq;
    if (boundConversationRef.current !== conversationId) {
      boundConversationRef.current = conversationId;
    }
    // C4 的后半段：该会话最后一条消息必须是**本回合刚写完的 agent 消息**
    // （切换会话或用户又发了消息时这里就否决，不对着新会话求值）。
    if (!lastMessage?.isAgentMessage) return;
    const plan = scanLatestPlan(conversation?.messages ?? []);
    if (!shouldAutoContinue({
      lastTurnEnd,
      plan,
      continueCount: continueCountRef.current,
      activeConversationId: conversationId,
    })) return;
    continueCountRef.current += 1;
    void send(YOLO_CONTINUE_PROMPT, { automatic: 'yolo_continue' });
  }, [lastTurnEnd, yolo, conversation, conversationId, lastMessage, send]);
}
