/**
 * buildTranscript.ts — the plain-text transcript the summarizer reads.
 *
 * Trust boundary (spec §3.4.2 step 1, review R-07): the digest is re-injected
 * as a user-role message on every later turn, so text an attacker controls must
 * not reach it. Results and calls of web/research tools therefore contribute
 * ONLY their tool name, outcome and inert identifiers (candidate / material /
 * artifact ids, source host names) — never a page body, snippet, title or any
 * model-written summary of one. What the assistant itself said about a page is
 * already in its own message text.
 *
 * Pure: no React, DOM or network access.
 */

import type { Message, ToolResultMessage } from '@mariozechner/pi-ai';
import type { ChatMessage } from '@/types';
import { STALE_SNAPSHOT_TOOLS } from '../historyBudget';
import { convertToAgentMessages } from '../messageConverter';
import { compactResult } from '../modelContextBudget';
import { isResearchTool } from '../researchEventSanitizer';
import { SAFE_IDENTIFIER } from './summaryTemplate';

/** Per-result byte budget, as in spec §3.4.2 step 1. */
const RESULT_SUMMARY_BYTES = 400;
const CALL_PARAMS_CHARS = 300;
const MAX_IDENTIFIERS = 20;
const MAX_WALK_NODES = 500;
const MAX_WALK_DEPTH = 6;
const SYSTEM_NOTE_PREFIX = '[System note]';

const ID_KEYS: ReadonlySet<string> = new Set([
  'candidate_id', 'material_id', 'artifact_id', 'snapshot_artifact_id',
  'screenshot_artifact_id',
]);
const URL_KEYS: ReadonlySet<string> = new Set(['source_page_url', 'page_url', 'url']);
const UNTRUSTED_TOOLS: ReadonlySet<string> = new Set([
  'delegate_research', 'acquire_web_materials',
]);

/** One transcript line; `toolName` is set for the lines of a tool call/result. */
export interface TranscriptRow {
  text: string;
  toolName?: string;
}

/** True for tools whose output may carry text written by a third party. */
export function isUntrustedTool(name: string): boolean {
  return isResearchTool(name) || UNTRUSTED_TOOLS.has(name);
}

function hostOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return /^[a-z0-9.-]{1,253}$/i.test(url.hostname) ? url.hostname : null;
  } catch {
    return null;
  }
}

function describeEntry(key: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (ID_KEYS.has(key)) return SAFE_IDENTIFIER.test(value) ? `${key}=${value}` : null;
  if (!URL_KEYS.has(key)) return null;
  const host = hostOf(value);
  return host ? `host=${host}` : null;
}

/** Inert identifiers found anywhere in `value`, in first-seen order. */
export function collectIdentifiers(value: unknown): string[] {
  const found = new Set<string>();
  const pending: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  let visited = 0;
  while (pending.length && visited < MAX_WALK_NODES && found.size < MAX_IDENTIFIERS) {
    const { node, depth } = pending.pop()!;
    visited += 1;
    if (!node || typeof node !== 'object' || depth > MAX_WALK_DEPTH) continue;
    for (const [key, child] of Object.entries(node)) {
      const entry = Array.isArray(node) ? null : describeEntry(key, child);
      if (entry) found.add(entry);
      else pending.push({ node: child, depth: depth + 1 });
    }
  }
  return Array.from(found);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function resultText(message: ToolResultMessage): string {
  return message.content
    .flatMap(block => (block.type === 'text' ? [block.text] : [])).join('');
}

function untrustedResultRow(message: ToolResultMessage): TranscriptRow {
  const body = parseJson(resultText(message));
  const failed = message.isError
    || (!!body && typeof body === 'object' && (body as { success?: unknown }).success === false);
  const ids = collectIdentifiers(body);
  return {
    text: `[tool:${message.toolName}→${failed ? 'error' : 'ok'}]${ids.length ? ` ${ids.join(' ')}` : ''}`,
    toolName: message.toolName,
  };
}

function trustedResultRow(message: ToolResultMessage): TranscriptRow {
  const compacted = compactResult(message, RESULT_SUMMARY_BYTES) as ToolResultMessage;
  const status = message.isError ? 'error' : 'ok';
  return {
    text: `[tool:${message.toolName}→${status}] ${resultText(compacted)}`,
    toolName: message.toolName,
  };
}

function callRow(name: string, params: unknown): TranscriptRow {
  if (isUntrustedTool(name)) {
    const ids = collectIdentifiers(params);
    return { text: `[call:${name}]${ids.length ? ` ${ids.join(' ')}` : ''}`, toolName: name };
  }
  const serialized = JSON.stringify(params ?? {}).slice(0, CALL_PARAMS_CHARS);
  return { text: `[call:${name}] ${serialized}`, toolName: name };
}

function userText(message: Extract<Message, { role: 'user' }>): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('');
}

function rowsOf(message: Message): TranscriptRow[] {
  if (message.role === 'user') {
    const text = userText(message);
    return text.startsWith(SYSTEM_NOTE_PREFIX) ? [] : [{ text: `[user] ${text}` }];
  }
  if (message.role === 'toolResult') {
    return [isUntrustedTool(message.toolName)
      ? untrustedResultRow(message) : trustedResultRow(message)];
  }
  return message.content.flatMap((block): TranscriptRow[] => {
    if (block.type === 'text') return block.text ? [{ text: `[assistant] ${block.text}` }] : [];
    return block.type === 'toolCall' ? [callRow(block.name, block.arguments)] : [];
  });
}

/** Transcript rows for the folded segment, in conversation order. */
export function buildTranscriptRows(messages: ChatMessage[]): TranscriptRow[] {
  return convertToAgentMessages(messages).flatMap(rowsOf);
}

const joinRows = (rows: TranscriptRow[]): string => rows.map(row => row.text).join('\n');

/**
 * The transcript as one string of at most `maxChars`, or `null` when it does
 * not fit even after dropping the rows of tools whose output goes stale
 * (`STALE_SNAPSHOT_TOOLS`): a snapshot is worth less than keeping the decisions.
 */
export function fitTranscript(rows: TranscriptRow[], maxChars: number): string | null {
  const full = joinRows(rows);
  if (full.length <= maxChars) return full;
  const reduced = joinRows(rows.filter(
    row => !row.toolName || !STALE_SNAPSHOT_TOOLS.has(row.toolName)));
  return reduced.length <= maxChars ? reduced : null;
}
