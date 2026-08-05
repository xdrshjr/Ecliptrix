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

export class SplitService {
  /** Prevent instantiation — all methods are static. */
  private constructor() {}

  /**
   * Split the item identified by `itemId` on `track` at track-timeline time
   * `tCut`.
   *
   * No-op (returns null) when the item is absent, or when `tCut` does not fall
   * strictly inside the item interval (startTime, endTime) with an epsilon
   * margin — splitting exactly at an edge would yield a zero-length half.
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

    const leftData: TimelineItemData = {
      ...original,
      id: original.id,
      duration: offset,
      clipStart,
      clipEnd: splitSourceTime,
      cameraMotion: rebased.left,
    };

    const rightData: TimelineItemData = {
      ...original,
      id: generateItemId(),
      startTime: tCut,
      duration: original.duration - offset,
      clipStart: splitSourceTime,
      clipEnd,
      cameraMotion: rebased.right,
    };

    // Replace the original with the two halves; addItem re-sorts the track.
    track.removeItem(itemId);
    track.addItem(TimelineItem.fromPlainObject(leftData));
    track.addItem(TimelineItem.fromPlainObject(rightData));

    return { leftId: leftData.id, rightId: rightData.id };
  }
}
