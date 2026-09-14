/**
 * reconcile.ts — Pure helpers that pack-flush video/audio tracks after an
 * Agent operation.
 *
 * The algorithm mirrors `TimelineAggregate.organizeVideoAudioTracks` so the
 * frontend `OperationApplier` and the backend `agent.ts::applyOperationLocally`
 * arrive at identical timeline shapes after every Agent edit. Subtitle tracks
 * and locked tracks are intentionally untouched (subtitles must keep tight
 * audio alignment; locked tracks belong to the user).
 *
 * Invariant S8 ("a write is stable"): every agent edit (add, move, delete,
 * trim, resize) leaves its tracks exactly as the UI's organize pass would, so
 * the next unrelated user edit never re-packs the agent's layout. The
 * requested start time of an add / move is an insertion point — on a tie the
 * operated clip goes first.
 *
 * No React, DOM, or Zustand imports — this module is safe to load on the
 * server (Next.js API route) and in the browser.
 */

import type { TimelineState, Track, TimelineItem, AgentTimelineOperation } from '@/types';
import type { TimelineOperation } from './types';

const DEFAULT_EPSILON = 1e-6;

/** Start times are compared at micro-second precision so float noise never reorders clips. */
const ORDER_PRECISION = 1e6;

/**
 * Accepted operation shape for reconcile. `TimelineOperation` (from the
 * video-editing-agent types) and `AgentTimelineOperation` (from `@/types`)
 * share every field reconcile reads but are declared separately, so
 * accepting the union lets both the in-browser `OperationApplier` and the
 * server-side `agent.ts` call this helper without an unsafe cast.
 */
type ReconcilableOperation = TimelineOperation | AgentTimelineOperation;

/**
 * Tracks ineligible for pack-flush. We never reorganise subtitle tracks
 * because their items are time-anchored to spoken audio, and we never
 * reorganise locked tracks because the user has signalled they own the
 * layout.
 */
export function isReorganisable(track: Track): boolean {
  if (track.isLocked) return false;
  if (track.type !== 'video' && track.type !== 'audio') return false;
  return true;
}

/**
 * Compute the maximum end-time across all items on all tracks. Used to keep
 * `totalDuration` in sync after a reorganise.
 */
function computeTotalDuration(state: TimelineState): number {
  let maxEnd = 0;
  for (const track of state.tracks) {
    for (const item of track.items) {
      const end = item.startTime + item.duration;
      if (end > maxEnd) maxEnd = end;
    }
  }
  return maxEnd;
}

/**
 * Check whether a single track currently contains overlapping items.
 * Returns `true` as soon as any pair is found. Pure, non-mutating.
 */
export function trackHasOverlap(track: Track, epsilon: number): boolean {
  const items = track.items;
  if (!items || items.length < 2) return false;

  const sorted = [...items].sort((a, b) => a.startTime - b.startTime);
  let frontier = -Infinity;
  for (const item of sorted) {
    if (item.startTime < frontier - epsilon) {
      return true;
    }
    const end = item.startTime + item.duration;
    if (end > frontier) frontier = end;
  }
  return false;
}

function roundForOrder(value: number): number {
  return Math.round(value * ORDER_PRECISION) / ORDER_PRECISION;
}

/**
 * Mutating: pack the items of a single track flush from time 0 in
 * startTime order. Returns the list of `move_clip` operations that capture
 * each item that actually changed position. The caller decides whether to
 * forward the operations to the SSE stream.
 *
 * Ties on start time put `anchorClipId` (the clip just added or moved) first,
 * then keep the existing array order — so "move C to 0" really lands C first.
 *
 * The mutation is only applied if at least one item moved — when the track
 * is already packed this function is a no-op.
 */
export function packFlushTrack(
  track: Track,
  epsilon: number,
  anchorClipId?: string,
): TimelineOperation[] {
  const ops: TimelineOperation[] = [];
  if (track.items.length === 0) return ops;

  const originalIndex = new Map<string, number>();
  track.items.forEach((item, index) => originalIndex.set(item.id, index));
  const anchorRank = (item: TimelineItem): number => (item.id === anchorClipId ? 0 : 1);
  const sorted = [...track.items].sort(
    (a, b) =>
      roundForOrder(a.startTime) - roundForOrder(b.startTime) ||
      anchorRank(a) - anchorRank(b) ||
      (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0),
  );

  let cursor = 0;
  const moved: Array<{ id: string; from: number; to: number }> = [];
  for (const item of sorted) {
    if (Math.abs(item.startTime - cursor) > epsilon) {
      moved.push({ id: item.id, from: item.startTime, to: cursor });
      item.startTime = cursor;
    }
    cursor += item.duration;
  }

  if (moved.length === 0) return ops;

  // Persist the new sort order on the track so consumers iterating
  // `track.items` see clips in time order.
  track.items = sorted;

  for (const m of moved) {
    ops.push({
      type: 'move_clip',
      clipId: m.id,
      fromTrackId: track.id,
      toTrackId: track.id,
      newStartTime: m.to,
    });
  }
  return ops;
}

