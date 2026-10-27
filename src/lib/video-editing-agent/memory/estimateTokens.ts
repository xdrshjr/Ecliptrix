/**
 * estimateTokens.ts — client-safe token estimate of what the model would see.
 *
 * Mirrors the server's `budgetModelContext` accounting (2 bytes per token,
 * per-message and per-request overhead) so the context ring can show a reading
 * between turns, when no `context_usage` event is available. Display only: the
 * hard decision whether a request fits stays with `budgetModelContext`.
 *
 * Why the constants are re-declared instead of imported: `modelContextBudget`
 * imports the pi-ai package root at runtime, which registers every provider SDK
 * and must not enter a browser bundle. `estimateTokens.test.ts` pins every
 * constant here to the server's value and compares both estimators on real
 * fixtures, so the duplication cannot drift silently. Revert this duplication
 * once `bytesToTokens` / `compactResult` move to a pi-ai-free module.
 *
 * Pure: no React, DOM, network or store access.
 */

import type { Message } from '@mariozechner/pi-ai';
import type { ChatMessage } from '@/types';
import { compactHistoryForModel } from '../historyBudget';
import { convertToAgentMessages } from '../messageConverter';

/** Same value as `BYTES_PER_TOKEN` in modelContextBudget.ts. */
export const ESTIMATE_BYTES_PER_TOKEN = 2;
const PER_MESSAGE_OVERHEAD_BYTES = 16;
const REQUEST_OVERHEAD_BYTES = 1024;
/** Same threshold and summary size as the default `compactResult`. */
const INLINE_RESULT_BYTES = 1800;
const SUMMARY_BYTES = 512;
const HANDLE_BYTES = 256;
const HANDLE_KEYS = ['artifact_id', 'snapshot_artifact_id', 'screenshot_artifact_id',
  'session_id', 'title', 'error_code'] as const;
const SUMMARY_KEYS = ['summary', 'brief', 'text', 'content'] as const;

const encoder = new TextEncoder();

export interface EstimateOptions {
  /**
   * Bytes of the system prompt (plus tool schemas) the request will carry. The
   * conversation alone is estimated when omitted; callers that know the last
   * server reading can calibrate with it.
   */
  systemPromptBytes?: number;
}

const byteLength = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).length;

/** Bytes → tokens, rounded up so the estimate is never under-reported. */
export function bytesToEstimatedTokens(bytes: number): number {
  return Math.ceil(bytes / ESTIMATE_BYTES_PER_TOKEN);
}

/** Token estimate of one plain string (summary text, notes). */
export function estimateTextTokens(text: string): number {
  return bytesToEstimatedTokens(encoder.encode(text).length);
}

function sliceUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const character of text) {
    bytes += encoder.encode(character).length;
    if (bytes > maxBytes) break;
    result += character;
  }
  return result;
}

function readResultText(message: Extract<Message, { role: 'toolResult' }>): string {
  return message.content
    .flatMap(block => (block.type === 'text' ? [block.text] : [])).join('');
}

/** The handle-and-summary reference `compactResult` leaves of a large result. */
function buildReference(text: string): Record<string, unknown> {
  let source: Record<string, unknown> = {};
  let summary = sliceUtf8(text, SUMMARY_BYTES);
  try {
    const raw: unknown = JSON.parse(text);
    if (raw && typeof raw === 'object') {
      const record = raw as Record<string, unknown>;
      source = (record.data && typeof record.data === 'object'
        ? record.data : record) as Record<string, unknown>;
      const found = SUMMARY_KEYS.map(key => source[key]).find(v => v !== undefined && v !== null);
      summary = sliceUtf8(typeof found === 'string' ? found : '', SUMMARY_BYTES);
    }
  } catch { /* plain-text result: the leading slice is the summary */ }
  const reference: Record<string, unknown> = {
    model_status: 'unknown',
    evidence_note: '压缩摘要不等于完整证据；使用 artifact_id 读取',
  };
  for (const key of HANDLE_KEYS) {
    const value = source[key];
    if (typeof value === 'string') reference[key] = sliceUtf8(value, HANDLE_BYTES);
  }
  reference.summary = summary;
  reference.omitted = 'Read the artifact or query current editor state for more.';
  return reference;
}

/** Size-equivalent of the server's `compactResult(message)` for older turns. */
function approximateCompactResult(message: Message): Message {
  if (message.role !== 'toolResult') return message;
  const content = message.content.filter(block => block.type !== 'image');
  if (byteLength(content) < INLINE_RESULT_BYTES) return { ...message, content };
  const text = JSON.stringify(buildReference(readResultText(message)));
  return { ...message, content: [{ type: 'text', text }] };
}

/**
 * Estimated tokens the model would receive for `messages`.
 *
 * Applies the same views the server does: the compaction barrier (only the
 * latest compaction digest and what follows it count), stale-snapshot stubs and
 * large-result references for older turns. Oldest-turn dropping is deliberately
 * NOT applied: the reading answers "how big is this conversation", which is
 * what decides when to compact, not what survives a lossy fallback.
 */
export function estimateConversationTokens(
  messages: readonly ChatMessage[],
  options: EstimateOptions = {},
): number {
  const converted = compactHistoryForModel(
    convertToAgentMessages([...messages]), Number.POSITIVE_INFINITY, approximateCompactResult);
  const bytes = byteLength({ messages: converted })
    + PER_MESSAGE_OVERHEAD_BYTES * converted.length
    + REQUEST_OVERHEAD_BYTES
    + (options.systemPromptBytes ?? 0);
  return bytesToEstimatedTokens(bytes);
}
