/**
 * Camera motion — the fingerprint must carry the curve (T5, §4.2.6).
 *
 * P0. Four consumers key off this one string, and every one of them fails
 * SILENTLY when an edit does not reach it: the preview never repaints, a paused
 * apply never shows, one curve inherits another's `coverScale`, and closing the
 * panel throws the edit away without asking. The two assertions that matter are
 * opposites — an old motion's fingerprint must be character-identical, and any
 * curve edit must change it.
 */

import { describe, it, expect } from 'vitest';
import { cameraMotionFingerprint } from '../fingerprint';
import { cameraMotionConstants, _clearCameraConstantsCache } from '../cameraGeometry';
import { normalizeCameraKeyframes, insertKeyframeAt, setKeyframeComponent, retimeKeyframe, setSegmentEasing } from '../keyframes';
import { applyPreset } from '../cameraPresets';
import { DEFAULT_KEYFRAME, type CameraKeyframeStop, type CameraMotion } from '../types';

const ASPECT = 16 / 9;

function curve(stops: Array<Partial<CameraKeyframeStop>>): CameraMotion {
  return normalizeCameraKeyframes({
    version: 1,
    mode: '2d',
    presetId: 'custom',
    intensity: 1,
    easing: 'easeInOut',
    start: { ...DEFAULT_KEYFRAME },
    end: { ...DEFAULT_KEYFRAME },
    keyframes: stops.map((stop) => ({ ...DEFAULT_KEYFRAME, at: 0, ...stop })),
  });
}

describe('T5 — cameraMotionFingerprint', () => {
  it('① is character-identical for a motion without a curve', () => {
    // The nine legacy segments, transcribed from `fingerprint.ts@f4510cd`.
    const motion = { ...applyPreset('zoom-pan-diagonal', '2d'), startOffset: 1.5, duration: 3 };
    const legacy = [
      motion.version,
      motion.mode,
      motion.presetId ?? '',
      (motion.intensity ?? 1).toFixed(4),
      motion.easing,
      motion.startOffset != null ? motion.startOffset.toFixed(4) : '',
      motion.duration != null ? motion.duration.toFixed(4) : '',
      ['scale', 'x', 'y', 'roll', 'rotateX', 'rotateY', 'dolly']
        .map((key) => (motion.start as unknown as Record<string, number>)[key].toFixed(4)).join(','),
      ['scale', 'x', 'y', 'roll', 'rotateX', 'rotateY', 'dolly']
        .map((key) => (motion.end as unknown as Record<string, number>)[key].toFixed(4)).join(','),
    ].join('|');
    expect(cameraMotionFingerprint(motion)).toBe(legacy);
    // No trailing separator: an unconditional empty stops segment would add one.
    expect(cameraMotionFingerprint(motion).endsWith('|')).toBe(false);
  });

  it('changes the moment a curve exists at all', () => {
    const flat = applyPreset('push-in', '2d');
    const curved = insertKeyframeAt(flat, 0.5);
    expect(cameraMotionFingerprint(curved)).not.toBe(cameraMotionFingerprint(flat));
  });

  const base = curve([
    { at: 0, scale: 1, easing: 'linear' },
    { at: 0.4, scale: 2, easing: 'linear' },
    { at: 1, scale: 1.2 },
  ]);

  it('② changes when a middle keyframe component changes', () => {
    const next = setKeyframeComponent(base, 1, 'scale', 2.5);
    expect(cameraMotionFingerprint(next)).not.toBe(cameraMotionFingerprint(base));
  });

  it('② changes for a middle-keyframe X move too (not just scale)', () => {
    const next = setKeyframeComponent(base, 1, 'x', 0.31);
    expect(cameraMotionFingerprint(next)).not.toBe(cameraMotionFingerprint(base));
  });

  it('③ changes when a keyframe is re-timed', () => {
    const next = retimeKeyframe(base, 1, 0.6);
    expect(cameraMotionFingerprint(next)).not.toBe(cameraMotionFingerprint(base));
  });

  it('④ changes when a SEGMENT easing changes', () => {
    const next = setSegmentEasing(base, 1, 'easeIn');
    expect(cameraMotionFingerprint(next)).not.toBe(cameraMotionFingerprint(base));
    // …and that edit is invisible to `start` / `end`, which is exactly why the
    // stops have to be in the fingerprint.
    expect(next.start).toEqual(base.start);
    expect(next.end).toEqual(base.end);
  });

  it('⑤ keeps two curves that differ only in the middle out of each other\'s memo', () => {
    const other = setKeyframeComponent(base, 1, 'scale', 3.5);
    _clearCameraConstantsCache();
    const first = cameraMotionConstants(base, ASPECT);
    const second = cameraMotionConstants(other, ASPECT);
    expect(second).not.toBe(first);
  });

  it('gives two structurally identical curves the same fingerprint', () => {
    const twin = curve([
      { at: 0, scale: 1, easing: 'linear' },
      { at: 0.4, scale: 2, easing: 'linear' },
      { at: 1, scale: 1.2 },
    ]);
    expect(cameraMotionFingerprint(twin)).toBe(cameraMotionFingerprint(base));
  });

  it('separates a roll curve from a flat one in the rollPad memo (③ in practice)', () => {
    const flat = curve([{ at: 0, roll: 0 }, { at: 0.5, roll: 0 }, { at: 1, roll: 0 }]);
    const rolled = curve([{ at: 0, roll: 0 }, { at: 0.5, roll: 30 }, { at: 1, roll: 0 }]);
    _clearCameraConstantsCache();
    expect(cameraMotionConstants(flat, ASPECT).rollPad).toBe(1);
    expect(cameraMotionConstants(rolled, ASPECT).rollPad).toBeGreaterThan(1.2);
  });
});
