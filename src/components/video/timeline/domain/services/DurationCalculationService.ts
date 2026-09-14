/**
 * DurationCalculationService
 *
 * Extracted from TimelinePanel.tsx totalDuration calculation logic
 * (lines 611-615, 2353-2356).
 *
 * Responsible for computing the total duration of the entire timeline
 * and per-track durations. These are used to size the ruler, scrollable
 * area, and export boundaries.
 *
 * Pure static methods — no external dependencies (React, DOM, etc.).
 */

import { Track } from '../entities/Track';
import { Duration } from '../value-objects/Duration';
import type { TrackData } from '../types';

// ---------------------------------------------------------------------------
// Minimum floor duration — ensures the timeline always has a non-zero length
// even when empty. Matches the spec: Duration.create(0.1).
// ---------------------------------------------------------------------------
export const MIN_DURATION_SECONDS = 0.1;

// ---------------------------------------------------------------------------
// DurationCalculationService
// ---------------------------------------------------------------------------

export class DurationCalculationService {
  /** Prevent instantiation — all methods are static. */
  private constructor() {}

  /**
   * Calculate the total duration of the timeline across all tracks.
   *
   * Extracted from TimelinePanel.tsx (lines 611-615):
   *   allItemEndTimes = tracks.flatMap(track =>
   *     track.items.map(item => item.startTime + item.duration)
   *   );
   *   maxItemEndTime = Math.max(...allItemEndTimes, startTime + duration);
   *
   * The result is the maximum endTime of any item across all tracks.
   * If there are no items at all, returns the minimum floor duration (0.1s).
   *
   * @param tracks  All tracks on the timeline (entity instances).
   * @returns Duration representing the total timeline length.
   */
  static calculateTotalDuration(tracks: ReadonlyArray<Track>): Duration {
    let maxEnd = 0;

    for (const track of tracks) {
      for (const item of track.items) {
        const end = item.startTime.value + item.duration.value;
        if (end > maxEnd) {
          maxEnd = end;
        }
      }
    }

    // Floor: never return zero/negative — the timeline should always have
    // at least a minimal visible length.
    if (maxEnd <= 0) {
      return Duration.create(MIN_DURATION_SECONDS);
    }

    return Duration.create(maxEnd);
  }

  /**
   * Calculate the duration of a single track.
   *
   * Returns the end time of the last item on the track (the item with
   * the highest startTime + duration). If the track is empty, returns
   * Duration.create(0.1) as a floor.
   *
   * @param track  The track to measure.
   * @returns Duration of the track.
   */
  static calculateTrackDuration(track: Track): Duration {
    const items = track.items;
    if (items.length === 0) {
      return Duration.create(MIN_DURATION_SECONDS);
    }

    let maxEnd = 0;
    for (const item of items) {
      const end = item.startTime.value + item.duration.value;
      if (end > maxEnd) {
        maxEnd = end;
      }
    }

    return Duration.create(Math.max(MIN_DURATION_SECONDS, maxEnd));
  }

  /**
   * Calculate total duration from plain data objects (TrackData[]).
   *
   * Convenient for callers that work with serialized state rather than
   * entity instances. Uses the same algorithm as calculateTotalDuration.
   *
   * @param tracks  All tracks as plain data objects.
   * @returns Duration representing the total timeline length.
   */
  static calculateTotalDurationFromData(tracks: ReadonlyArray<TrackData>): Duration {
    let maxEnd = 0;

    for (const track of tracks) {
      for (const item of track.items) {
        const end = item.startTime + item.duration;
        if (end > maxEnd) {
          maxEnd = end;
        }
      }
    }

    if (maxEnd <= 0) {
      return Duration.create(MIN_DURATION_SECONDS);
    }

    return Duration.create(maxEnd);
  }
}
