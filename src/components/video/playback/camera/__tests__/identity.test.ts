/**
 * Camera motion — identity fast path (spec §7.2, review P1-2 regression gate).
 *
 * The failure this locks down: `pull-out` with intensity 0 is a STATIC 1.25×
 * close-up, not "no motion". Treating it as no motion renders the un-cropped
 * frame in preview AND export while the panel's stage shows the crop.
 */

import { describe, it, expect } from 'vitest';
import { isIdentityCameraMotion, keyframeEqualsDefault } from '../identity';
import { applyPreset, emptyCameraMotion } from '../cameraPresets';
import { resolveCameraDraw } from '../resolveCameraDraw';
import { _clearCameraConstantsCache } from '../cameraGeometry';
import { DEFAULT_KEYFRAME, type CameraMotion } from '../types';

const ASPECT = 16 / 9;

describe('keyframeEqualsDefault', () => {
  it('accepts the default keyframe and rejects any deviation', () => {
    expect(keyframeEqualsDefault(DEFAULT_KEYFRAME)).toBe(true);
    expect(keyframeEqualsDefault({ ...DEFAULT_KEYFRAME, scale: 1.0000001 })).toBe(true);
    expect(keyframeEqualsDefault({ ...DEFAULT_KEYFRAME, scale: 1.25 })).toBe(false);
  });
});

describe('isIdentityCameraMotion', () => {
  it('treats a neutral motion as identity', () => {
    expect(isIdentityCameraMotion(emptyCameraMotion('2d'))).toBe(true);
    expect(isIdentityCameraMotion(undefined)).toBe(true);
  });

  it('treats an intensity-0 motion with a DEFAULT start as identity', () => {
    expect(isIdentityCameraMotion({ ...applyPreset('push-in', '2d'), intensity: 0 })).toBe(true);
  });

  it('does NOT treat pull-out + intensity 0 as identity (P1-2)', () => {
    const motion = { ...applyPreset('pull-out', '2d'), intensity: 0 };
    expect(motion.start.scale).toBeCloseTo(1.25, 10);
    expect(isIdentityCameraMotion(motion)).toBe(false);
  });

  it('resolves pull-out + intensity 0 to a static 1.25× crop, not undefined', () => {
    _clearCameraConstantsCache();
    const motion = { ...applyPreset('pull-out', '2d'), intensity: 0 };
    const atStart = resolveCameraDraw(motion, 0, 5, ASPECT);
    const atEnd = resolveCameraDraw(motion, 5, 5, ASPECT);
    expect(atStart).toBeDefined();
    expect(atEnd).toBeDefined();
    expect(atStart!.crop.w).toBeCloseTo(1 / 1.25, 9);
    // Static means the framing does not move across the clip.
    expect(atEnd!.crop.w).toBeCloseTo(atStart!.crop.w, 12);
    expect(atEnd!.crop.x).toBeCloseTo(atStart!.crop.x, 12);
  });

  it('still takes the fast path for a genuinely empty motion', () => {
    expect(resolveCameraDraw(emptyCameraMotion('2d'), 1, 5, ASPECT)).toBeUndefined();
    expect(resolveCameraDraw(undefined, 1, 5, ASPECT)).toBeUndefined();
  });

  it('discards an unknown structure version rather than guessing', () => {
    const motion = { ...applyPreset('push-in', '2d'), version: 2 as unknown as 1 };
    expect(resolveCameraDraw(motion, 1, 5, ASPECT)).toBeUndefined();
  });
});

/**
 * T4a (P0) — the identity rule generalized to curves (§4.2.5).
 *
 * The mine this defuses: a curve whose ENDPOINTS are both default but whose
 * middle keyframe pushes to 2×. Under the old `start`/`end`-only rule that
 * motion is "no motion", so the preview resolver returns `undefined` and the
 * export returns an empty chain — the motion the user can see on the panel
 * disappears from the preview and the render at the same time, silently.
 */
describe('T4a — isIdentityCameraMotion on curves', () => {
  const withStops = (stops: Array<Record<string, number>>, intensity = 1): CameraMotion => ({
    version: 1,
    mode: '2d',
    presetId: 'custom',
    intensity,
    easing: 'easeInOut',
    start: { ...DEFAULT_KEYFRAME },
    end: { ...DEFAULT_KEYFRAME },
    keyframes: stops.map((stop) => ({ ...DEFAULT_KEYFRAME, ...stop })) as CameraMotion['keyframes'],
  });

  it('is NOT identity when only a middle keyframe moves', () => {
    const motion = withStops([{ at: 0 }, { at: 0.5, scale: 2 }, { at: 1 }]);
    expect(motion.start).toEqual(DEFAULT_KEYFRAME);
    expect(motion.end).toEqual(DEFAULT_KEYFRAME);
    expect(isIdentityCameraMotion(motion)).toBe(false);
  });

  it('resolves that curve to a real, moving draw', () => {
    _clearCameraConstantsCache();
    const motion = withStops([{ at: 0 }, { at: 0.5, scale: 2 }, { at: 1 }]);
    const mid = resolveCameraDraw(motion, 3, 6, ASPECT);
    expect(mid).toBeDefined();
    expect(mid!.crop.w).toBeCloseTo(0.5, 9);
  });

  it('IS identity when every stop is the default framing', () => {
    expect(isIdentityCameraMotion(withStops([{ at: 0 }, { at: 0.5 }, { at: 1 }]))).toBe(true);
  });

  it('IS identity at intensity 0 with a default first stop (D35)', () => {
    expect(isIdentityCameraMotion(withStops([{ at: 0 }, { at: 0.5, scale: 2 }, { at: 1 }], 0)))
      .toBe(true);
  });

  it('is NOT identity at intensity 0 when the FIRST stop is non-default', () => {
    expect(isIdentityCameraMotion(withStops([{ at: 0, scale: 1.25 }, { at: 0.5 }, { at: 1 }], 0)))
      .toBe(false);
  });
});
