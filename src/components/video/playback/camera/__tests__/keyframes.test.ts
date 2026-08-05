/**
 * Camera motion — the curve write gate (camera-motion-keyframe-curves T6 / T8 /
 * T9a / T9b, §4.2.4).
 *
 * `normalizeCameraKeyframes` is the ONLY place a `keyframes` array may be
 * written (C23). Everything the panel, the project loader and the backend
 * validator do lands here, so the D31 mirror invariant and the D38 "a trivial
 * curve is not a curve" rule are enforced in exactly one place.
 */

import { describe, it, expect } from 'vitest';
import {
  expandStops,
  insertKeyframeAt,
  normalizeCameraKeyframes,
  removeKeyframeAt,
  retimeKeyframe,
  setKeyframeComponent,
  setSegmentEasing,
  trajectoryAt,
} from '../keyframes';
import { keyframeAtTrajectory, tauAtProgress } from '../easing';
import { resolveCameraDraw } from '../resolveCameraDraw';
import { applyPreset, reverseCameraMotion } from '../cameraPresets';
import { _clearCameraConstantsCache } from '../cameraGeometry';
import {
  CAMERA_MAX_KEYFRAMES,
  DEFAULT_KEYFRAME,
  MIN_KEYFRAME_GAP,
  type CameraKeyframe,
  type CameraKeyframeStop,
  type CameraMotion,
} from '../types';

const ASPECT = 16 / 9;
const KEYS = Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>;

function motionWith(stops: Array<Partial<CameraKeyframeStop>>): CameraMotion {
  return {
    version: 1,
    mode: '2d',
    presetId: 'custom',
    intensity: 1,
    easing: 'easeInOut',
    start: { ...DEFAULT_KEYFRAME },
    end: { ...DEFAULT_KEYFRAME },
    keyframes: stops.map((stop) => ({ ...DEFAULT_KEYFRAME, at: 0, ...stop })),
  };
}

describe('expandStops', () => {
  it('turns a two-point motion into two stops carrying its easing', () => {
    const motion = { ...applyPreset('push-in', '2d'), easing: 'easeOut' as const };
    const stops = expandStops(motion);
    expect(stops).toHaveLength(2);
    expect(stops[0].at).toBe(0);
    expect(stops[1].at).toBe(1);
    expect(stops[0].easing).toBe('easeOut');
    expect(stops[0].scale).toBe(motion.start.scale);
    expect(stops[1].scale).toBe(motion.end.scale);
  });

  it('never writes back to the motion', () => {
    const motion = applyPreset('push-in', '2d');
    expandStops(motion);
    expect(motion.keyframes).toBeUndefined();
  });

  it('returns the curve untouched when there is one', () => {
    const motion = motionWith([{ at: 0 }, { at: 0.5, scale: 2 }, { at: 1 }]);
    expect(expandStops(motion)).toHaveLength(3);
  });
});

