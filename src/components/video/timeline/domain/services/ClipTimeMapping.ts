/**
 * ClipTimeMapping — the single clip time-mapping contract (spec 01 §2.2).
 *
 * Defines the ONE authoritative conversion between "timeline time" (where a
 * clip sits on its track) and "source-media time" (where to read inside the
 * underlying media file). Preview (TODO 02) and export (TODO 05) MUST call
 * these functions instead of rolling their own arithmetic — that divergence
 * is the documented root cause of trim/split/move desync (symptom ②).
 *
 * Both functions are pure (no DOM, React, or value objects) and operate on a
 * minimal structural ref so the entity DTO, the video/audio sequence DTOs, and
 * test fixtures can all satisfy the contract directly.
 *
 * Time semantics (seconds, playbackRate fixed at 1 — see INV-3):
 *   startTime  — clip start on the track timeline (>= 0)
 *   duration   — playable length on the track (> 0); endTime = startTime + duration
 *   clipStart  — in-point offset inside the source media (defaults to 0)
 *   clipEnd    — out-point offset inside the source media (defaults to clipStart + duration)
 *
 * Contract invariant (INV-3): duration === clipEnd - clipStart. Callers that
 * keep that invariant get an exact, jitter-free round trip.
 */

/**
 * Minimal clip shape both functions accept. Satisfied by `TimelineItemData`,
 * `VideoSequenceItem`, `AudioSequenceItem`, and plain test fixtures.
 */
export interface ClipTimeRef {
  startTime: number;
  duration: number;
  clipStart?: number;
  clipEnd?: number;
}

/**
 * Shared boundary tolerance (seconds). A single epsilon everywhere prevents
 * off-by-epsilon flicker at clip edges across preview and export (spec 01 §2.2).
 */
export const TIME_EPSILON = 0.001;

/**
 * Resolve the effective source in-point for a ref. Falls back to 0 when the
 * clip has never been trimmed.
 */
function resolveClipStart(ref: ClipTimeRef): number {
  return ref.clipStart ?? 0;
}

/**
 * Clamp `value` to [lo, hi], snapping within-epsilon overruns to the exact
 * bound so edge reads land precisely on clipStart/clipEnd.
 */
function clampWithEpsilon(value: number, lo: number, hi: number): number {
  if (value <= lo + TIME_EPSILON) return lo;
  if (value >= hi - TIME_EPSILON) return hi;
  return value;
}

/**
 * Map a track-timeline time to the source-media time that should be read.
 *
 * @param ref         The clip whose source interval is being addressed.
 * @param tTimeline   A time on the track timeline (seconds). Values outside
 *                    [startTime, startTime + duration] are clamped to the
 *                    nearest clip edge.
 * @returns The source-media time in [clipStart, clipStart + duration].
 */
export function mapTimelineTimeToSourceTime(
  ref: ClipTimeRef,
  tTimeline: number,
): number {
  const clipStart = resolveClipStart(ref);
  const local = clampWithEpsilon(tTimeline - ref.startTime, 0, ref.duration);
  return clipStart + local;
}

/**
 * Map a source-media time to the track-timeline time at which it plays.
 *
 * @param ref       The clip whose source interval is being addressed.
 * @param tSource   A source-media time (seconds). Values outside
 *                  [clipStart, clipStart + duration] are clamped to the
 *                  nearest clip edge.
 * @returns The track-timeline time in [startTime, startTime + duration].
 */
export function mapSourceTimeToTimelineTime(
  ref: ClipTimeRef,
  tSource: number,
): number {
  const clipStart = resolveClipStart(ref);
  const local = clampWithEpsilon(tSource - clipStart, 0, ref.duration);
  return ref.startTime + local;
}
