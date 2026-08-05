/**
 * Stage direct-framing geometry (T14 / T22).
 *
 * These are the gestures' arithmetic, tested without mounting anything (N12).
 * The case that matters most is the two-size one: the drawing space is a fixed
 * 480×270 while the measured element is whatever the panel width makes it, and
 * a function that quietly reached for the constant instead of its parameter
 * would still look right on a maximized window and feel wrong on a narrow one.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGE_PAN_STEP,
  atToScrub,
  clampComponent,
  cropToStageRect,
  orbitDelta,
  panDelta,
  quadToStagePoints,
  rollDelta,
  scrubToAt,
  tiltDelta,
  windowBand,
  zoomDelta,
  zoomStep,
} from '../stageInteraction';
import { STAGE_VIEW_H, STAGE_VIEW_W } from '../stageInteraction';
import { decideInsertAt, pointerToAt, retimeBounds, canRemoveStop, stopOffset } from '../keyframeStripGeometry';
import {
  CAMERA_MAX_KEYFRAMES,
  CAMERA_RANGES,
  DEFAULT_KEYFRAME,
  MIN_KEYFRAME_GAP,
  computeCropRect,
  insertKeyframeAt,
  normalizeCameraKeyframes,
  project3DCorners,
  type CameraKeyframeStop,
  type CameraMotion,
  type NormalizedRect,
} from '@/components/video/playback/camera';
import { applyPreset } from '@/components/video/playback/camera/cameraPresets';

const FULL: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };
const HALF: NormalizedRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

describe('cropToStageRect', () => {
  it('maps the full crop onto the whole stage', () => {
    expect(cropToStageRect(FULL, STAGE_VIEW_W, STAGE_VIEW_H)).toEqual({
      x: 0, y: 0, width: STAGE_VIEW_W, height: STAGE_VIEW_H,
    });
  });

  it('maps a half crop onto the middle quarter', () => {
    const rect = cropToStageRect(HALF, STAGE_VIEW_W, STAGE_VIEW_H);
    expect(rect.x).toBeCloseTo(STAGE_VIEW_W / 4, 9);
    expect(rect.width).toBeCloseTo(STAGE_VIEW_W / 2, 9);
    expect(rect.height).toBeCloseTo(STAGE_VIEW_H / 2, 9);
  });

  it('round-trips through the crop that produced it', () => {
    const crop = computeCropRect({ ...DEFAULT_KEYFRAME, scale: 2, x: 0.4, y: 0.6 }, 1);
    const rect = cropToStageRect(crop, STAGE_VIEW_W, STAGE_VIEW_H);
    expect(rect.x / STAGE_VIEW_W).toBeCloseTo(crop.x, 12);
    expect(rect.width / STAGE_VIEW_W).toBeCloseTo(crop.w, 12);
  });
});

describe('quadToStagePoints', () => {
  it('keeps the TL/TR/BL/BR order and scales into the stage', () => {
    const quad = project3DCorners({ ...DEFAULT_KEYFRAME, rotateY: 12 }, 16 / 9)!;
    const points = quadToStagePoints(quad, STAGE_VIEW_W, STAGE_VIEW_H);
    expect(points).toHaveLength(4);
    points.forEach((point, index) => {
      expect(point.x).toBeCloseTo(quad.pts[index].x * STAGE_VIEW_W, 9);
      expect(point.y).toBeCloseTo(quad.pts[index].y * STAGE_VIEW_H, 9);
    });
    // Top corners above bottom corners.
    expect(points[0].y).toBeLessThan(points[2].y);
  });
});

describe('T14 — panDelta', () => {
  it('inverts the drag: pushing the picture right looks further LEFT', () => {
    const delta = panDelta(48, 27, FULL, STAGE_VIEW_W, STAGE_VIEW_H);
    expect(delta.dx).toBeLessThan(0);
    expect(delta.dy).toBeLessThan(0);
    expect(delta.dx).toBeCloseTo(-0.1, 9);
    expect(delta.dy).toBeCloseTo(-0.1, 9);
  });

  it('folds in the crop size, so 2x zoom halves the travel', () => {
    const wide = panDelta(48, 27, FULL, STAGE_VIEW_W, STAGE_VIEW_H);
    const tight = panDelta(48, 27, HALF, STAGE_VIEW_W, STAGE_VIEW_H);
    expect(tight.dx).toBeCloseTo(wide.dx / 2, 12);
    expect(tight.dy).toBeCloseTo(wide.dy / 2, 12);
  });

  it('④ THE MEASURED-RECT CASE: a 960-wide stage halves the same drag', () => {
    // If this ever fails, someone passed `STAGE_VIEW_W` at the call site instead
    // of `getBoundingClientRect().width`, and drag sensitivity now drifts with
    // the window width (review P1-4).
    const atBackingStore = panDelta(48, 27, FULL, 480, 270);
    const atDoubleSize = panDelta(48, 27, FULL, 960, 540);
    expect(atDoubleSize.dx).toBeCloseTo(atBackingStore.dx / 2, 12);
    expect(atDoubleSize.dy).toBeCloseTo(atBackingStore.dy / 2, 12);
  });

  it('is inert for a degenerate rect instead of producing NaN', () => {
    expect(panDelta(10, 10, FULL, 0, 0)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('zoomDelta / zoomStep', () => {
  it('scrolling up zooms in, down zooms out', () => {
    expect(zoomDelta(-120, 1)).toBeGreaterThan(1);
    expect(zoomDelta(120, 2)).toBeLessThan(2);
  });

  it('is exponential — the same notch feels the same at any scale', () => {
    const fromOne = zoomDelta(-120, 1) / 1;
    const fromThree = zoomDelta(-120, 3) / 3;
    expect(fromThree).toBeCloseTo(fromOne, 9);
  });

  it('clamps to the published scale range', () => {
    expect(zoomDelta(-120 * 200, 1)).toBe(CAMERA_RANGES.scale.max);
    expect(zoomDelta(120 * 200, 4)).toBe(CAMERA_RANGES.scale.min);
    expect(zoomStep(CAMERA_RANGES.scale.max, 1)).toBe(CAMERA_RANGES.scale.max);
    expect(zoomStep(CAMERA_RANGES.scale.min, -1)).toBe(CAMERA_RANGES.scale.min);
  });

  it('is a no-op for a zero / non-finite wheel event', () => {
    expect(zoomDelta(0, 1.5)).toBe(1.5);
    expect(zoomDelta(Number.NaN, 1.5)).toBe(1.5);
  });
});

describe('roll / orbit / tilt', () => {
  it('scale with the drag and with the measured size', () => {
    expect(rollDelta(240, 480)).toBeCloseTo(45, 9);
    expect(rollDelta(240, 960)).toBeCloseTo(22.5, 9);
    expect(orbitDelta(240, 480)).toBeCloseTo(45, 9);
    expect(tiltDelta(135, 270)).toBeCloseTo(45, 9);
  });

  it('are inert on a degenerate rect', () => {
    expect(rollDelta(10, 0)).toBe(0);
    expect(orbitDelta(10, 0)).toBe(0);
    expect(tiltDelta(10, 0)).toBe(0);
  });
});

describe('clampComponent', () => {
  it('holds every component inside its published range', () => {
    expect(clampComponent('scale', 99)).toBe(CAMERA_RANGES.scale.max);
    expect(clampComponent('x', -1)).toBe(0);
    expect(clampComponent('roll', 900)).toBe(45);
    expect(clampComponent('dolly', -9)).toBe(-0.6);
  });

  it('leaves the keyboard step inside the range at the boundary', () => {
    expect(clampComponent('x', 1 + STAGE_PAN_STEP)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T22 — the two axes (D44, review P1-3)
// ---------------------------------------------------------------------------

describe('T22 — window ⇄ scrub mapping', () => {
  // The spec's worked example: a 2s window opening 1s into a 6s clip.
  const START = 1;
  const DURATION = 2;
  const CLIP = 6;

  it('the band covers exactly the window', () => {
    const band = windowBand(START, DURATION, CLIP);
    expect(band.from).toBeCloseTo(1 / 6, 9);
    expect(band.to).toBeCloseTo(3 / 6, 9);
  });

  it('the band is the whole bar when the window is the whole clip', () => {
    expect(windowBand(0, CLIP, CLIP)).toEqual({ from: 0, to: 1 });
  });

  it('u = 0.5 (clip second 3) is the END of the window, at = 1', () => {
    expect(scrubToAt(0.5, START, DURATION, CLIP)).toBeCloseTo(1, 9);
  });

  it('u = 0.1 is OUTSIDE the window and has no honest `at`', () => {
    // Not clamped to 0: that would collide with the pinned first keyframe and
    // rewrite the opening framing instead of refusing.
    expect(scrubToAt(0.1, START, DURATION, CLIP)).toBeNull();
    expect(scrubToAt(0.9, START, DURATION, CLIP)).toBeNull();
  });

  it('round-trips at ⇄ scrub', () => {
    for (const at of [0, 0.25, 0.5, 0.75, 1]) {
      const u = atToScrub(at, START, DURATION, CLIP);
      expect(scrubToAt(u, START, DURATION, CLIP)).toBeCloseTo(at, 9);
    }
  });

  it('parks the playhead on the right clip second', () => {
    // at = 0.5 is halfway through a window that runs 1s..3s → clip second 2.
    expect(atToScrub(0.5, START, DURATION, CLIP) * CLIP).toBeCloseTo(2, 9);
  });
});

describe('T22 — decideInsertAt', () => {
  const windowed = (motion: CameraMotion): CameraMotion => ({
    ...motion, startOffset: 1, duration: 2,
  });

  it('accepts a playhead inside the window', () => {
    const decision = decideInsertAt(windowed(applyPreset('push-in', '2d')), 2 / 6, 6);
    expect(decision.at).toBeCloseTo(0.5, 9);
    expect(decision.reason).toBeUndefined();
  });

  it('refuses a playhead outside the window, with a reason', () => {
    const decision = decideInsertAt(windowed(applyPreset('push-in', '2d')), 0.1, 6);
    expect(decision.at).toBeNull();
    expect(decision.reason).toBe('outside-window');
  });

  it('refuses a position that crowds an existing keyframe', () => {
    const motion = insertKeyframeAt(applyPreset('push-in', '2d'), 0.5);
    const near = decideInsertAt(motion, 0.5 + MIN_KEYFRAME_GAP / 4, 6);
    expect(near.at).toBeNull();
    expect(near.reason).toBe('too-close');
  });

  it('refuses the endpoints themselves (they are pinned)', () => {
    expect(decideInsertAt(applyPreset('push-in', '2d'), 0, 6).reason).toBe('too-close');
    expect(decideInsertAt(applyPreset('push-in', '2d'), 1, 6).reason).toBe('too-close');
  });

  it('refuses once the curve is full', () => {
    const stops: CameraKeyframeStop[] = Array.from(
      { length: CAMERA_MAX_KEYFRAMES },
      (_, i) => ({ ...DEFAULT_KEYFRAME, at: i / (CAMERA_MAX_KEYFRAMES - 1) }),
    );
    const full = normalizeCameraKeyframes({ ...applyPreset('push-in', '2d'), keyframes: stops });
    expect(full.keyframes).toHaveLength(CAMERA_MAX_KEYFRAMES);
    const decision = decideInsertAt(full, 0.55, 6);
    expect(decision.at).toBeNull();
    expect(decision.reason).toBe('at-limit');
  });
});

describe('keyframe strip geometry', () => {
  const curve = normalizeCameraKeyframes({
    ...applyPreset('push-in', '2d'),
    keyframes: [
      { ...DEFAULT_KEYFRAME, at: 0 },
      { ...DEFAULT_KEYFRAME, at: 0.3, scale: 2 },
      { ...DEFAULT_KEYFRAME, at: 0.7, scale: 1.5 },
      { ...DEFAULT_KEYFRAME, at: 1, scale: 1.2 },
    ],
  });

  it('maps a pointer onto the strip from its MEASURED rect', () => {
    expect(pointerToAt(160, { left: 60, width: 200 })).toBeCloseTo(0.5, 9);
    // A wider strip puts the same pointer at a different `at` — measured, again.
    expect(pointerToAt(160, { left: 60, width: 400 })).toBeCloseTo(0.25, 9);
    expect(pointerToAt(0, { left: 60, width: 200 })).toBe(0);
    expect(pointerToAt(9999, { left: 60, width: 200 })).toBe(1);
  });

  it('confines an interior keyframe between its neighbours', () => {
    const bounds = retimeBounds(curve, 1)!;
    expect(bounds.low).toBeCloseTo(MIN_KEYFRAME_GAP, 9);
    expect(bounds.high).toBeCloseTo(0.7 - MIN_KEYFRAME_GAP, 9);
  });

  it('gives the endpoints no bounds at all — they are pinned', () => {
    expect(retimeBounds(curve, 0)).toBeNull();
    expect(retimeBounds(curve, 3)).toBeNull();
  });

  it('allows deleting only interior keyframes', () => {
    expect(canRemoveStop(curve, 0)).toBe(false);
    expect(canRemoveStop(curve, 1)).toBe(true);
    expect(canRemoveStop(curve, 3)).toBe(false);
  });

  it('positions a keyframe by its `at`', () => {
    expect(stopOffset(0.42)).toBe(0.42);
    expect(stopOffset(-1)).toBe(0);
    expect(stopOffset(2)).toBe(1);
  });
});