describe('T6 — normalizeCameraKeyframes', () => {
  it('1 — drops a missing / short / non-array curve back to today\'s shape', () => {
    const base = applyPreset('push-in', '2d');
    expect(normalizeCameraKeyframes(base).keyframes).toBeUndefined();
    expect(normalizeCameraKeyframes({ ...base, keyframes: [] }).keyframes).toBeUndefined();
    expect('keyframes' in normalizeCameraKeyframes({ ...base, keyframes: [] })).toBe(false);
    const oneStop = { ...base, keyframes: [{ ...DEFAULT_KEYFRAME, at: 0 }] };
    expect(normalizeCameraKeyframes(oneStop).keyframes).toBeUndefined();
  });

  it('2 — clamps components and zeroes 3D keys on a 2D motion', () => {
    const motion = motionWith([
      { at: 0 },
      { at: 0.5, scale: 99, x: -4, roll: 400, rotateY: 30, dolly: 0.5 },
      { at: 1 },
    ]);
    const stops = normalizeCameraKeyframes(motion).keyframes!;
    expect(stops[1].scale).toBe(4);
    expect(stops[1].x).toBe(0);
    expect(stops[1].roll).toBe(45);
    expect(stops[1].rotateY).toBe(0);
    expect(stops[1].dolly).toBe(0);
  });

  it('3 — sorts an out-of-order `at` array', () => {
    const motion = motionWith([
      { at: 0, scale: 1 }, { at: 0.5, scale: 2 }, { at: 0.3, scale: 3 }, { at: 1, scale: 4 },
    ]);
    const stops = normalizeCameraKeyframes(motion).keyframes!;
    expect(stops.map((s) => s.at)).toEqual([0, 0.3, 0.5, 1]);
    expect(stops.map((s) => s.scale)).toEqual([1, 3, 2, 4]);
  });

  it('4 — pins the endpoints at 0 and 1', () => {
    const motion = motionWith([{ at: 0.2 }, { at: 0.5, scale: 2 }, { at: 0.8 }]);
    const stops = normalizeCameraKeyframes(motion).keyframes!;
    expect(stops[0].at).toBe(0);
    expect(stops[stops.length - 1].at).toBe(1);
  });

  it('5 — merges stops closer than MIN_KEYFRAME_GAP, keeping the LAST one', () => {
    const motion = motionWith([
      { at: 0 }, { at: 0.005, scale: 2 }, { at: 0.5, scale: 3 }, { at: 1 },
    ]);
    const stops = normalizeCameraKeyframes(motion).keyframes!;
    expect(stops.map((s) => s.at)).toEqual([0, 0.5, 1]);

    // Crowding the FINAL stop evicts the interior one — 1 is pinned.
    const crowded = motionWith([
      { at: 0 }, { at: 0.5, scale: 2 }, { at: 0.995, scale: 3 }, { at: 1 },
    ]);
    const keptStops = normalizeCameraKeyframes(crowded).keyframes!;
    expect(keptStops.map((s) => s.at)).toEqual([0, 0.5, 1]);
    expect(keptStops[keptStops.length - 1].at).toBe(1);
  });

  it('6 — truncates to CAMERA_MAX_KEYFRAMES while keeping both ends', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ at: i / 8, scale: 1 + i * 0.1 }));
    const stops = normalizeCameraKeyframes(motionWith(nine)).keyframes!;
    expect(stops).toHaveLength(CAMERA_MAX_KEYFRAMES);
    expect(stops[0].at).toBe(0);
    expect(stops[stops.length - 1].at).toBe(1);
    // The survivors are still ascending and unique.
    for (let i = 1; i < stops.length; i += 1) expect(stops[i].at).toBeGreaterThan(stops[i - 1].at);

    const twenty = Array.from({ length: 20 }, (_, i) => ({ at: i / 19 }));
    expect(normalizeCameraKeyframes(motionWith(twenty)).keyframes).toHaveLength(CAMERA_MAX_KEYFRAMES);
  });

  it('7 — clears the last stop\'s easing and gives every other stop one', () => {
    const motion = motionWith([
      { at: 0, scale: 1 }, { at: 0.5, scale: 2 }, { at: 1, easing: 'easeIn' },
    ]);
    const stops = normalizeCameraKeyframes(motion).keyframes!;
    expect(stops[stops.length - 1].easing).toBeUndefined();
    expect(stops[0].easing).toBeDefined();
    expect(stops[1].easing).toBeDefined();
  });

  it('8 — mirrors the endpoints back onto start / end / easing (D31)', () => {
    const motion = motionWith([
      { at: 0, scale: 1.5, x: 0.2, easing: 'easeOut' },
      { at: 0.5, scale: 2 },
      { at: 1, scale: 1.1, y: 0.9 },
    ]);
    const next = normalizeCameraKeyframes(motion);
    expect(next.start.scale).toBe(1.5);
    expect(next.start.x).toBe(0.2);
    expect(next.end.scale).toBe(1.1);
    expect(next.end.y).toBe(0.9);
    expect(next.easing).toBe('easeOut');
    KEYS.forEach((key) => {
      expect(next.start[key]).toBe(next.keyframes![0][key]);
      expect(next.end[key]).toBe(next.keyframes![next.keyframes!.length - 1][key]);
    });
  });

  it('9 — a trivial two-stop curve deletes the field (D38)', () => {
    const motion = motionWith([
      { at: 0, scale: 1 }, { at: 1, scale: 1.4 },
    ]);
    const next = normalizeCameraKeyframes(motion);
    expect('keyframes' in next).toBe(false);
    // …but the values survive on start / end.
    expect(next.start.scale).toBe(1);
    expect(next.end.scale).toBe(1.4);
  });

  it('is idempotent', () => {
    const once = normalizeCameraKeyframes(motionWith([
      { at: 0.4, scale: 2 }, { at: 0.1, scale: 1 }, { at: 0.405, scale: 3 }, { at: 0.9 },
    ]));
    const twice = normalizeCameraKeyframes(once);
    expect(twice.keyframes).toEqual(once.keyframes);
  });

  it('never mutates its input', () => {
    const motion = motionWith([{ at: 0.5 }, { at: 0.1 }, { at: 0.9 }]);
    const snapshot = JSON.stringify(motion);
    normalizeCameraKeyframes(motion);
    expect(JSON.stringify(motion)).toBe(snapshot);
  });
});

