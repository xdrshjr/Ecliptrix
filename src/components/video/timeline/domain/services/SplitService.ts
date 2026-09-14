/**
 * SplitService — domain one-into-two split (spec 01 §2.3).
 *
 * Splits a single clip at a track-timeline cut time into a left half (keeps
 * the original id) and a right half (new id). Both halves are exact source
 * sub-intervals of the original clip, so they satisfy INV-1..INV-3 and join
 * seamlessly (left.clipEnd === right.clipStart, left.endTime === right.start).
 *
 * Pure: no DOM, React, or store access. Mutates only the passed Track entity
 * (removing the original item and inserting the two halves), mirroring how
 * the other domain services mutate entities in place.
 */

import { Track } from '../entities/Track';
import { TimelineItem } from '../entities/TimelineItem';
import type { TimelineItemData } from '../types';
import { TIME_EPSILON } from './ClipTimeMapping';
import { MIN_CLIP_DURATION_SECONDS } from '../value-objects/Duration';
import { rebaseCameraMotionForSplit } from '../../../playback/camera/splitRebase';

/** Identifiers of the two halves produced by a successful split. */
export interface SplitResult {
  /** Left half — reuses the original item id. */
  leftId: string;
  /** Right half — freshly minted id. */
  rightId: string;
}

function generateItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Resolve the effective source clip interval [clipStart, clipEnd] for an item,
 * defaulting an untrimmed clip to [0, duration] so split stays well-defined.
 */
function resolveClipBounds(data: TimelineItemData): { clipStart: number; clipEnd: number } {
  const clipStart = data.clipStart ?? 0;
  const clipEnd = data.clipEnd ?? clipStart + data.duration;
  return { clipStart, clipEnd };
}

/** Slack so a cut exactly MIN_CLIP_DURATION_SECONDS from an edge survives float error (0.3 − 0.2). */
const LENGTH_TOLERANCE_SECONDS = 1e-9;

/**
 * Whether cutting [start, end) at `tCut` leaves two pieces of at least
 * MIN_CLIP_DURATION_SECONDS. A 1.5 ms sliver used to be accepted: invisible on
 * the timeline and impossible to grab again.
 */
export function cutLeavesValidPieces(start: number, end: number, tCut: number): boolean {
  const minimum = MIN_CLIP_DURATION_SECONDS - LENGTH_TOLERANCE_SECONDS;
  return tCut - start >= minimum && end - tCut >= minimum;
}

export class SplitService {
  /** Prevent instantiation — all methods are static. */
  private constructor() {}

  /**
   * Split the item identified by `itemId` on `track` at track-timeline time
   * `tCut`.
   *
   * No-op (returns null) when the item is absent, when `tCut` does not fall
   * strictly inside the item interval (startTime, endTime) with an epsilon
   * margin, or when either half would be shorter than
   * MIN_CLIP_DURATION_SECONDS.
   *
   * @param track   The track owning the item; mutated in place on success.
   * @param itemId  The clip to split.
   * @param tCut    The cut time on the track timeline (seconds).
   * @returns The left/right ids, or null when the split is rejected.
   */
  static splitItemAtTime(track: Track, itemId: string, tCut: number): SplitResult | null {
    const item = track.findItem(itemId);
    if (!item) return null;

    const start = item.startTime.value;
    const end = item.endTime().value;

    // Strictly-inside check with epsilon margin (edge / out-of-range → no-op).
    if (tCut <= start + TIME_EPSILON || tCut >= end - TIME_EPSILON) {
      return null;
    }
    if (!cutLeavesValidPieces(start, end, tCut)) {
      return null;
    }

    const original = item.toPlainObject();
    const { clipStart, clipEnd } = resolveClipBounds(original);
    const offset = tCut - start; // local offset of the cut inside the clip
    const splitSourceTime = clipStart + offset; // playbackRate fixed at 1 (INV-3)

    // camera-motion-2d-3d §4.6 (P1-5): the `{ ...original }` spread inherits
    // `cameraMotion` for free, but both halves would then replay the WHOLE
    // motion and the picture would jump back to the start at the cut. Rebasing
    // materializes the window and slides the right half's origin left, so the
    // two halves stay frame-for-frame equivalent to the original clip. A clip
    // without a motion gets `{}` back — the legacy behaviour, untouched.
    const rebased = rebaseCameraMotionForSplit(original.cameraMotion, original.duration, offset);

    // The cut is a hard edge: the left half keeps only the leading transition
    // and the right half only the trailing one, so no fade appears mid-clip.
    // A still has no source range: each half's interval is [0, its duration]
    // (INV-3). Deriving it from the stored clip fields produced a reversed
    // interval for agent-added images that carry clipEnd = 0.
    const isStill = original.originalMaterialType === 'image';
    const leftData: TimelineItemData = {
      ...original,
      id: original.id,
      duration: offset,
      clipStart: isStill ? 0 : clipStart,
      clipEnd: isStill ? offset : splitSourceTime,
      cameraMotion: rebased.left,
      transitionOut: undefined,
    };

    const rightData: TimelineItemData = {
      ...original,
      id: generateItemId(),
      startTime: tCut,
      duration: original.duration - offset,
      clipStart: isStill ? 0 : splitSourceTime,
      clipEnd: isStill ? original.duration - offset : clipEnd,
      cameraMotion: rebased.right,
      transitionIn: undefined,
    };

    // Replace the original with the two halves; addItem re-sorts the track.
    track.removeItem(itemId);
    track.addItem(TimelineItem.fromPlainObject(leftData));
    track.addItem(TimelineItem.fromPlainObject(rightData));

    return { leftId: leftData.id, rightId: rightData.id };
  }
}
