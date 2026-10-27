import type { ChatMessage, ConversationCompaction } from '@/types';

/**
 * Pure planning and bookkeeping for conversation compaction.
 *
 * A compaction is an ordinary `role: 'system'` chat message that sits right
 * after the last message it folds. Nothing is deleted: the model view is cut
 * at the LAST compaction message in array order (messageConverter), and the
 * UI keeps every original. That one rule makes both rolling merge and undo
 * trivial:
 *
 *  - a rolling merge inserts the new compaction after the old one (the folded
 *    range only grows), so the old message stays in the array, merely inert;
 *  - undoing the new one removes it, and the old one is the last again.
 *
 * Spec: docs/plans/agent-research-crew-and-context-memory/spec.md §3.4.2.
 */

/** Fewer user/assistant messages than this and there is nothing worth folding. */
export const MIN_MESSAGES_TO_COMPACT = 6;
/** The latest user turns (with their replies) stay verbatim. */
export const KEEP_USER_TURNS = 2;

export interface FoldPlan {
  /** Messages the summariser sees: everything after the active compaction. */
  segment: ChatMessage[];
  /** The compaction currently in force; its digest is merged into the new one. */
  previous: ChatMessage | null;
  coveredThroughMessageId: string;
  /** Cumulative count of user/assistant messages folded, including `previous`. */
  coveredCount: number;
}

export type FoldRefusal = 'too_short' | 'busy';

export function isCompactionMessage(message: ChatMessage): boolean {
  return message.role === 'system' && message.metadata?.type === 'compaction'
    && message.metadata.compaction !== undefined;
}

/** The chat as other features see it: digests are plumbing, not conversation. */
export function withoutCompaction(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter(message => !isCompactionMessage(message));
}

/** User and assistant messages only: the count a person would call "messages". */
export function countConversationMessages(messages: readonly ChatMessage[]): number {
  return messages.filter(message => message.role === 'user' || message.role === 'assistant').length;
}

function lastCompactionIndex(messages: readonly ChatMessage[], before: number): number {
  for (let index = Math.min(before, messages.length) - 1; index >= 0; index -= 1) {
    if (isCompactionMessage(messages[index])) return index;
  }
  return -1;
}

/** The compaction in force: the last one in array order. */
export function findActiveCompaction(messages: readonly ChatMessage[]): ChatMessage | null {
  const index = lastCompactionIndex(messages, messages.length);
  return index < 0 ? null : messages[index];
}

/** True for a compaction another compaction replaced (rolling merge). */
export function supersededCompactionIds(messages: readonly ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    const replaced = message.metadata?.compaction?.supersedes;
    if (replaced) ids.add(replaced);
  }
  return ids;
}

function userTurnStartIndexes(messages: readonly ChatMessage[]): number[] {
  const starts: number[] = [];
  messages.forEach((message, index) => { if (message.role === 'user') starts.push(index); });
  return starts;
}

/**
 * Decide what to fold, or why nothing can be.
 *
 * `busy` means a message is still streaming: its array position is about to be
 * rewritten by the running turn, so no compaction may be planned or written.
 */
export function planFold(messages: readonly ChatMessage[]): FoldPlan | FoldRefusal {
  if (messages.some(message => message.isStreaming)) return 'busy';
  if (countConversationMessages(messages) < MIN_MESSAGES_TO_COMPACT) return 'too_short';
  const starts = userTurnStartIndexes(messages);
  if (starts.length <= KEEP_USER_TURNS) return 'too_short';
  const boundary = starts[starts.length - KEEP_USER_TURNS];
  // A compaction inside the kept tail would stay the last one in array order,
  // so a new one placed before the tail could never take effect.
  if (lastCompactionIndex(messages, messages.length) >= boundary) return 'too_short';
  const previousIndex = lastCompactionIndex(messages, boundary);
  const segment = messages.slice(previousIndex + 1, boundary)
    .filter(message => !isCompactionMessage(message));
  const folded = countConversationMessages(segment);
  if (folded === 0) return 'too_short';
  const previous = previousIndex < 0 ? null : messages[previousIndex];
  return {
    segment,
    previous,
    coveredThroughMessageId: messages[boundary - 1].id,
    coveredCount: (previous?.metadata?.compaction?.coveredCount ?? 0) + folded,
  };
}

/**
 * Re-check a plan against the conversation as it is now (the summary took
 * seconds, during which the user may have sent, cleared or switched).
 *
 * Stricter than "no streaming message inside the folded segment": a turn that
 * streams ANYWHERE rewrites the whole conversation from its own snapshot on
 * every update, which would silently overwrite the inserted message.
 */
export function isFoldStillValid(messages: readonly ChatMessage[], plan: FoldPlan): boolean {
  if (messages.some(message => message.isStreaming)) return false;
  if (!messages.some(message => message.id === plan.coveredThroughMessageId)) return false;
  return (findActiveCompaction(messages)?.id ?? null) === (plan.previous?.id ?? null);
}

export function savedPercent(tokensBefore: number, tokensAfter: number): number {
  if (!(tokensBefore > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - tokensAfter / tokensBefore) * 100)));
}

export interface CompactionDraft {
  id: string;
  summaryText: string;
  tokensBefore: number;
  tokensAfter: number;
  auto: boolean;
  /** Human-readable one-liner stored as the message content. */
  content: string;
  now: Date;
}

export function buildCompactionMessage(plan: FoldPlan, draft: CompactionDraft): ChatMessage {
  const compaction: ConversationCompaction = {
    summaryText: draft.summaryText,
    coveredThroughMessageId: plan.coveredThroughMessageId,
    coveredCount: plan.coveredCount,
    tokensBefore: draft.tokensBefore,
    tokensAfter: draft.tokensAfter,
    auto: draft.auto,
    createdAt: draft.now.toISOString(),
    ...(plan.previous ? { supersedes: plan.previous.id } : {}),
  };
  return {
    id: draft.id,
    role: 'system',
    content: draft.content,
    timestamp: draft.now,
    metadata: { type: 'compaction', compaction },
  };
}

/** Insert `compaction` right after the last folded message. */
export function insertCompaction(
  messages: readonly ChatMessage[], plan: FoldPlan, compaction: ChatMessage,
): ChatMessage[] {
  const index = messages.findIndex(message => message.id === plan.coveredThroughMessageId);
  return [...messages.slice(0, index + 1), compaction, ...messages.slice(index + 1)];
}

/**
 * Undo: drop the compaction. If it superseded an earlier one, that message is
 * still in the array and becomes the last compaction again.
 */
export function removeCompaction(messages: readonly ChatMessage[], id: string): ChatMessage[] {
  return messages.filter(message => message.id !== id);
}
