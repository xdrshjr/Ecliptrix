/**
 * summaryValidation.ts — turn the summarizer's raw text into a trusted digest.
 *
 * Two gates, both fail-closed:
 *   1. shape: strict JSON (no duplicate keys, no extra top-level fields, right
 *      types), every string flattened to one capped line;
 *   2. identifiers: a material / artifact id the model emits is kept only if it
 *      appears literally in the folded transcript or the previous digest. The
 *      ids are later fed to tools, and an invented id is worse than a missing
 *      one (spec §3.4.2 step 4).
 *
 * Pure: no React, DOM or network access.
 */

import { StrictJsonError, parseStrictJson, stripCodeFence } from './strictJson';
import {
  SAFE_IDENTIFIER, SUMMARY_KEYS, SUMMARY_LIMITS, type ConversationSummary,
} from './summaryTemplate';

/** The summarizer answered, but not with a usable digest. */
export class InvalidSummaryError extends Error {
  constructor(reason: string) {
    super(`compact_invalid_summary: ${reason}`);
    this.name = 'InvalidSummaryError';
  }
}

type Json = Record<string, unknown>;

/** C0/C1 controls plus the Unicode line and paragraph separators. */
function isControlOrSeparator(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** Single line, controls and separators flattened, clipped by code points. */
function oneLine(value: string, maxChars: number): string {
  const flat = Array.from(value).map(c => (isControlOrSeparator(c) ? ' ' : c)).join('')
    .replace(/`/g, "'").replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, maxChars).join('');
}

function expectObject(value: unknown, where: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidSummaryError(`${where} must be an object`);
  }
  return value as Json;
}

function expectString(value: unknown, where: string, optional = false): string {
  if (typeof value === 'string') return value;
  if (optional && value === undefined) return '';
  throw new InvalidSummaryError(`${where} must be a string`);
}

function expectArray(value: unknown, where: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidSummaryError(`${where} must be an array`);
  return value;
}

function readLines(value: unknown, where: string, maxChars: number, maxItems: number): string[] {
  return expectArray(value, where)
    .map((item, index) => oneLine(expectString(item, `${where}[${index}]`), maxChars))
    .filter(Boolean).slice(0, maxItems);
}

function readMaterials(value: unknown): ConversationSummary['materials'] {
  return expectArray(value, 'materials').slice(0, SUMMARY_LIMITS.materials).map((item, index) => {
    const entry = expectObject(item, `materials[${index}]`);
    return {
      id: expectString(entry.id, `materials[${index}].id`).trim(),
      name: oneLine(expectString(entry.name, `materials[${index}].name`, true), SUMMARY_LIMITS.materialName),
      note: oneLine(expectString(entry.note, `materials[${index}].note`, true), SUMMARY_LIMITS.materialNote),
    };
  });
}

function readResearch(value: unknown): ConversationSummary['research'] {
  return expectArray(value, 'research').slice(0, SUMMARY_LIMITS.research).map((item, index) => {
    const entry = expectObject(item, `research[${index}]`);
    const where = `research[${index}]`;
    return {
      topic: oneLine(expectString(entry.topic, `${where}.topic`), SUMMARY_LIMITS.topic),
      conclusion: oneLine(expectString(entry.conclusion, `${where}.conclusion`, true), SUMMARY_LIMITS.conclusion),
      artifact_ids: expectArray(entry.artifact_ids, `${where}.artifact_ids`)
        .map((id, at) => expectString(id, `${where}.artifact_ids[${at}]`).trim()),
    };
  }).filter(entry => entry.topic || entry.conclusion);
}

function assertKnownKeys(root: Json): void {
  const allowed: ReadonlySet<string> = new Set(SUMMARY_KEYS);
  const extra = Object.keys(root).filter(key => !allowed.has(key));
  if (extra.length) throw new InvalidSummaryError(`unexpected field "${extra[0]}"`);
}

/**
 * Parse and normalise the summarizer's reply.
 *
 * @throws InvalidSummaryError for malformed JSON, duplicate keys, a non-object
 *   root, extra top-level fields or mistyped fields.
 */
export function parseSummaryJson(raw: string): ConversationSummary {
  let parsed: unknown;
  try {
    parsed = parseStrictJson(stripCodeFence(raw));
  } catch (error) {
    if (error instanceof StrictJsonError) throw new InvalidSummaryError(error.message);
    throw error;
  }
  const root = expectObject(parsed, 'summary');
  assertKnownKeys(root);
  return {
    goal: oneLine(expectString(root.goal, 'goal', true), SUMMARY_LIMITS.goal),
    decisions: readLines(root.decisions, 'decisions', SUMMARY_LIMITS.decision, SUMMARY_LIMITS.decisions),
    timeline_notes: oneLine(expectString(root.timeline_notes, 'timeline_notes', true), SUMMARY_LIMITS.timelineNotes),
    materials: readMaterials(root.materials),
    research: readResearch(root.research),
    open_items: readLines(root.open_items, 'open_items', SUMMARY_LIMITS.openItem, SUMMARY_LIMITS.openItems),
    avoid: readLines(root.avoid, 'avoid', SUMMARY_LIMITS.avoidItem, SUMMARY_LIMITS.avoids),
  };
}

export interface VerifiedSummary {
  summary: ConversationSummary;
  /** Ids (or whole material entries) removed because they were not witnessed. */
  droppedIds: number;
}

/** Keep only ids that are well-formed AND literally present in `corpus`. */
export function verifyIdentifiers(
  summary: ConversationSummary,
  corpus: string,
): VerifiedSummary {
  const isWitnessed = (id: string) => SAFE_IDENTIFIER.test(id) && corpus.includes(id);
  let droppedIds = 0;
  const materials = summary.materials.filter(entry => {
    const keep = isWitnessed(entry.id);
    if (!keep) droppedIds += 1;
    return keep;
  });
  const research = summary.research.map(entry => {
    const artifactIds = Array.from(new Set(entry.artifact_ids)).slice(0, SUMMARY_LIMITS.artifactIds);
    const kept = artifactIds.filter(isWitnessed);
    droppedIds += artifactIds.length - kept.length;
    return { ...entry, artifact_ids: kept };
  });
  return { summary: { ...summary, materials, research }, droppedIds };
}
