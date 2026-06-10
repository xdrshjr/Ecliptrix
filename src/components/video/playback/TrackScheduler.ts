/**
 * TrackScheduler — per-track active-clip selection for the multi-track
 * compositor (spec 02 §2.2).
 *
 * Stage 2a. PURE: no DOM / React / timers. For each visible video (or audio)
 * track it answers "which clip item covers composition time `t`?" and "which
 * clip should we prewarm next?" — using real timeline positions (item
 * `startTime` / `duration`), NOT the legacy single-track cumulative layout.
 * Source-time math is delegated to spec 01 `ClipTimeMapping` so preview and
 * export never diverge.
 */

import {
  mapTimelineTimeToSourceTime,
  TIME_EPSILON,
} from '../timeline/domain/services/ClipTimeMapping';

/**
 * Minimal clip shape the scheduler needs. Satisfied by `VideoSequenceItem`
 * and `AudioSequenceItem` (both carry `startTime` / `duration` plus clip
 * fields). Kept structural so test fixtures can satisfy it directly.
 */
export interface SchedulableClip {
  id: string;
  startTime: number;
  duration: number;
  clipStart?: number;
  clipEnd?: number;
}

export interface ActiveClipHit<TClip extends SchedulableClip> {
  clip: TClip;
  /** Index of the clip within the track's item list. */
  index: number;
  /** Source-media time to read (via ClipTimeMapping). */
  sourceTime: number;
}

/**
 * Resolve the clip on `items` that covers timeline time `t`.
 *
 * Items must be sorted by `startTime` ascending and non-overlapping (INV-5).
 * The interval is half-open `[startTime, startTime + duration)` with an
 * epsilon cushion so a `t` landing exactly on a clip's trailing edge does NOT
 * leak into the next clip while still selecting the final frame at end.
 *
 * @returns the covering clip + its source time, or null when `t` falls in a gap.
 */
export function activeClipAt<TClip extends SchedulableClip>(
  items: readonly TClip[],
  t: number,
): ActiveClipHit<TClip> | null {
  for (let i = 0; i < items.length; i++) {
    const clip = items[i];
    const start = clip.startTime;
    const end = clip.startTime + clip.duration;
    if (t < start - TIME_EPSILON) {
      // Items are sorted; nothing later can cover an earlier `t`.
      return null;
    }
    const isLast = i === items.length - 1;
    // Half-open at the trailing edge unless this is the last clip, in which
    // case the exact end maps to the final frame (mirrors the legacy
    // findSequenceAtCompositionTime "last sequence wins at end").
    const within = isLast
      ? t <= end + TIME_EPSILON
      : t < end - TIME_EPSILON;
    if (within) {
      return {
        clip,
        index: i,
        sourceTime: mapTimelineTimeToSourceTime(clip, t),
      };
    }
  }
  return null;
}

/**
 * Resolve the clip that should be prewarmed for a track playing forward from
 * time `t`. Returns the next clip after the one currently covering `t`, or —
 * when `t` is in a gap — the first clip starting at/after `t`.
 *
 * @returns the upcoming clip + its index, or null when none remain.
 */
export function prewarmNextAt<TClip extends SchedulableClip>(
  items: readonly TClip[],
  t: number,
): { clip: TClip; index: number } | null {
  const active = activeClipAt(items, t);
  if (active) {
    const nextIndex = active.index + 1;
    if (nextIndex < items.length) {
      return { clip: items[nextIndex], index: nextIndex };
    }
    return null;
  }
  // In a gap (or before the first clip): the next clip is the earliest one
  // whose start is at/after `t`.
  for (let i = 0; i < items.length; i++) {
    if (items[i].startTime >= t - TIME_EPSILON) {
      return { clip: items[i], index: i };
    }
  }
  return null;
}

/**
 * Stateless scheduler facade. Holds no mutable state — instances are cheap and
 * exist only to group the two pure queries behind a named object the
 * orchestration hook can pass around.
 */
export class TrackScheduler {
  /** @see activeClipAt */
  activeClipAt<TClip extends SchedulableClip>(
    items: readonly TClip[],
    t: number,
  ): ActiveClipHit<TClip> | null {
    return activeClipAt(items, t);
  }

  /** @see prewarmNextAt */
  prewarmNext<TClip extends SchedulableClip>(
    items: readonly TClip[],
    t: number,
  ): { clip: TClip; index: number } | null {
    return prewarmNextAt(items, t);
  }
}
