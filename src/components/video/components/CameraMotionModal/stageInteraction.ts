/**
 * Stage direct-framing — the pure geometry behind `StageOverlay`
 * (camera-motion-keyframe-curves §4.5.2 / §6.2).
 *
 * Everything here is a plain number → number mapping so the gestures stay
 * testable under N12 (the panel components are not mounted in tests). The
 * component is left with nothing but wiring.
 *
 * ⚠️ TWO COORDINATE SYSTEMS, AND THEY ARE NOT THE SAME ONE (review P1-4):
 *
 *   DRAWING  happens in the stage's LOGICAL 480×270 space. The overlay's SVG
 *            declares `viewBox="0 0 480 270"` and the browser scales it, so
 *            `cropToStageRect` / `quadToStagePoints` stay resolution-independent
 *            and need no measurement at all.
 *   MEASURING must use the overlay's real `getBoundingClientRect()`. The canvas
 *            BACKING STORE is fixed at 480×270 but it lays out `w-full` with a
 *            16:9 aspect ratio, so its CSS width follows the panel and is almost
 *            never 480. Feeding the constants into these functions would make
 *            drag sensitivity drift with the window width — worst on narrow
 *            screens. That is why every function below takes `w`/`h` as
 *            parameters and none of them reaches for a constant.
 */

import {
  CAMERA_RANGES,
  clamp,
  type CameraQuad,
  type NormalizedRect,
} from '@/components/video/playback/camera';

/**
 * The stage's LOGICAL drawing space — the canvas' backing store, and the
 * overlay SVG's `viewBox`. Lives here rather than in the component so tests can
 * reach it: under `jsx: "preserve"` a `.tsx` module cannot be imported by a test
 * at all (N12).
 *
 * NEVER pass these to the measuring functions below. They are what to DRAW in;
 * what to MEASURE with is `getBoundingClientRect()`.
 */
export const STAGE_VIEW_W = 480;
export const STAGE_VIEW_H = 270;

export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StagePoint {
  x: number;
  y: number;
}

/** Wheel notches per zoom step, and the multiplier applied at each notch. */
const WHEEL_NOTCH = 120;
const ZOOM_PER_NOTCH = 1.06;

/** Degrees of roll per full-width horizontal drag. */
const ROLL_PER_WIDTH = 90;
/** Degrees of orbit (`rotateY`) per full-width horizontal drag. */
const ORBIT_PER_WIDTH = 90;
/** Degrees of tilt (`rotateX`) per full-height vertical drag. */
const TILT_PER_HEIGHT = 90;

/** Keyboard nudge for the framing centre, in normalized units. */
export const STAGE_PAN_STEP = 0.005;
/** Keyboard zoom step (multiplicative, so it feels the same at every scale). */
export const STAGE_ZOOM_STEP = 1.04;
/** Keyboard roll / orbit / tilt step, degrees. */
export const STAGE_ANGLE_STEP = 1;

/**
 * The framing rectangle in the stage's logical space.
 *
 * The crop is normalized against the SOURCE, and the stage shows the whole
 * source, so the mapping is a straight multiply. Drawn, not measured — pass the
 * logical 480×270, not a measured rect.
 */
export function cropToStageRect(crop: NormalizedRect, w: number, h: number): StageRect {
  return {
    x: crop.x * w,
    y: crop.y * h,
    width: crop.w * w,
    height: crop.h * h,
  };
}

/** The projected 3D corners in the stage's logical space, TL/TR/BL/BR order. */
export function quadToStagePoints(quad: CameraQuad, w: number, h: number): StagePoint[] {
  return quad.pts.map((point) => ({ x: point.x * w, y: point.y * h }));
}

/**
 * A pointer drag, in NORMALIZED framing-centre units.
 *
 * Divided by the crop size on purpose: at 2× magnification the visible window is
 * half the source, so 10 screen pixels correspond to 5 source pixels. Without
 * the division the framing would fly away from the pointer at high zoom.
 *
 * The sign is inverted because dragging the PICTURE right means looking further
 * LEFT in the source — the same grab-and-move convention every viewer uses.
 */
