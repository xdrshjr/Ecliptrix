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
});
