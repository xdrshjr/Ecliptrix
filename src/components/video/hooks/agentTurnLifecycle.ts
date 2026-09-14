/**
 * agentTurnLifecycle — helpers for the ids, writes and requests of one agent
 * turn, kept out of `useAgentExecution` so the hook stays wiring only.
 *
 * - `createTurnMessageIds`: `Date.now()` alone repeats within a millisecond,
 *   and message ids key React nodes and the per-turn undo records.
 * - `stripHistoryForRequest`: the chat route replays `agentToolCalls` only;
 *   track patches, applied operations and thinking text are client state and
 *   made up most of the request body on long conversations.
 * - `replaceRetiredTurnMessage`: a turn the finishing watchdog gave up on may
 *   still settle after a newer turn started. Its late write must update its
 *   own message only, never replace the conversation with its stale copy.
 *
 * @module agentTurnLifecycle
 */

import type { AgentToolCallRecord, ChatMessage } from '@/types';

let turnSequence = 0;

/** Ids for a turn's user message and agent reply, unique within this page. */
export function createTurnMessageIds(): { userMessageId: string; agentMessageId: string } {
  turnSequence += 1;
  const stem = `msg-${Date.now()}-${turnSequence}`;
  return { userMessageId: `${stem}-user`, agentMessageId: `${stem}-agent` };
}

/** The request copy of the conversation, without client-only message fields. */
export function stripHistoryForRequest(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (
      message.timelineTrackPatches === undefined &&
      message.pendingOperations === undefined &&
      message.thinkingContent === undefined
    ) {
      return message;
    }
    const copy: ChatMessage = { ...message };
    delete copy.timelineTrackPatches;
    delete copy.pendingOperations;
    delete copy.thinkingContent;
    return copy;
  });
}

/** Steps the user undid since the watchdog write stay undone. */
function keepUndoneSteps(
  update: AgentToolCallRecord[] | undefined,
  existing: AgentToolCallRecord[] | undefined,
): AgentToolCallRecord[] | undefined {
  if (!update || !existing) return update;
  const undoneIds = new Set(existing.filter((tc) => tc.status === 'undone').map((tc) => tc.id));
  if (undoneIds.size === 0) return update;
  return update.map((tc) => (undoneIds.has(tc.id) ? { ...tc, status: 'undone' as const } : tc));
}

/**
 * Apply a retired turn's late write to its own message. The message keeps the
 * track patches written when the watchdog sealed it (patches computed now
 * would swallow the newer turn's edits) and any undo the user did since.
 * Returns null when the message no longer exists (e.g. the chat was cleared),
 * in which case the write is dropped.
 */
export function replaceRetiredTurnMessage(
  messages: readonly ChatMessage[],
  update: ChatMessage,
): ChatMessage[] | null {
  const index = messages.findIndex((message) => message.id === update.id);
  if (index === -1) return null;
  const existing = messages[index];
  const merged: ChatMessage = {
    ...update,
    agentToolCalls: keepUndoneSteps(update.agentToolCalls, existing.agentToolCalls),
    ...(existing.timelineTrackPatches ? { timelineTrackPatches: existing.timelineTrackPatches } : {}),
    ...(existing.isUndone ? { isUndone: true, pendingOperations: [] } : {}),
  };
  if (!existing.timelineTrackPatches) delete merged.timelineTrackPatches;
  return messages.map((message, i) => (i === index ? merged : message));
}