export function panDelta(
  dx: number,
  dy: number,
  crop: NormalizedRect,
  w: number,
  h: number,
): { dx: number; dy: number } {
  if (!(w > 0) || !(h > 0)) return { dx: 0, dy: 0 };
  return {
    dx: (-dx / w) * crop.w,
    dy: (-dy / h) * crop.h,
  };
}

/**
 * The scale a wheel gesture lands on. Exponential, so one notch feels the same
 * at 1× and at 3×; scrolling up (negative `deltaY`) zooms in.
 */
export function zoomDelta(wheelDeltaY: number, scale: number): number {
  if (!Number.isFinite(wheelDeltaY) || wheelDeltaY === 0) return clampScale(scale);
  const notches = -wheelDeltaY / WHEEL_NOTCH;
  return clampScale(scale * ZOOM_PER_NOTCH ** notches);
}

/** Multiplicative zoom for the keyboard `+` / `-` keys. */
export function zoomStep(scale: number, direction: 1 | -1): number {
  return clampScale(direction > 0 ? scale * STAGE_ZOOM_STEP : scale / STAGE_ZOOM_STEP);
}

function clampScale(value: number): number {
  return clamp(value, CAMERA_RANGES.scale.min, CAMERA_RANGES.scale.max);
}

/** Degrees of roll for a horizontal drag of `dx` across a stage `w` wide. */
export function rollDelta(dx: number, w: number): number {
  if (!(w > 0)) return 0;
  return (dx / w) * ROLL_PER_WIDTH;
}

/** Degrees of `rotateY` (orbit) for a horizontal drag. */
export function orbitDelta(dx: number, w: number): number {
  if (!(w > 0)) return 0;
  return (dx / w) * ORBIT_PER_WIDTH;
}

/** Degrees of `rotateX` (tilt) for a vertical drag. */
export function tiltDelta(dy: number, h: number): number {
  if (!(h > 0)) return 0;
  return (dy / h) * TILT_PER_HEIGHT;
}

/** Clamp any framing component to its published range. */
export function clampComponent(key: keyof typeof CAMERA_RANGES, value: number): number {
  const range = CAMERA_RANGES[key];
  return clamp(value, range.min, range.max);
}

// ---------------------------------------------------------------------------
// Window ⇄ scrub-bar mapping (D44, review P1-3)
// ---------------------------------------------------------------------------

/**
 * The motion window as a fraction of the whole clip: `[from, to]` in the scrub
 * bar's own units.
 *
 * The scrub bar is in CLIP time (`MotionPreviewStage` maps `u` to
 * `u * clipDuration`) while a keyframe's `at` is normalized against the MOTION
 * WINDOW. Those are the same ruler only while the window covers the whole clip.
 * Pretending otherwise is what puts the keyframe strip out of register the
 * moment anyone touches `startOffset` / `duration` — both of which are controls
 * in this very panel.
 */
export function windowBand(
  start: number,
  duration: number,
  clipDuration: number,
): { from: number; to: number } {
  if (!(clipDuration > 0)) return { from: 0, to: 1 };
  return {
    from: clamp(start / clipDuration, 0, 1),
    to: clamp((start + duration) / clipDuration, 0, 1),
  };
}

/** Scrub position `u` → the equivalent `at`, or `null` when outside the window. */
export function scrubToAt(
  u: number,
  start: number,
  duration: number,
  clipDuration: number,
): number | null {
  if (!(duration > 0) || !(clipDuration > 0)) return null;
  const tLocal = clamp(u, 0, 1) * clipDuration;
  const at = (tLocal - start) / duration;
  // Deliberately NOT clamped: a playhead outside the window has no honest `at`,
  // and clamping it to 0 or 1 would collide with the pinned endpoints — the
  // insert would either do nothing or silently rewrite the opening framing.
  if (at < 0 || at > 1) return null;
  return at;
}

/** `at` → the scrub position that parks the playhead on that keyframe. */
export function atToScrub(
  at: number,
  start: number,
  duration: number,
  clipDuration: number,
): number {
  if (!(clipDuration > 0)) return 0;
  return clamp((start + clamp(at, 0, 1) * duration) / clipDuration, 0, 1);
}
