/**
 * The TIME stage for stills — where G1 actually was.
 *
 * Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §3.2 / §7.5-24.
 *
 * `ImageOverlayInput` had no `cameraMotion` field and `buildImageLayersAt` never
 * called the kernel, so a move applied to an image was accepted by the panel,
 * stored on the item, badged in the timeline — and then dropped, silently, by
 * both preview and export. These tests pin the seam that carries it, and the two
 * arguments that decide whether the framing is the one the user chose.
 */

import { describe, expect, it, vi } from 'vitest';
import * as kernel from '../CameraMotionLayer';
import { buildImageLayersAt, type ImageOverlayInput } from '../ImageOverlayLayer';
import { motionFromPreset } from '../cameraMotionPresets';

function still(overrides: Partial<ImageOverlayInput> = {}): ImageOverlayInput {
  return {
    id: 'still-1',
    src: 'still.png',
    startTime: 2,
    duration: 4,
    position: { x: 0.1, y: 0.2, width: 0.5, height: 0.25, zIndex: 10 },
    ...overrides,
  };
}

describe('buildImageLayersAt — camera motion on a still', () => {
  it('attaches the scalar motion sample, and nothing pixel-shaped', () => {
    const motion = motionFromPreset('ken-burns')!;
    const [layer] = buildImageLayersAt([still({ cameraMotion: motion })], 3);

    expect(layer.motion).toBeDefined();
    expect(layer.motion?.space).toBe('2d');
    expect(typeof layer.motion?.state.scale).toBe('number');
    expect(layer.motion).not.toHaveProperty('quad');
    expect(layer.motion).not.toHaveProperty('homography');
  });

  it('omits `motion` entirely for a still without one', () => {
    const [layer] = buildImageLayersAt([still()], 3);
    expect(layer.motion).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(layer, 'motion')).toBe(false);
  });

  it('advances the sample with composition time, anchored to the still window', () => {
    const motion = motionFromPreset('zoom-in')!;
    const items = [still({ cameraMotion: motion })];
    // The still starts at t=2 and its window is half-open: t=2 is progress 0,
    // and the last visible instant sits just short of t=6.
    const atStart = buildImageLayersAt(items, 2)[0].motion!.state.scale;
    const atEnd = buildImageLayersAt(items, 5.99)[0].motion!.state.scale;
    expect(atEnd).toBeGreaterThan(atStart);
    expect(atStart).toBeCloseTo(motion.from.scale, 9);
  });

  it('calls the kernel with the BOX aspect and coverage OFF (§3.1.1)', () => {
    // The two arguments that decide whether the user's framing survives. A spy
    // is the only way to see them: the effect of getting them wrong is a state
    // both implementations would agree on (L17).
    const spy = vi.spyOn(kernel, 'motionStateAt');
    try {
      const motion = motionFromPreset('pan-left')!;
      // 0.5 x 0.25 of a 16:9 canvas => box ratio 2 * 16/9.
      buildImageLayersAt([still({ cameraMotion: motion })], 3, undefined, 16 / 9);

      expect(spy).toHaveBeenCalled();
      const [, clip, , aspect, enforceCoverage] = spy.mock.calls[0];
      expect(clip).toEqual({ startTime: 2, duration: 4 });
      expect(aspect).toBeCloseTo((0.5 / 0.25) * (16 / 9), 9);
      expect(enforceCoverage).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves a pure pan un-zoomed end to end (N1-c through the real seam)', () => {
    const base = motionFromPreset('pan-left')!;
    const motion = {
      ...base,
      from: { ...base.from, scale: 1, offsetX: -0.1 },
      to: { ...base.to, scale: 1, offsetX: 0.1 },
    };
    for (const t of [2, 4, 5.99]) {
      const [layer] = buildImageLayersAt([still({ cameraMotion: motion })], t);
      expect(layer.motion!.state.scale).toBe(1);
    }
  });

  it('keeps the rest of the layer contract untouched', () => {
    const motion = motionFromPreset('orbit-left')!;
    const [layer] = buildImageLayersAt([still({ cameraMotion: motion, opacity: 0.5 })], 3);
    expect(layer.kind).toBe('image');
    expect(layer.src).toBe('still.png');
    expect(layer.opacity).toBe(0.5);
    expect(layer.z).toBe(10);
    expect(layer.bounds).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
    expect(layer.motion!.space).toBe('3d');
  });

  it('drops the still outside its window, motion or not', () => {
    const motion = motionFromPreset('ken-burns')!;
    expect(buildImageLayersAt([still({ cameraMotion: motion })], 0)).toHaveLength(0);
    expect(buildImageLayersAt([still({ cameraMotion: motion })], 99)).toHaveLength(0);
  });
});
