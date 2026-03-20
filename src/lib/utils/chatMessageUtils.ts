/**
 * Chat message utilities for API routes.
 *
 * Provides truncation and serialization helpers used by the video script
 * generation API routes when chat messages are supplied as an input source.
 *
 * Truncation limits (per spec 03-generation-flow):
 *   - Maximum 50 messages (most recent kept)
 *   - Maximum 1000 characters per message content
 */

import { ChatMessage } from '@/types';

/** Hard ceiling on the number of messages forwarded to any generation API. */
const MAX_MESSAGES = 50;

/** Hard ceiling on per-message content length (characters). */
const MAX_CHARS_PER_MESSAGE = 1000;

/**
 * Truncate a chat message array so it fits within the budget defined by the
 * generation flow spec.  The function:
 *   1. Keeps only the most recent `MAX_MESSAGES` messages.
 *   2. Trims each message's `content` to `MAX_CHARS_PER_MESSAGE` characters,
 *      appending an ellipsis when truncation occurs.
 *
 * The original array is not mutated; a new array is returned.
 */
export function truncateChatMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const recent = messages.slice(-MAX_MESSAGES);

  return recent.map((msg) => {
    if (msg.content && msg.content.length > MAX_CHARS_PER_MESSAGE) {
      return {
        ...msg,
        content: msg.content.slice(0, MAX_CHARS_PER_MESSAGE) + '…',
      };
    }
    return msg;
  });
}

/**
 * Serialize an array of chat messages into a human-readable text block.
 *
 * Format per message:
 *   用户: <content>          (when role === 'user')
 *   AI: <content>            (otherwise)
 *
 * Messages are joined by newlines.  This format is intentionally compact so it
 * can be embedded inside a larger referenceText or markdownContent field without
 * wasting too many tokens.
 */
export function serializeChatMessages(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) {
    return '';
  }

  return messages
    .map((msg) => `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content}`)
    .join('\n');
}

/**
 * Convenience: truncate then serialize in one call.
 */
export function truncateAndSerializeChatMessages(messages: ChatMessage[]): string {
  return serializeChatMessages(truncateChatMessages(messages));
}
