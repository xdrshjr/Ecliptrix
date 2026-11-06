import type { Conversation } from '@/types';

export interface ConversationActionResult {
  ok: boolean;
  reason?: 'not_ready' | 'busy' | 'not_found' | 'invalid_title'
    | 'publish_failed';
  conversationId?: string;
}

export interface SendMessageResult {
  accepted: boolean;
  reason?: 'not_ready' | 'busy' | 'stale_scope' | 'start_failed';
}

export interface ConversationWriteScope {
  instanceToken: object;
  conversationId: string;
  messagesEpoch: number;
}
export interface ConversationUploadToken extends ConversationWriteScope {
  requestId: string;
}
export interface ConversationSendContext {
  uploadToken?: ConversationUploadToken;
  followUpTurnSeq?: number;
}

export interface ConversationSlice {
  conversations: Conversation[];
  activeConversationId: string | null;
}

export function resolveActiveConversationId(
  conversations: readonly Conversation[], active?: string | null,
): string | null {
  return conversations.some(item => item.id === active)
    ? active! : conversations[0]?.id ?? null;
}

export function defaultConversationTitle(
  conversations: readonly Conversation[], template: string,
): string {
  const titles = new Set(conversations.map(item => item.title));
  let n = 1;
  while (titles.has(`新会话 ${n}`) || titles.has(`New chat ${n}`)) n++;
  return template.replace('{n}', String(n));
}

export function isValidConversationTitle(title: string): boolean {
  const length = Array.from(title.trim()).length;
  return length > 0 && length <= 40;
}

export function createConversation(id: string, title: string): Conversation {
  const now = new Date();
  return { id, title, messages: [], createdAt: now, updatedAt: now,
    chatType: 'chatbot' };
}

export function removeConversation(
  conversations: Conversation[], active: string | null, id: string,
  fallback: Conversation,
): ConversationSlice {
  const index = conversations.findIndex(item => item.id === id);
  const remaining = conversations.filter(item => item.id !== id);
  if (!remaining.length) return {
    conversations: [fallback], activeConversationId: fallback.id,
  };
  return { conversations: remaining, activeConversationId: active === id
    ? remaining[Math.min(index, remaining.length - 1)].id
    : resolveActiveConversationId(remaining, active) };
}
