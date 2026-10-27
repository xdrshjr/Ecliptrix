import { utf8Slice } from '../modelContextBudget';
import {
  CANDIDATE_KINDS,
  type CandidateKind,
  type CrewCandidate,
  type CrewSource,
  type CrewTaskResult,
  type VerifiedReport,
} from './crewTypes';

/** Per-task result budget (crew spec R-12): 4 x 2.6 KiB + envelope < 11 KiB. */
export const TASK_BYTE_LIMIT = Math.floor(2.6 * 1024);
export const RESULT_BYTE_LIMIT = 11 * 1024;

const MAX_URL_LENGTH = 512;
const MAX_SEEN_URLS = 2000;
const MAX_SOURCES = 5;
const MAX_GAPS = 3;
const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Everything a member's tool results showed it; the only source of truth for a report. */
export interface SeenSet {
  urls: Set<string>;
  candidateIds: Set<string>;
}

export function createSeenSet(): SeenSet {
  return { urls: new Set(), candidateIds: new Set() };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Strips control characters (they could smuggle terminal or layout tricks into
 * the UI), collapses whitespace and truncates by code point.
 */
export function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  let plain = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    plain += code < 32 || (code >= 127 && code < 160) ? ' ' : character;
  }
  return Array.from(plain.replace(/\s+/g, ' ').trim()).slice(0, maxChars).join('');
}

function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH * 4) return null;
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  parsed.hash = '';
  return parsed;
}

/** Lower-case host, no fragment, no trailing slash: the comparison key for "seen". */
export function normalizeUrl(raw: unknown): string | null {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return null;
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : '';
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}

function collectCandidateIds(value: unknown, ids: Set<string>, depth = 0): void {
  if (depth > 8 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectCandidateIds(item, ids, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'candidate_id' && typeof nested === 'string' && UUID_PATTERN.test(nested)) {
      ids.add(nested);
    } else {
      collectCandidateIds(nested, ids, depth + 1);
    }
  }
}

/** Drops sentence punctuation and unbalanced closing brackets from a URL found in prose. */
function trimProse(url: string): string {
  let trimmed = url.replace(/[.,;:!?]+$/, '');
  const count = (character: string) => trimmed.split(character).length - 1;
  while (/[)\]}]$/.test(trimmed) && count(trimmed.slice(-1)) > count(
    { ')': '(', ']': '[', '}': '{' }[trimmed.slice(-1)] as string)) {
    trimmed = trimmed.slice(0, -1).replace(/[.,;:!?]+$/, '');
  }
  return trimmed;
}

/** Records every `candidate_id` and http(s) URL in one (already sanitised) tool result. */
export function recordSeen(value: unknown, seen: SeenSet): void {
  collectCandidateIds(value, seen.candidateIds);
  const text = JSON.stringify(value) ?? '';
  for (const match of Array.from(text.matchAll(URL_PATTERN))) {
    // Prose often glues punctuation to a URL; remember both readings.
    for (const reading of [match[0], trimProse(match[0])]) {
      const key = normalizeUrl(reading);
      if (key && seen.urls.size < MAX_SEEN_URLS) seen.urls.add(key);
    }
  }
}

function verifyCandidate(entry: unknown, seen: SeenSet): CrewCandidate | null {
  if (!isRecord(entry)) return null;
  const parsed = parseHttpUrl(entry.url);
  const kind = CANDIDATE_KINDS.find(item => item === entry.kind);
  if (!parsed || !kind || parsed.href.length > MAX_URL_LENGTH) return null;
  const id = typeof entry.candidate_id === 'string' ? entry.candidate_id : '';
  const idSeen = UUID_PATTERN.test(id) && seen.candidateIds.has(id);
  const urlSeen = seen.urls.has(normalizeUrl(parsed.href) ?? '');
  if (!idSeen && !urlSeen) return null;
  return withOptional({
    url: parsed.href, kind: kind as CandidateKind,
    title: cleanText(entry.title, 80), why: cleanText(entry.why, 120),
  }, {
    // An unseen id next to a seen URL is dropped, never forwarded.
    candidate_id: idSeen ? id : undefined,
    source_page_url: parseHttpUrl(entry.source_page_url)?.href,
    license_hint: cleanText(entry.license_hint, 60) || undefined,
  });
}

