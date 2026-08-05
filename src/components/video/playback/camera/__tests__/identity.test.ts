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
import { DEFAULT_KEYFRAME } from '../types';

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
