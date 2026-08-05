/**
 * Camera motion — split window rebase (spec §4.6, review P1-5 regression gate).
 *
 * The invariant: splitting a clip must not change a single frame. Without the
 * rebase both halves replay the whole motion and the picture snaps back to the
 * start at the cut.
 */

import { describe, it, expect } from 'vitest';
import { rebaseCameraMotionForSplit, shiftCameraMotionWindow } from '../splitRebase';
import { keyframeAt, easedProgressAt } from '../easing';
import { applyPreset } from '../cameraPresets';
import type { CameraKeyframe } from '../types';

const ORIGINAL_DURATION = 6;
const CUT = 2;

function sampleKeyframe(motion: Parameters<typeof keyframeAt>[0], tLocal: number, clipDuration: number): CameraKeyframe {
  return keyframeAt(motion, easedProgressAt(motion, tLocal, clipDuration));
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