function withOptional(base: Omit<CrewCandidate, 'candidate_id' | 'source_page_url' | 'license_hint'>,
  optional: Pick<CrewCandidate, 'candidate_id' | 'source_page_url' | 'license_hint'>): CrewCandidate {
  const present = Object.fromEntries(Object.entries(optional).filter(([, value]) => value));
  return { ...base, ...present };
}

function verifySources(value: unknown, seen: SeenSet): { sources: CrewSource[]; dropped: number } {
  const sources: CrewSource[] = [];
  let dropped = 0;
  for (const entry of Array.isArray(value) ? value.slice(0, MAX_SOURCES) : []) {
    const parsed = isRecord(entry) ? parseHttpUrl(entry.url) : null;
    const seenUrl = parsed && parsed.href.length <= MAX_URL_LENGTH &&
      seen.urls.has(normalizeUrl(parsed.href) ?? '');
    if (!parsed || !seenUrl) { dropped += 1; continue; }
    sources.push({ url: parsed.href, title: cleanText((entry as Record<string, unknown>).title, 80) });
  }
  return { sources, dropped };
}

/**
 * "Seen or it does not count" (crew spec §3.3.5): a candidate or source survives
 * only if its `candidate_id` or URL appeared in a tool result the member
 * actually received. Everything else is counted in `dropped_unverified`.
 */
export function verifyReport(raw: unknown, seen: SeenSet, maxCandidates: number): VerifiedReport {
  const report = isRecord(raw) ? raw : {};
  const candidates: CrewCandidate[] = [];
  let dropped = 0;
  for (const entry of Array.isArray(report.candidates) ? report.candidates : []) {
    if (candidates.length >= maxCandidates) break;
    const verified = verifyCandidate(entry, seen);
    if (verified) candidates.push(verified); else dropped += 1;
  }
  const checked = verifySources(report.sources, seen);
  const gaps = (Array.isArray(report.gaps) ? report.gaps : [])
    .map(gap => cleanText(gap, 120)).filter(Boolean).slice(0, MAX_GAPS);
  return { summary: cleanText(report.summary, 600), candidates, sources: checked.sources,
    gaps, dropped_unverified: dropped + checked.dropped };
}

/**
 * Last resort for a member stopped before `submit_report`: a JSON object in its
 * last message. It still goes through `verifyReport`, so it cannot inject
 * anything a submitted report could not.
 */
export function parseDraftReport(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const draft: unknown = JSON.parse(text.slice(start, end + 1));
    return isRecord(draft) ? draft : null;
  } catch { return null; }
}

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Shrinks one task result to `maxBytes` (UTF-8, as serialised): candidate tail
 * first, then sources, gaps, and the summary last, so the most useful part of a
 * report survives longest.
 */
export function fitTaskToBudget(task: CrewTaskResult, maxBytes = TASK_BYTE_LIMIT):
  { task: CrewTaskResult; truncated: boolean } {
  let current = task;
  let truncated = false;
  for (const field of ['candidates', 'sources', 'gaps'] as const) {
    while (byteLength(current) > maxBytes && current[field].length) {
      current = { ...current, [field]: current[field].slice(0, -1) };
      truncated = true;
    }
  }
  while (byteLength(current) > maxBytes && current.summary) {
    const excess = byteLength(current) - maxBytes;
    const target = Math.max(0, new TextEncoder().encode(current.summary).length - excess);
    current = { ...current, summary: utf8Slice(current.summary, target) };
    truncated = true;
  }
  return { task: current, truncated };
}

/** Applies the per-task budget to every task; the total cap follows from it. */
export function fitResultToBudget(tasks: CrewTaskResult[]): { tasks: CrewTaskResult[]; truncated: boolean } {
  // 700 bytes of envelope (model_tier, next_step, ...) is reserved from the total.
  const perTask = Math.min(TASK_BYTE_LIMIT, Math.floor((RESULT_BYTE_LIMIT - 700) / Math.max(1, tasks.length)));
  const fitted = tasks.map(task => fitTaskToBudget(task, perTask));
  return { tasks: fitted.map(item => item.task), truncated: fitted.some(item => item.truncated) };
}
