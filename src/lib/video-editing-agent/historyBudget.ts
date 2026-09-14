/**
 * historyBudget.ts — keep the conversation replayed to the model within a
 * size budget.
 *
 * Every turn replays every earlier tool result. A `get_timeline` snapshot of
 * a 40-clip timeline is ~8k characters, so ten turns already sent ~100k
 * characters of stale snapshots and ~30 turns hit the context window, where
 * the provider's 400 ended the conversation.
 *
 * Budget, in characters: with the repo's conservative Chinese estimate of
 * ~2 characters per token (agent.ts), 120k characters is ~60k tokens, which
 * leaves room for the system prompt and `maxTokens` inside the 128k window.
 * A smaller model that still overflows gets an accurate "conversation too
 * long" error (AG3-03).
 *
 * Pure: no React, DOM or store access.
 */

import type { Message, ToolResultMessage, UserMessage } from '@mariozechner/pi-ai';

export const HISTORY_CHAR_BUDGET = 120_000;

/** The latest turns are the model's working context and are never changed. */
const RECENT_TURNS_KEPT_VERBATIM = 2;

/** Tools whose results describe state that later turns may have changed. */
const STALE_SNAPSHOT_TOOLS: ReadonlySet<string> = new Set([
  'get_timeline',
  'list_materials',
  'search_materials',
  'check_timeline_overlaps',
]);

/** Synthetic user notes belong to the turn around them, not a new one. */
const SYSTEM_NOTE_PREFIX = '[System note]';

function startsTurn(message: Message): boolean {
  if (message.role !== 'user') return false;
  return !(typeof message.content === 'string' && message.content.startsWith(SYSTEM_NOTE_PREFIX));
}

/**
 * Group messages into turns, each starting at a real user message, so a
 * tool call and its result always stay together. Messages before the first
 * user message form a leading turn of their own.
 */
function splitIntoTurns(messages: readonly Message[]): Message[][] {
  const turns: Message[][] = [];
  for (const message of messages) {
    if (turns.length === 0 || startsTurn(message)) turns.push([]);
    turns[turns.length - 1].push(message);
  }
  return turns;
}

function messageChars(message: Message): number {
  const content: unknown = message.content;
  return typeof content === 'string' ? content.length : JSON.stringify(content).length;
}

function turnChars(turn: readonly Message[]): number {
  return turn.reduce((sum, message) => sum + messageChars(message), 0);
}

function textResult(message: ToolResultMessage, text: string): ToolResultMessage {
  return { ...message, content: [{ type: 'text', text }] };
}

/** The result's JSON with `operations` replaced by their count, or null if unchanged. */
function withoutOperationList(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { operations, ...rest } = parsed as Record<string, unknown>;
  if (!Array.isArray(operations)) return null;
  return JSON.stringify({ ...rest, operationsCount: operations.length });
}

/**
 * An older turn's tool result as the model needs it now: snapshots become a
 * stub asking for a fresh call, and applied operation lists become a count.
 */
function compactOlderMessage(message: Message): Message {
  if (message.role !== 'toolResult') return message;
  if (STALE_SNAPSHOT_TOOLS.has(message.toolName)) {
    return textResult(
      message,
      JSON.stringify({ omitted: `stale ${message.toolName} snapshot; call it again` }),
    );
  }
  const [only] = message.content;
  if (message.content.length !== 1 || only.type !== 'text') return message;
  const compacted = withoutOperationList(only.text);
  return compacted === null ? message : textResult(message, compacted);
}

function omittedTurnsNote(count: number, timestamp: number): UserMessage {
  return {
    role: 'user',
    content: `${SYSTEM_NOTE_PREFIX} ${count} earlier turns omitted to fit the model's context. Call get_timeline or list_materials for the current state.`,
    timestamp,
  };
}

/**
 * Compact the history replayed to the model: older turns lose stale
 * snapshots and operation lists; if that is still over `budget`, whole
 * oldest turns are dropped (never the latest two) and a note says so.
 */
export function compactHistoryForModel(
  messages: readonly Message[],
  budget: number = HISTORY_CHAR_BUDGET,
): Message[] {
  const turns = splitIntoTurns(messages);
  const firstVerbatimTurn = Math.max(0, turns.length - RECENT_TURNS_KEPT_VERBATIM);
  const compacted = turns.map((turn, index) =>
    index < firstVerbatimTurn ? turn.map(compactOlderMessage) : [...turn],
  );

  let total = compacted.reduce((sum, turn) => sum + turnChars(turn), 0);
  let droppedTurns = 0;
  while (total > budget && droppedTurns < firstVerbatimTurn) {
    total -= turnChars(compacted[droppedTurns]);
    droppedTurns += 1;
  }

  const kept = compacted.slice(droppedTurns).flat();
  if (droppedTurns === 0) return kept;
  return [omittedTurnsNote(droppedTurns, kept[0]?.timestamp ?? 0), ...kept];
}
