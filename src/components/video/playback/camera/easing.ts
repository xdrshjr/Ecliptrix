/**
 * Camera motion — progress + easing (spec §4.2.1 / §4.2.2).
 *
 * The window solve is written exactly as the spec pseudo-code: `w0` is clamped
 * FIRST so `[w0, clipDuration]` always leaves one MIN_WINDOW behind (P2-3 —
 * otherwise the `wd` clamp would get min > max and be undefined), and `w0` is
 * allowed to be NEGATIVE so a split clip's right half can start mid-window
 * (§4.6 / P1-5).
 *
 * PURE — mirrored verbatim by the Python side.
 */

import {
  CAMERA_RANGES,
  DEFAULT_KEYFRAME,
  MIN_WINDOW,
  type CameraEasing,
  type CameraKeyframe,
  type CameraMotion,
} from './types';

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Eased progress for a linear progress `u` ∈ [0,1] (§4.2.1). */
export function ease(u: number, easing: CameraEasing): number {
  const t = clamp(u, 0, 1);
  switch (easing) {
    case 'easeIn':
      return t * t * t;
    case 'easeOut': {
      const inv = 1 - t;
      return 1 - inv * inv * inv;
    }
    case 'easeInOut': {
      if (t < 0.5) return 4 * t * t * t;
      const inv = -2 * t + 2;
      return 1 - (inv * inv * inv) / 2;
    }
    case 'linear':
    default:
      return t;
  }
}

/** The resolved motion window for a clip, in clip-local seconds. */
export interface CameraWindow {
  /** Window start (may be negative — the window opened before this clip). */
  start: number;
  /** Window length (≥ MIN_WINDOW). */
  duration: number;
}

/**
 * Resolve the motion window inside a clip. `clipDuration` is the clip's own
 * length; `startOffset`/`duration` come from the motion (both optional).
 */
export function resolveWindow(
  motion: Pick<CameraMotion, 'startOffset' | 'duration'>,
  clipDuration: number,
): CameraWindow {
  const safeClipDuration = Number.isFinite(clipDuration) && clipDuration > 0 ? clipDuration : MIN_WINDOW;
  // Bound `w0` from ABOVE first (P2-3): with an implicit duration this is what
  // guarantees `clipDuration - w0 >= MIN_WINDOW`, so the window is never
  // degenerate. There is deliberately NO lower bound beyond finiteness —
  // see the note on `wd` below.
  const rawStart = motion.startOffset ?? 0;
  const w0 = Number.isFinite(rawStart)
    ? Math.min(rawStart, Math.max(0, safeClipDuration - MIN_WINDOW))
    : 0;
  // An EXPLICIT duration is NOT clamped to the clip length. A window longer
  // than its clip is exactly what a split produces: after cutting a 6s clip at
  // t=2 the left half is 2s long but still carries the original 6s window, so
  // it plays only the first third of the motion (spec §4.6 / P1-5). Clamping
  // here would make the left half replay the WHOLE motion in 2s — the very
  // jump the rebase exists to prevent. Same reasoning for `startOffset`: the
  // right half's offset is -cutOffset, whose magnitude can exceed that half's
  // own duration whenever the cut lands past the midpoint.
  const wd = motion.duration != null && Number.isFinite(motion.duration)
    ? Math.max(motion.duration, MIN_WINDOW)
    : Math.max(MIN_WINDOW, safeClipDuration - w0);
  return { start: w0, duration: wd };
}

/**
 * Linear progress `u` ∈ [0,1] at clip-local time `tLocal`. Outside the window
 * the motion HOLDS: before → 0 (parked on `start`), after → 1 (parked on `end`).
 */
export function progressAt(
  motion: Pick<CameraMotion, 'startOffset' | 'duration'>,
  tLocal: number,
  clipDuration: number,
): number {
  const { start, duration } = resolveWindow(motion, clipDuration);
  if (duration <= MIN_WINDOW) return 1;
  return clamp((tLocal - start) / duration, 0, 1);
}

/** Eased progress `e` ∈ [0,1] at clip-local time `tLocal`. */
export function easedProgressAt(
  motion: Pick<CameraMotion, 'startOffset' | 'duration' | 'easing'>,
  tLocal: number,
  clipDuration: number,
): number {
  return ease(progressAt(motion, tLocal, clipDuration), motion.easing);
}

/**
 * Interpolate the keyframe at eased progress `e` (§4.2.2): interpolate first,
 * clamp after — so a component that would overshoot its range simply parks at
 * the bound instead of skewing the whole trajectory.
 */
export function keyframeAt(motion: CameraMotion, e: number): CameraKeyframe {
  const intensity = clamp(motion.intensity, 0, 2);
  const out = {} as CameraKeyframe;
  (Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>).forEach((key) => {
    const from = motion.start?.[key] ?? DEFAULT_KEYFRAME[key];
    const to = motion.end?.[key] ?? DEFAULT_KEYFRAME[key];
    const raw = from + (to - from) * intensity * e;
    const range = CAMERA_RANGES[key];
    out[key] = clamp(raw, range.min, range.max);
  });
  return out;
}

/** Whether any component of `motion` gets clamped somewhere in its window. */
export function hasClampedComponent(motion: CameraMotion, samples = 20): boolean {
  const intensity = clamp(motion.intensity, 0, 2);
  for (let i = 0; i <= samples; i += 1) {
    const e = i / samples;
    for (const key of Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>) {
      const from = motion.start?.[key] ?? DEFAULT_KEYFRAME[key];
      const to = motion.end?.[key] ?? DEFAULT_KEYFRAME[key];
      const raw = from + (to - from) * intensity * e;
      const range = CAMERA_RANGES[key];
      if (raw < range.min - 1e-9 || raw > range.max + 1e-9) return true;
    }
  }
  return false;
}