/**
 * Restrict reconcile to tracks the operation could plausibly have affected.
 * Restricting the scan keeps the function idempotent on unrelated tracks
 * and avoids "fixing" overlaps the agent never touched.
 */
function affectedTrackIds(
  state: TimelineState,
  operation?: ReconcilableOperation,
): Set<string> | null {
  if (!operation) return null;
  switch (operation.type) {
    case 'add_clip':
      return new Set([operation.clip.trackId]);
    case 'trim_clip':
    case 'resize_clip': {
      // Locate the clip's current track.
      const ids = new Set<string>();
      for (const t of state.tracks) {
        if (t.items.some(i => i.id === operation.clipId)) ids.add(t.id);
      }
      return ids;
    }
    case 'delete_clip':
      return new Set([operation.trackId]);
    case 'move_clip':
      return new Set([operation.fromTrackId, operation.toTrackId]);
  }
  return null;
}

/** The clip an add / move placed; it wins start-time ties when packing. */
function anchorClipIdOf(operation?: ReconcilableOperation): string | undefined {
  if (operation?.type === 'move_clip') return operation.clipId;
  if (operation?.type === 'add_clip') return operation.clip.id;
  return undefined;
}

/**
 * Every timeline edit packs its tracks even without an overlap: a gap it
 * leaves (a deleted, trimmed or shortened clip) would be closed by the next
 * UI edit, moving clips the agent already reported (S8). Only the reconcile
 * pass without a triggering operation limits itself to overlapping tracks.
 */
function packsWithoutOverlap(operation?: ReconcilableOperation): boolean {
  return operation !== undefined;
}

export interface ReconcileResult {
  /** Tracks that had at least one item repositioned. */
  changedTrackIds: string[];
  /** All `move_clip` operations produced (may be empty). */
  operations: TimelineOperation[];
}

/**
 * Reconcile-after-operation: pack-flush the tracks the just-applied operation
 * touched (every add / move, otherwise only tracks it made overlap) and
 * return the `move_clip` events that describe the repair.
 *
 * Mutates `state.tracks[*].items[*]` in place and recomputes
 * `state.totalDuration`. The function is idempotent: running it twice on a
 * timeline that is already packed returns an empty operation list and makes
 * no further mutations.
 *
 * @param state      The timeline state to reconcile.
 * @param operation  Optional triggering operation. When provided, only
 *                   tracks touched by it are scanned. When omitted, every
 *                   reorganisable track with an overlap is scanned.
 * @param opts       Optional epsilon override.
 */
export function reconcileOverlapsAfterAgentOp(
  state: TimelineState,
  operation?: ReconcilableOperation,
  opts?: { epsilon?: number },
): ReconcileResult {
  const epsilon = opts?.epsilon ?? DEFAULT_EPSILON;
  const allowed = affectedTrackIds(state, operation);
  const anchorClipId = anchorClipIdOf(operation);
  const packAlways = packsWithoutOverlap(operation);

  const changed: string[] = [];
  const ops: TimelineOperation[] = [];

  for (const track of state.tracks) {
    if (!isReorganisable(track)) continue;
    if (allowed && !allowed.has(track.id)) continue;
    if (!packAlways && !trackHasOverlap(track, epsilon)) continue;

    const trackOps = packFlushTrack(track, epsilon, anchorClipId);
    if (trackOps.length > 0) {
      changed.push(track.id);
      ops.push(...trackOps);
    }
  }

  if (changed.length > 0) {
    state.totalDuration = Math.max(computeTotalDuration(state), state.totalDuration ?? 0);
  }

  return { changedTrackIds: changed, operations: ops };
}

export interface PackOverlapsResult {
  /** The same (mutated) state object, for chaining. */
  state: TimelineState;
  /** Reorganisable tracks that had an overlap and were packed. */
  fixedTrackIds: string[];
  /** One `move_clip` per repositioned clip, for the client to replay. */
  operations: TimelineOperation[];
}

/**
 * `auto_fix_overlaps`: pack only reorganisable tracks that actually overlap.
 * A narration track without overlaps keeps its layout, so it no longer
 * slides away from the subtitles aligned to it.
 */
export function packOverlappingTracks(
  state: TimelineState,
  epsilon: number = DEFAULT_EPSILON,
  opts?: { trackIds?: ReadonlyArray<string> },
): PackOverlapsResult {
  const allowed = opts?.trackIds ? new Set(opts.trackIds) : null;
  const fixedTrackIds: string[] = [];
  const operations: TimelineOperation[] = [];

  for (const track of state.tracks) {
    if (!isReorganisable(track)) continue;
    if (allowed && !allowed.has(track.id)) continue;
    if (!trackHasOverlap(track, epsilon)) continue;

    const trackOps = packFlushTrack(track, epsilon);
    if (trackOps.length > 0) {
      fixedTrackIds.push(track.id);
      operations.push(...trackOps);
    }
  }

  if (fixedTrackIds.length > 0) {
    state.totalDuration = Math.max(computeTotalDuration(state), state.totalDuration ?? 0);
  }

  return { state, fixedTrackIds, operations };
}

// Re-export for tests / consumers that want to discover overlaps without
// importing the domain layer twice.
export type { TimelineItem };
