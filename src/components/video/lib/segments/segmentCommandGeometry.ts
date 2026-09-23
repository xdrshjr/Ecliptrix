/**
 * segmentCommandGeometry — spans, ownership and shifting shared by the
 * segment command planners (spec R2 §3.2.2). Pure; no store, no React.
 */

import type { MaterialItem } from '@/types';
import type { TimelineItemData, TrackData } from '@/components/video/timeline/domain';
import { resolveItemSegmentId, type SegmentTimeRange } from './segmentLinks';
import { roundTime } from './fillSpanWithMaterial';

export const EPS = 1e-6;

export const itemEnd = (item: Pick<TimelineItemData, 'startTime' | 'duration'>): number =>
  item.startTime + item.duration;

/** End of the last clip on any track. */
export function computeTotalDuration(tracks: readonly TrackData[]): number {
  let end = 0;
  tracks.forEach((track) => track.items.forEach((item) => {
    end = Math.max(end, itemEnd(item));
  }));
  return roundTime(end);
}

/**
 * Segment-bearing lane: an unlocked track holding a segment-linked clip, a
 * subtitle track, or an image track. Every other audio lane is background
 * music, which segment commands never move (I-6).
 */
export function isSegmentBearingTrack(
  track: TrackData,
  materialsById: ReadonlyMap<string, MaterialItem>,
): boolean {
  if (track.isLocked) return false;
  if (track.type === 'subtitle' || track.id.startsWith('image-track')) return true;
  return track.items.some((item) => resolveItemSegmentId(item, materialsById) !== null);
}

export function isMusicTrack(
  track: TrackData,
  materialsById: ReadonlyMap<string, MaterialItem>,
): boolean {
  return !track.isLocked && track.type === 'audio' && !isSegmentBearingTrack(track, materialsById);
}

/** Union of every non-subtitle clip linked to each segment. */
export function computeSegmentBlocks(
  tracks: readonly TrackData[],
  materialsById: ReadonlyMap<string, MaterialItem>,
): Map<string, SegmentTimeRange> {
  const blocks = new Map<string, SegmentTimeRange>();
  tracks.forEach((track) => track.items.forEach((item) => {
    if (track.type === 'subtitle') return;
    const owner = resolveItemSegmentId(item, materialsById);
    if (!owner) return;
    const block = blocks.get(owner);
    blocks.set(owner, block
      ? { start: Math.min(block.start, item.startTime), end: Math.max(block.end, itemEnd(item)) }
      : { start: item.startTime, end: itemEnd(item) });
  }));
  return blocks;
}

/**
 * Subtitle item id → segment id. A subtitle belongs to the segment whose
 * block holds its START, so each subtitle belongs to exactly one segment.
 */
export function assignSubtitlesBySegment(
  tracks: readonly TrackData[],
  blocks: ReadonlyMap<string, SegmentTimeRange>,
): Map<string, string> {
  const owners = new Map<string, string>();
  tracks.forEach((track) => {
    if (track.type !== 'subtitle') return;
    track.items.forEach((item) => {
      blocks.forEach((block, segmentId) => {
        if (owners.has(item.id)) return;
        if (item.startTime >= block.start - EPS && item.startTime < block.end - EPS) {
          owners.set(item.id, segmentId);
        }
      });
    });
  });
  return owners;
}

/** Owner of any clip: linked segment, else the subtitle assignment. */
export function buildItemOwnerLookup(
  tracks: readonly TrackData[],
  materialsById: ReadonlyMap<string, MaterialItem>,
): (item: TimelineItemData) => string | null {
  const subtitleOwners = assignSubtitlesBySegment(tracks, computeSegmentBlocks(tracks, materialsById));
  return (item) => resolveItemSegmentId(item, materialsById) ?? subtitleOwners.get(item.id) ?? null;
}

export type ShiftResult =
  | { ok: true; tracks: TrackData[]; applied: number; movedItemIds: string[] }
  | { ok: false; reason: 'interleaved' };

interface ShiftOptions {
  /** Tracks allowed to move. */
  eligibleTrackIds: ReadonlySet<string>;
  /** Clips the planner handles itself: never moved, never "crossing". */
  pinnedItemIds?: ReadonlySet<string>;
}

function isMoving(item: TimelineItemData, fromTime: number, pinned: ReadonlySet<string>): boolean {
  return !pinned.has(item.id) && item.startTime >= fromTime - EPS;
}

/**
 * Largest shrink (≤ 0) every eligible track allows at once: one value for all
 * lanes so picture and sound stay in sync (RV2-12). A clip that starts before
 * `fromTime` and runs past it (and is not pinned) would be overlapped by a
 * shrink → interleaved (RV2-13).
 */
function feasibleShrink(
  tracks: readonly TrackData[],
  fromTime: number,
  delta: number,
  options: ShiftOptions,
): number | null {
  const pinned = options.pinnedItemIds ?? new Set<string>();
  let applied = delta;
  for (const track of tracks) {
    if (!options.eligibleTrackIds.has(track.id)) continue;
    const moving = track.items.filter((item) => isMoving(item, fromTime, pinned));
    if (moving.length === 0) continue;
    const firstStart = Math.min(...moving.map((item) => item.startTime));
    const staticItems = track.items.filter((item) => !isMoving(item, fromTime, pinned));
    const crossing = staticItems.some((item) =>
      !pinned.has(item.id) && item.startTime < fromTime - EPS && itemEnd(item) > fromTime + EPS);
    if (crossing) return null;
    const staticEnd = staticItems
      .filter((item) => item.startTime < firstStart)
      .reduce((end, item) => Math.max(end, itemEnd(item)), -Infinity);
    if (Number.isFinite(staticEnd)) applied = Math.max(applied, staticEnd - firstStart);
  }
  return Math.min(0, applied);
}

/**
 * Move every clip on an eligible track that starts at or after `fromTime` by
 * `delta` (seconds). Untouched tracks keep their object reference.
 */
export function shiftItemsFrom(
  tracks: readonly TrackData[],
  fromTime: number,
  delta: number,
  options: ShiftOptions,
): ShiftResult {
  const pinned = options.pinnedItemIds ?? new Set<string>();
  let applied = delta;
  if (delta < -EPS) {
    const shrink = feasibleShrink(tracks, fromTime, delta, options);
    if (shrink === null) return { ok: false, reason: 'interleaved' };
    applied = shrink;
  }
  applied = roundTime(applied);
  const movedItemIds: string[] = [];
  if (Math.abs(applied) < EPS) return { ok: true, tracks: tracks.slice(), applied: 0, movedItemIds };
  const next = tracks.map((track) => {
    if (!options.eligibleTrackIds.has(track.id)) return track;
    let changed = false;
    const items = track.items.map((item) => {
      if (!isMoving(item, fromTime, pinned)) return item;
      changed = true;
      movedItemIds.push(item.id);
      return { ...item, startTime: roundTime(Math.max(0, item.startTime + applied)) };
    });
    return changed ? { ...track, items: sortItems(items) } : track;
  });
  return { ok: true, tracks: next, applied, movedItemIds };
}

/** Replace one track (by id) in a track list, keeping the others' references. */
export function replaceTrack(
  tracks: readonly TrackData[],
  trackId: string,
  update: (track: TrackData) => TrackData,
): TrackData[] {
  return tracks.map((track) => (track.id === trackId ? update(track) : track));
}

export function sortItems(items: readonly TimelineItemData[]): TimelineItemData[] {
  return [...items].sort((a, b) => a.startTime - b.startTime);
}
