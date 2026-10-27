import type { ChatMessage } from '@/types';
import { parseAskAnswer } from '@/types/agentToolkit';

/**
 * 「提问存在、且之后没有对应回答」的 question_id 集合。
 *
 * 只读派生，绝不写回 `ChatMessage`（agent-general-toolkit §3.5.2）。
 * 聊天窗口的「未回答态」与插话状态机的「以 ask_user 收尾」共用这一个函数，
 * 不允许出现第二份判定。
 */
export function collectUnansweredQuestionIds(
  messages: readonly ChatMessage[] | undefined,
): Set<string> {
  const answered = new Set<string>();
  for (const message of messages ?? []) {
    if (message.role !== 'user') continue;
    const questionId = parseAskAnswer(message.content);
    if (questionId) answered.add(questionId);
  }
  const unanswered = new Set<string>();
  for (const message of messages ?? []) {
    for (const call of message.agentToolCalls ?? []) {
      if (call.name !== 'ask_user') continue;
      const result = call.result as { question_id?: unknown } | undefined;
      const questionId = typeof result?.question_id === 'string' ? result.question_id : '';
      if (questionId && !answered.has(questionId)) unanswered.add(questionId);
    }
  }
  return unanswered;
}

/** 该回合（最后一条 agent 消息）是否以一个尚未回答的 `ask_user` 收尾。 */
export function endsWithUnansweredQuestion(
  messages: readonly ChatMessage[] | undefined,
): boolean {
  const last = (messages ?? []).filter(message => message.role === 'assistant').pop();
  const lastCall = last?.agentToolCalls?.[last.agentToolCalls.length - 1];
  if (lastCall?.name !== 'ask_user') return false;
  const result = lastCall.result as { question_id?: unknown } | undefined;
  const questionId = typeof result?.question_id === 'string' ? result.question_id : '';
  return questionId !== '' && collectUnansweredQuestionIds(messages).has(questionId);
}
