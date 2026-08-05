/**
 * Camera motion — split window rebase (spec §4.6, review P1-5 regression gate).
 *
 * The invariant: splitting a clip must not change a single frame. Without the
 * rebase both halves replay the whole motion and the picture snaps back to the
 * start at the cut.
 */

import { describe, it, expect } from 'vitest';
import { rebaseCameraMotionForSplit, shiftCameraMotionWindow } from '../splitRebase';
import { keyframeAtTrajectory, progressAt, tauAtProgress } from '../easing';
import { normalizeCameraKeyframes } from '../keyframes';
import { applyPreset } from '../cameraPresets';
import { DEFAULT_KEYFRAME, type CameraKeyframe, type CameraMotion } from '../types';

const ORIGINAL_DURATION = 6;
const CUT = 2;

/**
 * The τ two-step, spelled out (C27's ONE frontend exemption): this helper is a
 * hand-written stand-in for `resolveCameraDraw`, so it has to follow the same
 * `progressAt → tauAtProgress → keyframeAtTrajectory` path the real one takes.
 * Leaving it on the old `keyframeAt(easedProgressAt(...))` would compare a
 * multi-keyframe curve against a two-point evaluation and pass by accident.
 */
function sampleKeyframe(motion: CameraMotion, tLocal: number, clipDuration: number): CameraKeyframe {
  const u = progressAt(motion, tLocal, clipDuration);
  return keyframeAtTrajectory(motion, tauAtProgress(motion, u));
}

describe('rebaseCameraMotionForSplit', () => {
  it('is a no-op for a clip without a motion', () => {
    expect(rebaseCameraMotionForSplit(undefined, ORIGINAL_DURATION, CUT)).toEqual({});
  });

  it('materializes the implicit window into absolute numbers', () => {
    const { left, right } = rebaseCameraMotionForSplit(
      applyPreset('push-in', '2d'), ORIGINAL_DURATION, CUT,
    );
    expect(left!.startOffset).toBe(0);
    expect(left!.duration).toBe(ORIGINAL_DURATION);
    expect(right!.startOffset).toBe(-CUT);
    expect(right!.duration).toBe(ORIGINAL_DURATION);
  });

  it('keeps the two halves frame-identical to the original clip', () => {
    const original = applyPreset('push-in', '2d');
    const { left, right } = rebaseCameraMotionForSplit(original, ORIGINAL_DURATION, CUT);

    // Left half: same clip-local time, same framing.
    for (const t of [0, 0.5, 1, 1.9]) {
      expect(sampleKeyframe(left!, t, CUT).scale).toBeCloseTo(
        sampleKeyframe(original, t, ORIGINAL_DURATION).scale, 9,
      );
    }
    // Right half: local t maps to original t + CUT.
    for (const t of [0, 1, 2, 3.9]) {
      expect(sampleKeyframe(right!, t, ORIGINAL_DURATION - CUT).scale).toBeCloseTo(
        sampleKeyframe(original, t + CUT, ORIGINAL_DURATION).scale, 9,
      );
    }
  });

  it('makes the right half start exactly where the cut left off (no jump)', () => {
    const original = applyPreset('zoom-pan-diagonal', '2d');
    const { right } = rebaseCameraMotionForSplit(original, ORIGINAL_DURATION, CUT);
    const atCut = sampleKeyframe(original, CUT, ORIGINAL_DURATION);
    const atRightStart = sampleKeyframe(right!, 0, ORIGINAL_DURATION - CUT);
    (Object.keys(atCut) as Array<keyof CameraKeyframe>).forEach((key) => {
      expect(atRightStart[key]).toBeCloseTo(atCut[key], 9);
    });
  });

  it('preserves an explicit window that started part-way in', () => {
    const original = { ...applyPreset('push-in', '2d'), startOffset: 1, duration: 3 };
    const { left, right } = rebaseCameraMotionForSplit(original, ORIGINAL_DURATION, CUT);
    expect(left!.startOffset).toBe(1);
    expect(left!.duration).toBe(3);
    expect(right!.startOffset).toBe(-1);
    expect(right!.duration).toBe(3);
  });
});

