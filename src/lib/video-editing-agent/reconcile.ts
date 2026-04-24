/**
 * reconcile.ts — Pure helpers that pack-flush video/audio tracks after an
 * Agent operation produced overlapping clips.
 *
 * The algorithm mirrors `TimelineAggregate.organizeVideoAudioTracks` so the
 * frontend `OperationApplier` and the backend `agent.ts::applyOperationLocally`
 * arrive at identical timeline shapes after every Agent edit. Subtitle tracks
 * and locked tracks are intentionally untouched (subtitles must keep tight
 * audio alignment; locked tracks belong to the user).
 *
 * No React, DOM, or Zustand imports — this module is safe to load on the
 * server (Next.js API route) and in the browser.
 */

import type { TimelineState, Track, TimelineItem, AgentTimelineOperation } from '@/types';
import type { TimelineOperation } from './types';

const DEFAULT_EPSILON = 1e-6;

/**
 * Accepted operation shape for reconcile. `TimelineOperation` (from the
 * video-editing-agent types) and `AgentTimelineOperation` (from `@/types`)
 * share every field reconcile reads but differ on unrelated ones like
 * `material.url`, so accepting the union lets both the in-browser
 * `OperationApplier` and the server-side `agent.ts` call this helper
 * without an unsafe cast.
 */
type ReconcilableOperation = TimelineOperation | AgentTimelineOperation;

/**
 * Tracks ineligible for pack-flush. We never reorganise subtitle tracks
 * because their items are time-anchored to spoken audio, and we never
 * reorganise locked tracks because the user has signalled they own the
 * layout.
 */
function isReorganisable(track: Track): boolean {
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
function trackHasOverlap(track: Track, epsilon: number): boolean {
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

/**
 * Mutating: pack the items of a single track flush from time 0 in
 * startTime order. Returns the list of `move_clip` operations that capture
 * each item that actually changed position. The caller decides whether to
 * forward the operations to the SSE stream.
 *
 * The mutation is only applied if at least one item moved — when the track
 * is already packed this function is a no-op.
 */
function packFlushTrack(track: Track, epsilon: number): TimelineOperation[] {
  const ops: TimelineOperation[] = [];
  if (track.items.length === 0) return ops;

  const sorted = [...track.items].sort((a, b) => a.startTime - b.startTime);
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

export interface ReconcileResult {
  /** Tracks that had at least one item repositioned. */
  changedTrackIds: string[];
  /** All `move_clip` operations produced (may be empty). */
  operations: TimelineOperation[];
}

/**
 * Reconcile-after-operation: if the just-applied operation produced any
 * overlap on its target track(s), pack-flush those tracks and return the
 * `move_clip` events that describe the repair.
 *
 * Mutates `state.tracks[*].items[*]` in place and recomputes
 * `state.totalDuration`. The function is idempotent: running it twice on a
 * timeline that is already packed returns an empty operation list and makes
 * no further mutations.
 *
 * @param state      The timeline state to reconcile.
 * @param operation  Optional triggering operation. When provided, only
 *                   tracks touched by it are scanned. When omitted, every
 *                   reorganisable track is scanned (used by `auto_fix_overlaps`).
 * @param opts       Optional epsilon override.
 */
export function reconcileOverlapsAfterAgentOp(
  state: TimelineState,
  operation?: ReconcilableOperation,
  opts?: { epsilon?: number },
): ReconcileResult {
  const epsilon = opts?.epsilon ?? DEFAULT_EPSILON;
  const allowed = affectedTrackIds(state, operation);

  const changed: string[] = [];
  const ops: TimelineOperation[] = [];

  for (const track of state.tracks) {
    if (!isReorganisable(track)) continue;
    if (allowed && !allowed.has(track.id)) continue;
    if (!trackHasOverlap(track, epsilon)) continue;

    const trackOps = packFlushTrack(track, epsilon);
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

/**
 * Force-organise: pack-flush every reorganisable track regardless of
 * whether overlaps are present. Used by `auto_fix_overlaps` when the agent
 * explicitly asks for a clean layout. Returns the same shape as the
 * "lazy" reconcile.
 */
export function packAllReorganisableTracks(
  state: TimelineState,
  opts?: { epsilon?: number; trackIds?: ReadonlyArray<string> },
): ReconcileResult {
  const epsilon = opts?.epsilon ?? DEFAULT_EPSILON;
  const allowed = opts?.trackIds ? new Set(opts.trackIds) : null;

  const changed: string[] = [];
  const ops: TimelineOperation[] = [];

  for (const track of state.tracks) {
    if (!isReorganisable(track)) continue;
    if (allowed && !allowed.has(track.id)) continue;

    const trackOps = packFlushTrack(track, epsilon);
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

// Re-export for tests / consumers that want to discover overlaps without
// importing the domain layer twice.
export type { TimelineItem };
