/**
 * ImageOverlayLayer — still camera input (camera-motion-stills §4.3.1 / §9.1).
 *
 * The layer stays PURE: it answers "is there a motion, and how far into the clip
 * are we", and refuses to answer "what does it look like" — that needs the
 * image's decoded aspect, which lives in the compositor. Guessing an aspect out
 * here is the exact bug v1's P1-1 was about, so the split is load-bearing rather
 * than stylistic.
 */

import { describe, it, expect } from 'vitest';
import { buildImageLayersAt, stillCameraInputAt } from '../ImageOverlayLayer';
import type { ImageOverlayInput } from '../ImageOverlayLayer';
import { applyPreset, emptyCameraMotion } from '../camera/cameraPresets';

function still(overrides: Partial<ImageOverlayInput> = {}): ImageOverlayInput {
  return {
    id: 'img-1',
    src: '/api/storage/files/images/storyboard-03.png',
    startTime: 4,
    duration: 6,
    position: { x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 },
    ...overrides,
  };
}

describe('stillCameraInputAt', () => {
  it('reports clip-local time exactly like the video layer does', () => {
    const input = stillCameraInputAt(still({ cameraMotion: applyPreset('push-in', '2d') }), 5);
    expect(input).toBeDefined();
    expect(input!.tLocal).toBeCloseTo(1, 9);
    expect(input!.clipDuration).toBe(6);
  });

  it('keeps tLocal negative-capable so a split half stays continuous', () => {
    const input = stillCameraInputAt(
      still({ startTime: 4, cameraMotion: applyPreset('push-in', '2d') }),
      3.5,
    );
    expect(input!.tLocal).toBeCloseTo(-0.5, 9);
  });

  it('is undefined without a motion', () => {
    expect(stillCameraInputAt(still(), 5)).toBeUndefined();
    expect(stillCameraInputAt(still({ cameraMotion: null }), 5)).toBeUndefined();
  });

  it('is undefined for an identity motion — nothing to do, no hot-path cost', () => {
    expect(stillCameraInputAt(still({ cameraMotion: emptyCameraMotion('2d') }), 5)).toBeUndefined();
    expect(stillCameraInputAt(still({ cameraMotion: emptyCameraMotion('3d') }), 5)).toBeUndefined();
  });
});

describe('buildImageLayersAt — camera passthrough', () => {
  it('attaches cameraInput to the active layer', () => {
    const layers = buildImageLayersAt([still({ cameraMotion: applyPreset('orbit-left', '3d') })], 5);
    expect(layers).toHaveLength(1);
    expect(layers[0].cameraInput).toBeDefined();
    expect(layers[0].cameraInput!.motion.mode).toBe('3d');
    expect(layers[0].cameraInput!.tLocal).toBeCloseTo(1, 9);
  });

  it('omits the key entirely when there is no motion (zero regression)', () => {
    const layers = buildImageLayersAt([still()], 5);
    expect(layers[0].cameraInput).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(layers[0], 'cameraInput')).toBe(false);
  });

  it('leaves the rest of the layer shape untouched', () => {
    const layers = buildImageLayersAt([still({ cameraMotion: applyPreset('push-in', '2d') })], 5);
    expect(layers[0].kind).toBe('image');
    expect(layers[0].id).toBe('img-1');
    expect(layers[0].opacity).toBe(1);
    expect(layers[0].bounds.w).toBeCloseTo(0.8, 9);
  });

  it('does not emit a layer outside the clip window', () => {
    expect(buildImageLayersAt([still({ cameraMotion: applyPreset('push-in', '2d') })], 3)).toHaveLength(0);
    expect(buildImageLayersAt([still({ cameraMotion: applyPreset('push-in', '2d') })], 10)).toHaveLength(0);
  });
});