/**
 * T7 (D41) — a curve needs NO rebase of its own.
 *
 * `at` is normalized against the motion window, and the split only moves the
 * window's origin; the length rides along untouched. So the two halves keep the
 * identical curve and merely enter it at different points. This is asserted
 * rather than assumed precisely so a future "let me finish the rebase" patch
 * fails here instead of in someone's export.
 */
describe('rebaseCameraMotionForSplit — multi-keyframe curves', () => {
  const curved: CameraMotion = normalizeCameraKeyframes({
    ...applyPreset('zoom-pan-diagonal', '2d'),
    easing: 'linear',
    keyframes: [
      { ...DEFAULT_KEYFRAME, at: 0, scale: 1, x: 0.55, easing: 'linear' },
      { ...DEFAULT_KEYFRAME, at: 0.3, scale: 1.6, x: 0.3, easing: 'easeOut' },
      { ...DEFAULT_KEYFRAME, at: 0.7, scale: 1.2, x: 0.7, easing: 'easeIn' },
      { ...DEFAULT_KEYFRAME, at: 1, scale: 1.3, x: 0.42 },
    ],
  });

  it('passes the keyframes through item for item', () => {
    const { left, right } = rebaseCameraMotionForSplit(curved, ORIGINAL_DURATION, CUT);
    expect(left!.keyframes).toEqual(curved.keyframes);
    expect(right!.keyframes).toEqual(curved.keyframes);
  });

  it('keeps both halves frame-identical to the original curve', () => {
    const { left, right } = rebaseCameraMotionForSplit(curved, ORIGINAL_DURATION, CUT);
    for (const t of [0, 0.7, 1.4, 1.99]) {
      const a = sampleKeyframe(left!, t, CUT);
      const b = sampleKeyframe(curved, t, ORIGINAL_DURATION);
      (Object.keys(a) as Array<keyof CameraKeyframe>).forEach((key) => {
        expect(a[key], `left/${t}/${key}`).toBeCloseTo(b[key], 9);
      });
    }
    for (const t of [0, 1, 2.5, 3.9]) {
      const a = sampleKeyframe(right!, t, ORIGINAL_DURATION - CUT);
      const b = sampleKeyframe(curved, t + CUT, ORIGINAL_DURATION);
      (Object.keys(a) as Array<keyof CameraKeyframe>).forEach((key) => {
        expect(a[key], `right/${t}/${key}`).toBeCloseTo(b[key], 9);
      });
    }
  });

  it('is continuous at the cut — no jump back to the curve\'s start', () => {
    const { left, right } = rebaseCameraMotionForSplit(curved, ORIGINAL_DURATION, CUT);
    const leftEnd = sampleKeyframe(left!, CUT, CUT);
    const rightStart = sampleKeyframe(right!, 0, ORIGINAL_DURATION - CUT);
    (Object.keys(leftEnd) as Array<keyof CameraKeyframe>).forEach((key) => {
      expect(Math.abs(rightStart[key] - leftEnd[key]), key).toBeLessThan(1e-6);
    });
  });
});

describe('shiftCameraMotionWindow', () => {
  it('leaves an implicit window alone — it re-flows on its own', () => {
    const motion = applyPreset('push-in', '2d');
    expect(shiftCameraMotionWindow(motion, 1)).toBe(motion);
  });

  it('slides an explicit window against a left-edge trim', () => {
    const motion = { ...applyPreset('push-in', '2d'), startOffset: 2, duration: 3 };
    expect(shiftCameraMotionWindow(motion, 0.5)!.startOffset).toBeCloseTo(1.5, 9);
  });

  it('is a no-op for a zero delta or a missing motion', () => {
    const motion = { ...applyPreset('push-in', '2d'), startOffset: 2, duration: 3 };
    expect(shiftCameraMotionWindow(motion, 0)).toBe(motion);
    expect(shiftCameraMotionWindow(undefined, 1)).toBeUndefined();
  });
});
