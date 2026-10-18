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

/** A response and every result from its tool batch are indivisible. */
export function groupToolBatches(messages: readonly Message[]): Message[][] {
  const groups: Message[][] = [];
  for (const message of messages) {
    if (message.role === 'toolResult' && groups.length) {
      groups[groups.length - 1].push(message);
    } else {
      groups.push([message]);
    }
  }
  return groups;
}

/** The latest turns are the model's working context and are never changed. */
const RECENT_TURNS_KEPT_VERBATIM = 2;

/** Tools whose results describe state that later turns may have changed. */
const STALE_SNAPSHOT_TOOLS: ReadonlySet<string> = new Set([
  'get_timeline',
  'list_materials',
  'search_materials',
  'check_timeline_overlaps',
]);

/**
 * Tools whose OLDER results are pure history: only the latest one matters, and a
 * superseded plan/ask is worse than useless (it shows a plan the model no longer
 * follows, or a question it already asked). agent-general-toolkit spec §3.5.1.
 */
const LATEST_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'update_plan',
  'ask_user',
]);

/** 被取代的旧结果在历史里显示的名词（`update_plan` → plan 等）。 */
const OMITTED_NOUNS: Record<string, string> = {
  update_plan: 'plan',
  ask_user: 'question',
};

/** Synthetic user notes belong to the turn around them, not a new one. */
const SYSTEM_NOTE_PREFIX = '[System note]';

/** Keep recent reading handles across both history and provider compaction. */
export function collectResearchArtifactIds(messages: readonly Message[]): string[] {
  const ids = new Set<string>();
  let bytes = 0;
  const add = (id: string) => {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(id) || ids.has(id)) return;
    const size = id.length + (ids.size ? 1 : 0);
    if (ids.size >= 80 || bytes + size > 4096) return;
    ids.add(id);
    bytes += size;
  };
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'user' && typeof message.content === 'string' &&
      message.content.startsWith(SYSTEM_NOTE_PREFIX)) {
      const match = message.content.match(/Artifacts: ([a-zA-Z0-9,-]+)$/);
      if (match) match[1].split(',').forEach(add);
    }
    if (message.role !== 'toolResult') continue;
    for (const block of message.content) {
      if (block.type !== 'text') continue;
      for (const match of Array.from(block.text.matchAll(/"(?:artifact_id|snapshot_artifact_id)"\s*:\s*"([a-zA-Z0-9-]{1,128})"/g))) {
        add(match[1]);
      }
    }
  }
  return Array.from(ids);
}

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

function omittedTurnsNote(count: number, timestamp: number, artifactIds: string[]): UserMessage {
  return {
    role: 'user',
    content: `${SYSTEM_NOTE_PREFIX} ${count} earlier turns omitted to fit the model's context. Call get_timeline or list_materials for the current state.` +
      (artifactIds.length ? ' Read research artifacts by ID before judging source quality. Artifacts: ' + artifactIds.join(',') : ''),
    timestamp,
  };
}

/**
 * Keep only the newest result of each `LATEST_ONLY_TOOLS` tool.
 *
 * Deliberately runs across **every** kept turn, including the ones
 * `RECENT_TURNS_KEPT_VERBATIM` protects: a superseded plan is actively
 * misleading (it shows steps the model no longer follows), and an old
 * `ask_user` result would re-render a question that was already answered.
 * This is a dedicated pass rather than a `compactOlderMessage` branch because
 * the chat route injects its own compactor, which would bypass that branch.
 */
function stubSupersededLatestOnly(messages: Message[]): Message[] {
  const latest = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role === 'toolResult'
      && LATEST_ONLY_TOOLS.has(message.toolName)) {
      latest.set(message.toolName, index);
    }
  });
  if (latest.size === 0) return messages;
  return messages.map((message, index) => {
    if (message.role !== 'toolResult') return message;
    if (!LATEST_ONLY_TOOLS.has(message.toolName)) return message;
    if (latest.get(message.toolName) === index) return message;
    // 旧结果按工具名给出可读原因：同一条通道里既有被取代的计划，也有被取代的提问。
    const noun = OMITTED_NOUNS[message.toolName] ?? 'result';
    return textResult(
      message, JSON.stringify({ omitted: `superseded ${noun}` }));
  });
}

/**
 * Compact the history replayed to the model: older turns lose stale
 * snapshots and operation lists; if that is still over `budget`, whole
 * oldest turns are dropped (never the latest two) and a note says so.
 */
export function compactHistoryForModel(
  messages: readonly Message[],
  budget: number = HISTORY_CHAR_BUDGET,
  // The caller passes the request-level compactor so history and request
  // trimming share ONE artifact-summary implementation (spec §3.3). Passing it
  // in (instead of importing) keeps this module free of an import cycle.
  compactToolResult: (message: Message) => Message = compactOlderMessage,
): Message[] {
  const turns = splitIntoTurns(messages);
  const firstVerbatimTurn = Math.max(0, turns.length - RECENT_TURNS_KEPT_VERBATIM);
  const compacted = turns.map((turn, index) =>
    index < firstVerbatimTurn ? turn.map(compactToolResult) : [...turn],
  );

  // 先做「只留最新」再算总量：这一步省下的字符必须计入预算，否则会多丢整轮
  // 历史（§3.5.1 的 LATEST_ONLY_TOOLS）。
  const stubbed = splitIntoTurns(stubSupersededLatestOnly(compacted.flat()));
  let total = stubbed.reduce((sum, turn) => sum + turnChars(turn), 0);
  let droppedTurns = 0;
  while (total > budget && droppedTurns < firstVerbatimTurn) {
    total -= turnChars(stubbed[droppedTurns]);
    droppedTurns += 1;
  }

  const kept = stubbed.slice(droppedTurns).flat();
  if (droppedTurns === 0) return kept;
  const artifactIds = collectResearchArtifactIds(compacted.slice(0, droppedTurns).flat());
  return [omittedTurnsNote(droppedTurns, kept[0]?.timestamp ?? 0, artifactIds), ...kept];
}
