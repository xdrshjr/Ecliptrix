/**
 * historyCompanion — lets ONE timeline history entry also carry a script
 * patch, so a segment command (delete / reorder / apply voice / replace
 * visual) is undone with a single Ctrl+Z across the script and the timeline
 * (spec R2 §3.3).
 *
 * The timeline history only stores timeline snapshots. A segment command
 * records its script change as `ScriptOp`s in the entry's payload; undo/redo
 * hand them to the one registered restorer, which patches the CURRENT script
 * instead of rolling back to a snapshot — text typed after the command
 * survives the undo.
 */

import type { ScriptSegment } from '@/types';

export type ScriptOp =
  | { type: 'remove-segment'; segment: ScriptSegment; index: number }
  | { type: 'insert-segment'; segment: ScriptSegment; index: number }
  | { type: 'reorder'; beforeOrder: string[]; afterOrder: string[] }
  | {
      type: 'patch-segment';
      segmentId: string;
      before: Partial<ScriptSegment>;
      after: Partial<ScriptSegment>;
    };

export interface HistoryCompanion {
  kind: 'script-ops';
  ops: ScriptOp[];
}

export type CompanionDirection = 'forward' | 'inverse';
export type CompanionRestorer = (ops: ScriptOp[], direction: CompanionDirection) => void;

let activeRestorer: CompanionRestorer | null = null;

/**
 * Register the restorer (last registration wins). The returned function only
 * unregisters while `fn` is still the active one, so StrictMode's
 * register → unregister → register order never drops the newer restorer.
 */
export function registerCompanionRestorer(fn: CompanionRestorer): () => void {
  activeRestorer = fn;
  return () => {
    if (activeRestorer === fn) activeRestorer = null;
  };
}

/** Narrow an unknown history payload to its companion, if it carries one. */
export function readCompanion(payload: unknown): HistoryCompanion | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const companion = (payload as { companion?: unknown }).companion;
  if (typeof companion !== 'object' || companion === null) return null;
  const candidate = companion as Partial<HistoryCompanion>;
  if (candidate.kind !== 'script-ops' || !Array.isArray(candidate.ops)) return null;
  return candidate as HistoryCompanion;
}

/** Run the companion of a history payload (no-op when it has none). */
export function runCompanion(payload: unknown, direction: CompanionDirection): void {
  const companion = readCompanion(payload);
  if (!companion || companion.ops.length === 0) return;
  if (!activeRestorer) {
    console.warn('[historyCompanion] no restorer registered; script patch skipped', {
      direction,
      opCount: companion.ops.length,
    });
    return;
  }
  try {
    activeRestorer(companion.ops, direction);
  } catch (error) {
    console.error('[historyCompanion] restorer failed', { direction, error });
  }
}

// ---------------------------------------------------------------------------
// applyScriptOps — pure
// ---------------------------------------------------------------------------

function insertAt(
  segments: ScriptSegment[],
  segment: ScriptSegment,
  index: number,
): ScriptSegment[] {
  if (segments.some((existing) => existing.id === segment.id)) return segments;
  const next = segments.slice();
  next.splice(Math.min(Math.max(index, 0), next.length), 0, structuredClone(segment));
  return next;
}

function removeById(segments: ScriptSegment[], id: string): ScriptSegment[] {
  return segments.filter((segment) => segment.id !== id);
}

/**
 * Sort the ids present in `order` by it; segments absent from `order` (added
 * after the command) keep their relative position and go to the end.
 */
function sortByOrder(segments: ScriptSegment[], order: readonly string[]): ScriptSegment[] {
  const rank = new Map(order.map((id, position) => [id, position]));
  const ranked = segments.filter((segment) => rank.has(segment.id));
  const unranked = segments.filter((segment) => !rank.has(segment.id));
  ranked.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...ranked, ...unranked];
}

function patch(
  segments: ScriptSegment[],
  segmentId: string,
  values: Partial<ScriptSegment>,
): ScriptSegment[] {
  if (!segments.some((segment) => segment.id === segmentId)) return segments;
  return segments.map((segment) => {
    if (segment.id !== segmentId) return segment;
    const next: ScriptSegment = { ...segment };
    const record = next as unknown as Record<string, unknown>;
    Object.entries(values).forEach(([key, value]) => {
      if (value === undefined) delete record[key];
      else record[key] = value;
    });
    return next;
  });
}

function applyOne(
  segments: ScriptSegment[],
  op: ScriptOp,
  direction: CompanionDirection,
): ScriptSegment[] {
  const forward = direction === 'forward';
  switch (op.type) {
    case 'remove-segment':
      return forward
        ? removeById(segments, op.segment.id)
        : insertAt(segments, op.segment, op.index);
    case 'insert-segment':
      return forward
        ? insertAt(segments, op.segment, op.index)
        : removeById(segments, op.segment.id);
    case 'reorder':
      return sortByOrder(segments, forward ? op.afterOrder : op.beforeOrder);
    case 'patch-segment':
      return patch(segments, op.segmentId, forward ? op.after : op.before);
    default:
      return segments;
  }
}

/**
 * Apply `ops` to the CURRENT script. Idempotent: an insert whose id already
 * exists is skipped, a reorder only sorts ids that still exist, a patch on a
 * vanished segment is skipped. Inverse runs the ops in reverse order.
 */
export function applyScriptOps(
  segments: readonly ScriptSegment[],
  ops: readonly ScriptOp[],
  direction: CompanionDirection,
): ScriptSegment[] {
  const ordered = direction === 'forward' ? ops : [...ops].reverse();
  return ordered.reduce<ScriptSegment[]>(
    (current, op) => applyOne(current, op, direction),
    segments.slice(),
  );
}
