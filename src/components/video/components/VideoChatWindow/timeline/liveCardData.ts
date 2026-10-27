import type { AcquireSnapshot, CrewSnapshot } from '@/types';
import type { CrewMemberState } from '@/lib/video-editing-agent/types';

/**
 * Pure readers of the `delegate_research` and `acquire_web_materials` tool
 * results. The finished cards are rebuilt from the persisted result alone, so
 * a page reload or a dropped progress event never changes what they show.
 *
 * Tool results are model-adjacent data: every field is validated on the way in
 * and anything unexpected is dropped rather than rendered.
 */

type Rec = Record<string, unknown>;

const MEMBER_STATES: readonly CrewMemberState[] = [
  'queued', 'running', 'done', 'partial', 'failed', 'timeout', 'cancelled',
];
const ACQUIRE_STATUSES = ['ready', 'already_in_library', 'failed', 'skipped'] as const;
export type AcquireItemStatus = (typeof ACQUIRE_STATUSES)[number];

const asRec = (value: unknown): Rec =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : {};
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `{ success, details: {...} }` and a bare details object read the same. */
function unwrapDetails(result: unknown): Rec {
  const outer = asRec(result);
  return { ...outer, ...asRec(outer.details) };
}

/** The tool failed as a whole (`crew_disabled`, `invalid_arguments`, ...). */
export function toolFailureCode(result: unknown): string | null {
  const details = unwrapDetails(result);
  if (details.success !== false) return null;
  return asString(details.error_code) || asString(details.error) || 'failed';
}

// ---------------------------------------------------------------------------
// Research crew
// ---------------------------------------------------------------------------

export interface CrewCandidateView {
  url: string;
  kind: string;
  title: string;
  sourcePageUrl?: string;
  licenseHint?: string;
  why: string;
}

export interface CrewTaskView {
  id: string;
  status: CrewMemberState;
  summary: string;
  candidates: CrewCandidateView[];
  sources: Array<{ url: string; title: string }>;
  gaps: string[];
  droppedUnverified: number;
  toolCalls: number;
  modelCalls: number;
  elapsedMs: number;
}

export interface CrewResultView {
  modelTier: 'fast' | 'main';
  tasks: CrewTaskView[];
}

function toCandidate(raw: unknown): CrewCandidateView | null {
  const entry = asRec(raw);
  const url = asString(entry.url);
  if (!url) return null;
  return {
    url,
    kind: asString(entry.kind) || 'page',
    title: asString(entry.title),
    sourcePageUrl: asString(entry.source_page_url) || undefined,
    licenseHint: asString(entry.license_hint) || undefined,
    why: asString(entry.why),
  };
}

function toTask(raw: unknown): CrewTaskView | null {
  const entry = asRec(raw);
  const id = asString(entry.id);
  if (!id) return null;
  const status = MEMBER_STATES.find(state => state === entry.status) ?? 'failed';
  const usage = asRec(entry.usage);
  return {
    id,
    status,
    summary: asString(entry.summary),
    candidates: asArray(entry.candidates)
      .map(toCandidate).filter((c): c is CrewCandidateView => c !== null),
    sources: asArray(entry.sources).map(source => ({
      url: asString(asRec(source).url), title: asString(asRec(source).title),
    })).filter(source => source.url),
    gaps: asArray(entry.gaps).map(asString).filter(Boolean),
    droppedUnverified: asCount(entry.dropped_unverified),
    toolCalls: asCount(usage.tool_calls),
    modelCalls: asCount(usage.model_calls),
    elapsedMs: asCount(usage.elapsed_ms),
  };
}

/** Per-task view of a successful `delegate_research`; null for any other shape. */
export function parseCrewResult(result: unknown): CrewResultView | null {
  const details = unwrapDetails(result);
  if (details.success === false || !Array.isArray(details.tasks)) return null;
  const tasks = details.tasks.map(toTask).filter((t): t is CrewTaskView => t !== null);
  if (tasks.length === 0) return null;
  return { modelTier: details.model_tier === 'main' ? 'main' : 'fast', tasks };
}

/** The goals the model asked for, by task id (the result itself carries none). */
export function crewGoalsFromParams(params: unknown): Map<string, string> {
  const goals = new Map<string, string>();
  for (const task of asArray(asRec(params).tasks)) {
    const entry = asRec(task);
    const id = asString(entry.id);
    if (id) goals.set(id, asString(entry.goal));
  }
  return goals;
}

/** Terminal snapshot of a crew run, or null when the run produced no tasks. */
export function buildCrewSnapshot(
  result: unknown, params: unknown, crewId: string,
): CrewSnapshot | null {
  const view = parseCrewResult(result);
  if (!view) return null;
  const goals = crewGoalsFromParams(params);
  return {
    crewId,
    modelTier: view.modelTier,
    members: view.tasks.map(task => ({
      id: task.id,
      goal: goals.get(task.id) ?? '',
      state: task.status,
      toolCalls: task.toolCalls,
      candidates: task.candidates.length,
      elapsedMs: task.elapsedMs,
    })),
  };
}

export type CrewActivityKind = 'search' | 'read' | 'images' | 'report' | 'work';

/**
 * `search:<query>` / `read:<host>` / `images:<host>` / `report` / `work`, as sanitised
 * by the server. Anything else is shown verbatim by the caller.
 */
export function parseCrewActivity(
  activity: string | undefined,
): { kind: CrewActivityKind; value: string } | null {
  if (!activity) return null;
  const match = /^(search|read|images|report|work)(?::(.*))?$/.exec(activity);
  return match ? { kind: match[1] as CrewActivityKind, value: match[2] ?? '' } : null;
}

// ---------------------------------------------------------------------------
// Batch acquisition
// ---------------------------------------------------------------------------

export interface AcquireItemView {
  index: number;
  status: AcquireItemStatus;
  name?: string;
  errorCode?: string;
  retryable?: boolean;
  licenseStatus?: 'unknown' | 'declared';
}

export interface AcquireResultView {
  requested: number;
  ready: number;
  failed: number;
  published: boolean;
  items: AcquireItemView[];
}

function toAcquireItem(raw: unknown): AcquireItemView | null {
  const entry = asRec(raw);
  const status = ACQUIRE_STATUSES.find(value => value === entry.status);
  if (!status || typeof entry.index !== 'number') return null;
  return {
    index: entry.index,
    status,
    name: asString(entry.name) || undefined,
    errorCode: asString(entry.error_code) || undefined,
    retryable: typeof entry.retryable === 'boolean' ? entry.retryable : undefined,
    licenseStatus: entry.license_status === 'unknown' || entry.license_status === 'declared'
      ? entry.license_status : undefined,
  };
}

export function parseAcquireResult(result: unknown): AcquireResultView | null {
  const details = unwrapDetails(result);
  if (details.success === false || !Array.isArray(details.items)) return null;
  const items = details.items.map(toAcquireItem).filter((i): i is AcquireItemView => i !== null);
  return {
    requested: asCount(details.requested) || items.length,
    ready: asCount(details.ready),
    failed: asCount(details.failed),
    published: details.published === true,
    items: items.sort((a, b) => a.index - b.index),
  };
}

export function buildAcquireSnapshot(result: unknown): AcquireSnapshot | null {
  const view = parseAcquireResult(result);
  if (!view) return null;
  return { requested: view.requested, published: view.published, items: view.items };
}

/** How many slots the grid shows while the batch runs (from the call's params). */
export function requestedItemCount(params: unknown): number {
  return asArray(asRec(params).items).length;
}