describe('T8 — insertKeyframeAt does not move the picture', () => {
  it.each([1, 0.5, 0])('holds at intensity %s', (intensity) => {
    const motion: CameraMotion = { ...applyPreset('zoom-pan-diagonal', '2d'), intensity };
    const clipDuration = 6;
    const at = 0.37;
    _clearCameraConstantsCache();
    const before = resolveCameraDraw(motion, at * clipDuration, clipDuration, ASPECT);
    const next = insertKeyframeAt(motion, at);
    _clearCameraConstantsCache();
    const after = resolveCameraDraw(next, at * clipDuration, clipDuration, ASPECT);
    expect(next.keyframes).toHaveLength(3);
    expect(after).toBeDefined();
    (['x', 'y', 'w', 'h'] as const).forEach((key) => {
      expect(Math.abs(after!.crop[key] - before!.crop[key]), key).toBeLessThan(1e-9);
    });
  });

  it('holds for a 3D motion (quad included)', () => {
    const motion = applyPreset('parallax-push', '3d');
    _clearCameraConstantsCache();
    const before = resolveCameraDraw(motion, 2.2, 6, ASPECT);
    const next = insertKeyframeAt(motion, 2.2 / 6);
    _clearCameraConstantsCache();
    const after = resolveCameraDraw(next, 2.2, 6, ASPECT);
    expect(after!.quad).toBeDefined();
    after!.quad!.pts.forEach((point, index) => {
      expect(Math.abs(point.x - before!.quad!.pts[index].x)).toBeLessThan(1e-6);
      expect(Math.abs(point.y - before!.quad!.pts[index].y)).toBeLessThan(1e-6);
    });
  });

  it('stores the trajectory value, not the resolved one', () => {
    const motion: CameraMotion = { ...applyPreset('push-in', '2d'), intensity: 0.5, easing: 'linear' };
    const next = insertKeyframeAt(motion, 0.5);
    const stored = next.keyframes![1];
    expect(stored.scale).toBeCloseTo(trajectoryAt(motion, tauAtProgress(motion, 0.5)).scale, 12);
    // The resolved value at half intensity is strictly smaller — storing THAT
    // would fold intensity in twice and the picture would jump.
    expect(stored.scale).not.toBeCloseTo(
      keyframeAtTrajectory(motion, tauAtProgress(motion, 0.5)).scale, 6,
    );
  });

  it('refuses to crowd an existing stop', () => {
    const motion = insertKeyframeAt(applyPreset('push-in', '2d'), 0.5);
    const crowded = insertKeyframeAt(motion, 0.5 + MIN_KEYFRAME_GAP / 4);
    // Normalization merges the near-duplicate away again.
    expect(crowded.keyframes).toHaveLength(3);
  });
});

