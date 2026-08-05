/**
 * Composition signature — camera motion (spec D12 / P0-4 regression gate).
 *
 * The gate has to be built from a sequence whose OTHER passthrough fields are
 * all `undefined`. `compositorPassthroughFields` short-circuits in exactly that
 * case, so a test that sets, say, `opacity` first would pass even with the
 * early-return guard un-fixed — i.e. it would test nothing.
 *
 * The failure this prevents is the repo's recurring "pressed Apply but the
 * preview did not move" (R8).
 */

import { describe, it, expect } from 'vitest';
import { computeCompositionSignature } from '../useTimelineComposition';
import { applyPreset } from '../../playback/camera/cameraPresets';
import { cameraMotionFingerprint } from '../../playback/camera/fingerprint';
import { cameraMotionConstants, _clearCameraConstantsCache } from '../../playback/camera/cameraGeometry';
import { isIdentityCameraMotion } from '../../playback/camera/identity';
import {
  insertKeyframeAt,
  retimeKeyframe,
  setKeyframeComponent,
} from '../../playback/camera/keyframes';
import type { VideoSequenceItem } from '../../types';

/** A sequence with EVERY other passthrough field left undefined (the gate). */
function bareSequence(cameraMotion?: VideoSequenceItem['cameraMotion']): VideoSequenceItem {
  return {
    id: 'clip-1',
    name: 'clip.mp4',
    url: '/api/storage/files/clip.mp4',
    startTime: 0,
    duration: 6,
    trackId: 'video-1',
    cameraMotion,
  };
}

describe('computeCompositionSignature — camera motion', () => {
  it('changes when a motion is applied to an otherwise-bare clip', () => {
    const before = computeCompositionSignature([bareSequence()], [], [], []);
    const after = computeCompositionSignature(
      [bareSequence(applyPreset('push-in', '2d'))], [], [], [],
    );
    expect(after).not.toBe(before);
  });

  it('changes when the motion parameters change', () => {
    const a = computeCompositionSignature([bareSequence(applyPreset('push-in', '2d'))], [], [], []);
    const b = computeCompositionSignature([bareSequence(applyPreset('pull-out', '2d'))], [], [], []);
    expect(b).not.toBe(a);
  });

  it('changes when only the intensity moves', () => {
    const base = applyPreset('push-in', '2d');
    const a = computeCompositionSignature([bareSequence(base)], [], [], []);
    const b = computeCompositionSignature([bareSequence({ ...base, intensity: 1.5 })], [], [], []);
    expect(b).not.toBe(a);
  });

  it('changes when a motion is cleared', () => {
    const withMotion = computeCompositionSignature(
      [bareSequence(applyPreset('push-in', '2d'))], [], [], [],
    );
    const cleared = computeCompositionSignature([bareSequence()], [], [], []);
    expect(cleared).not.toBe(withMotion);
  });

  it('is stable for an unchanged motion (no repaint churn)', () => {
    const motion = applyPreset('orbit-left', '3d');
    expect(computeCompositionSignature([bareSequence(motion)], [], [], []))
      .toBe(computeCompositionSignature([bareSequence({ ...motion })], [], [], []));
  });

  it('leaves the signature of a motion-free timeline untouched', () => {
    // Zero-regression: projects that never touch the feature keep the exact
    // signature they had before it existed.
    expect(computeCompositionSignature([bareSequence()], [], [], []))
      .toContain('clip-1');
  });

  /**
   * T16 / T20 — the curve reaches all four fingerprint consumers.
   *
   * Editing ONLY a middle keyframe leaves `start`, `end`, `intensity`, `easing`
   * and the window identical, so anything keyed off those alone cannot tell the
   * two motions apart. That is the "pressed Apply and nothing moved" failure
   * (R8/R29) in its newest disguise.
   */
  describe('T16 / T20 — middle-keyframe edits', () => {
    const base = setKeyframeComponent(
      insertKeyframeAt(applyPreset('push-in', '2d'), 0.4), 1, 'scale', 2,
    );
    const edited = setKeyframeComponent(base, 1, 'scale', 3);

    it('the two motions really are identical except in the middle', () => {
      expect(edited.start).toEqual(base.start);
      expect(edited.end).toEqual(base.end);
      expect(edited.intensity).toBe(base.intensity);
      expect(edited.easing).toBe(base.easing);
    });

    it('① the composition signature changes (the preview repaint gate)', () => {
      expect(computeCompositionSignature([bareSequence(edited)], [], [], []))
        .not.toBe(computeCompositionSignature([bareSequence(base)], [], [], []));
    });

    it('② the paused-repaint signature changes', () => {
      // Same shape `useCompositionPlayback.ts:611` builds.
      const signature = (motion: typeof base) => `clip-1:${cameraMotionFingerprint(motion)}`;
      expect(signature(edited)).not.toBe(signature(base));
    });

    it('③ the constants memo is not shared between them', () => {
      _clearCameraConstantsCache();
      expect(cameraMotionConstants(edited, 16 / 9))
        .not.toBe(cameraMotionConstants(base, 16 / 9));
    });

    it('④ the panel dirty check sees it (A44 really re-confirms)', () => {
      // The exact comparison `CameraMotionModal.tsx:143-151` performs.
      const baseline = cameraMotionFingerprint(base);
      const draft = isIdentityCameraMotion(edited) ? '' : cameraMotionFingerprint(edited);
      expect(baseline !== draft).toBe(true);
    });

    it('re-timing a keyframe changes the signature too', () => {
      const moved = retimeKeyframe(base, 1, 0.7);
      expect(computeCompositionSignature([bareSequence(moved)], [], [], []))
        .not.toBe(computeCompositionSignature([bareSequence(base)], [], [], []));
    });

    it('but an unchanged curve is still stable (no repaint churn)', () => {
      expect(computeCompositionSignature([bareSequence({ ...base })], [], [], []))
        .toBe(computeCompositionSignature([bareSequence(base)], [], [], []));
    });
  });
});
