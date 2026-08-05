/**
 * Camera motion — progress + easing (spec §4.2.1 / §4.2.2).
 *
 * The window solve is written exactly as the spec pseudo-code: `w0` is clamped
 * FIRST so `[w0, clipDuration]` always leaves one MIN_WINDOW behind (P2-3 —
 * otherwise the `wd` clamp would get min > max and be undefined), and `w0` is
 * allowed to be NEGATIVE so a split clip's right half can start mid-window
 * (§4.6 / P1-5).
 *
 * TWO PARAMETER SPACES (camera-motion-keyframe-curves D32 / R36) — read this
 * before touching anything here:
 *
 *   u   linear progress through the motion window, 0..1. Time only.
 *   τ   the TRAJECTORY parameter, 0..1. Position along the path only.
 *
 * `tauAtProgress(motion, u)` is where easing is consumed; `keyframeAtTrajectory
 * (motion, τ)` is pure geometry. Splitting them is what lets each segment of a
 * multi-keyframe curve carry its own easing while `rollPadForMotion` /
 * `coverScaleForMotion` / `_needs_zoom_segment` keep their "maximum along the
 * whole trajectory" semantics unchanged — they sample τ, and τ is onto [0,1].
 *
 * For a two-stop motion `τ = ease(u, motion.easing)` and
 * `keyframeAtTrajectory(motion, τ) = start + (end − start)·intensity·τ`, i.e.
 * exactly today's `keyframeAt(motion, easedProgressAt(...))`. T1 is the living
 * proof of that identity; do not "simplify" either function without re-running it.
 *
 * PURE — mirrored verbatim by the Python side.
 */

import { expandStops, segmentIndexAt, trajectorySamples } from './keyframes';
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
 * Linear progress `u` → trajectory parameter `τ` (§4.2.2). THIS is where easing
 * is consumed; everything downstream of it is pure geometry.
 *
 * Two-stop motions reduce to `ease(u, motion.easing)` exactly: the single
 * segment spans `[0,1]`, so `s = u` and `τ = 0 + ease(u)·1`.
 */
export function tauAtProgress(motion: CameraMotion, u: number): number {
  const stops = expandStops(motion);
  const p = clamp(u, 0, 1);
  const index = segmentIndexAt(stops, p);
  const a0 = stops[index].at;
  const a1 = stops[index + 1].at;
  const span = a1 - a0;
  if (!(span > 0)) return a1;
  const s = clamp((p - a0) / span, 0, 1);
  return a0 + ease(s, stops[index].easing ?? 'easeInOut') * span;
}

/**
 * Interpolate the keyframe at trajectory parameter `τ` (§4.2.3): interpolate
 * first, clamp after — so a component that would overshoot its range simply
 * parks at the bound instead of skewing the whole trajectory.
 *
 * `intensity` is applied RELATIVE TO THE FIRST STOP (D35): `intensity = 0` means
 * "hold the opening framing", not "no motion". The identity below is the reason
 * the whole feature could be added without touching the geometry kernel — with
 * two stops `S₀ = start`, `s = τ` and the expression collapses to
 * `start + (end − start)·intensity·τ`, character for character today's formula.
 */
export function keyframeAtTrajectory(motion: CameraMotion, tau: number): CameraKeyframe {
  const stops = expandStops(motion);
  const intensity = clamp(motion.intensity, 0, 2);
  const p = clamp(tau, 0, 1);
  const index = segmentIndexAt(stops, p);
  const a0 = stops[index].at;
  const a1 = stops[index + 1].at;
  const span = a1 - a0;
  const s = span > 0 ? clamp((p - a0) / span, 0, 1) : 1;
  const out = {} as CameraKeyframe;
  (Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>).forEach((key) => {
    const base = stops[0][key] ?? DEFAULT_KEYFRAME[key];
    const from = stops[index][key] ?? DEFAULT_KEYFRAME[key];
    const to = stops[index + 1][key] ?? DEFAULT_KEYFRAME[key];
    // `(from - base)` is EXACTLY zero on the first segment and `0 + x === x` in
    // IEEE-754, so a two-stop motion evaluates today's formula with one factor
    // re-associated: `(d·s)·I` here against `(d·I)·s` before. Algebraically the
    // same, and the products agree to a few ULP (T1 pins them at < 1e-12) — but
    // NOT bit for bit, so anything that needs byte equality must compare the
    // emitted strings (T2/C21), never two runs of this function.
    const raw = base + (from - base + (to - from) * s) * intensity;
    const range = CAMERA_RANGES[key];
    out[key] = clamp(raw, range.min, range.max);
  });
  return out;
}

/**
 * Interpolate the keyframe at trajectory parameter `e`.
 *
 * ⚠️ The parameter is the TRAJECTORY parameter τ, not time and not eased
 * progress — see the two-parameter-spaces note at the top of this file. The name
 * is kept because `rollPadForMotion` / `coverScaleForMotion` /
 * `_needs_zoom_segment` / `_needs_roll_segment` sample "the whole trajectory",
 * which is exactly what this now means (D32). Do NOT delete this export.
 */
export function keyframeAt(motion: CameraMotion, e: number): CameraKeyframe {
  return keyframeAtTrajectory(motion, e);
}

/**
 * Whether any component of `motion` gets clamped somewhere along its trajectory.
 *
 * Samples {@link trajectorySamples} rather than a uniform grid (D43 / review
 * P1-2): a curve whose ONLY out-of-range excursion sits on an interior stop
 * would otherwise slip through whenever the stop misses the grid, and the
 * panel's "a value is being clamped" hint would be true only by luck.
 */
export function hasClampedComponent(motion: CameraMotion): boolean {
  const intensity = clamp(motion.intensity, 0, 2);
  const stops = expandStops(motion);
  const keys = Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>;
  for (const tau of trajectorySamples(motion)) {
    const p = clamp(tau, 0, 1);
    const index = segmentIndexAt(stops, p);
    const a0 = stops[index].at;
    const a1 = stops[index + 1].at;
    const span = a1 - a0;
    const s = span > 0 ? clamp((p - a0) / span, 0, 1) : 1;
    for (const key of keys) {
      const base = stops[0][key] ?? DEFAULT_KEYFRAME[key];
      const from = stops[index][key] ?? DEFAULT_KEYFRAME[key];
      const to = stops[index + 1][key] ?? DEFAULT_KEYFRAME[key];
      const raw = base + (from - base + (to - from) * s) * intensity;
      const range = CAMERA_RANGES[key];
      if (raw < range.min - 1e-9 || raw > range.max + 1e-9) return true;
    }
  }
  return false;
}