describe('remove / retime / component edits', () => {
  const base = motionWith([
    { at: 0, scale: 1 }, { at: 0.3, scale: 2 }, { at: 0.7, scale: 3 }, { at: 1, scale: 1 },
  ]);

  it('cannot remove an endpoint', () => {
    expect(removeKeyframeAt(base, 0)).toBe(base);
    expect(removeKeyframeAt(base, 3)).toBe(base);
  });

  it('removes an interior stop and collapses back to two points when empty', () => {
    expect(removeKeyframeAt(base, 1).keyframes).toHaveLength(3);
    const two = removeKeyframeAt(removeKeyframeAt(base, 1), 1);
    expect('keyframes' in two).toBe(false);
    expect(two.start.scale).toBe(1);
    expect(two.end.scale).toBe(1);
  });

  it('cannot retime an endpoint and confines an interior one', () => {
    expect(retimeKeyframe(base, 0, 0.4)).toBe(base);
    expect(retimeKeyframe(base, 3, 0.4)).toBe(base);
    expect(retimeKeyframe(base, 1, 0.95).keyframes![1].at).toBeCloseTo(0.7 - MIN_KEYFRAME_GAP, 12);
    expect(retimeKeyframe(base, 1, -5).keyframes![1].at).toBeCloseTo(MIN_KEYFRAME_GAP, 12);
  });

  it('sets a component, clamps it, and flips presetId to custom', () => {
    const next = setKeyframeComponent(base, 1, 'scale', 99);
    expect(next.keyframes![1].scale).toBe(4);
    expect(next.presetId).toBe('custom');
  });

  it('edits a two-point motion through start / end without creating a curve', () => {
    const next = setKeyframeComponent(applyPreset('push-in', '2d'), 1, 'scale', 2);
    expect('keyframes' in next).toBe(false);
    expect(next.end.scale).toBe(2);
    expect(next.start.scale).toBe(1);
  });

  it('sets a segment easing on the LEFT stop only (D34)', () => {
    const next = setSegmentEasing(base, 1, 'easeIn');
    expect(next.keyframes![1].easing).toBe('easeIn');
    expect(next.keyframes![3].easing).toBeUndefined();
    expect(setSegmentEasing(base, 3, 'easeIn')).toBe(base);
  });
});

describe('T9 — reverse', () => {
  it('T9b — a two-point motion reverses exactly as it did before (D46)', () => {
    const motion = { ...applyPreset('push-in', '2d'), easing: 'easeIn' as const };
    const reversed = reverseCameraMotion(motion);
    expect(reversed).toEqual({
      ...motion,
      presetId: 'custom',
      start: { ...motion.end },
      end: { ...motion.start },
    });
    // The easing is explicitly NOT mirrored — that is §13-6, not this round.
    expect(reversed.easing).toBe('easeIn');
    expect('keyframes' in reversed).toBe(false);
  });

  it('T9a — a curve reverses its times and mirrors each segment easing', () => {
    const motion = normalizeCameraKeyframes(motionWith([
      { at: 0, scale: 1, easing: 'easeIn' },
      { at: 0.25, scale: 2, easing: 'linear' },
      { at: 0.5, scale: 1.5, easing: 'easeOut' },
      { at: 0.8, scale: 3, easing: 'easeInOut' },
      { at: 1, scale: 1 },
    ]));
    const reversed = reverseCameraMotion(motion);
    expect(reversed.keyframes!.map((s) => s.at)).toEqual([0, 0.2, 0.5, 0.75, 1]);
    expect(reversed.keyframes!.map((s) => s.scale)).toEqual([1, 3, 1.5, 2, 1]);
    expect(reversed.keyframes!.map((s) => s.easing)).toEqual([
      'easeInOut', 'easeIn', 'linear', 'easeOut', undefined,
    ]);
  });

  it('T9a — reversing twice returns the original curve', () => {
    const motion = normalizeCameraKeyframes(motionWith([
      { at: 0, scale: 1, easing: 'easeIn' },
      { at: 0.42, scale: 2.5, easing: 'easeOut' },
      { at: 1, scale: 1.2 },
    ]));
    const twice = reverseCameraMotion(reverseCameraMotion(motion));
    expect(twice.keyframes).toEqual(motion.keyframes);
    expect(twice.easing).toBe(motion.easing);
  });
});
