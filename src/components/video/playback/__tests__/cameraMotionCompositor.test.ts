/**
 * Camera motion through the preview pipeline — assembly + compositor.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §7.5.
 *
 * Scope note (R-P1-9): jsdom has no WebGL and its `drawImage` is a stub, so the
 * 3D branch can only be verified NEGATIVELY here — that an unavailable context
 * degrades to the 2D affine shadow, still paints, and never throws. Whether the
 * GL path draws the right pixels is settled by the FFmpeg-vs-homography marker
 * check and the desktop walkthrough. Mocking a GL context to "prove" the render
 * would be a green test that verifies nothing.
 */

import { describe, expect, it } from 'vitest';
import { buildVideoLayers } from '../internal/assembleLayers';
import { CanvasCompositor } from '../CanvasCompositor';
import { motionFromPreset } from '../cameraMotionPresets';
import type { ActiveVideoEntry } from '../internal/assembleLayers';
import type { CompositorLayer } from '../types';
import type { VideoSequenceItem } from '../../types';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

function clip(overrides: Partial<VideoSequenceItem> = {}): VideoSequenceItem {
  return {
    id: 'clip-1',
    name: 'clip',
    url: 'blob:test',
    startTime: 0,
    duration: 6,
    trackId: 'track-1',
    ...overrides,
  } as VideoSequenceItem;
}

function entry(overrides: Partial<ActiveVideoEntry> = {}): ActiveVideoEntry {
  return {
    trackId: 'track-1',
    z: 0,
    source: { readyState: 4 },
    clip: clip(),
    ...overrides,
  };
}

/** Records the 2D-context calls the compositor makes, without a real canvas. */
function makeFakeContext() {
  return {
    calls: [] as string[],
    transformArgs: [] as number[][],
    setTransformArgs: [] as number[][],
    globalAlpha: 1,
    fillStyle: '',
    imageSmoothingQuality: 'high',
    save() {
      this.calls.push('save');
    },
    restore() {
      this.calls.push('restore');
    },
    transform(...args: number[]) {
      this.calls.push('transform');
      this.transformArgs.push(args);
    },
    setTransform(...args: number[]) {
      this.calls.push('setTransform');
      this.setTransformArgs.push(args);
    },
    fillRect() {
      this.calls.push('fillRect');
    },
    drawImage() {
      this.calls.push('drawImage');
    },
    beginPath() {},
    rect() {},
    clip() {},
    measureText() {
      return { width: 10 };
    },
    fillText() {},
    strokeText() {},
  };
}

function attachCompositor() {
  const ctx = makeFakeContext();
  const canvas = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  const compositor = new CanvasCompositor(() => 0);
  compositor.attach(canvas);
  return { compositor, ctx };
}

function makeVideoLayer(
  overrides: Partial<Extract<CompositorLayer, { kind: 'video' }>> = {},
): Extract<CompositorLayer, { kind: 'video' }> {
  const source = {
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
  } as unknown as HTMLVideoElement;
  return { kind: 'video', id: 'track-1', source, opacity: 1, z: 0, ...overrides };
}

describe('buildVideoLayers — the TIME stage only (R-P0-1)', () => {
  it('attaches a scalar motion state and no pixel geometry', () => {
    const motion = motionFromPreset('zoom-in')!;
    const [layer] = buildVideoLayers([entry({ clip: clip({ cameraMotion: motion }) })], 3, 16 / 9);

    expect(layer.motion).toBeDefined();
    expect(layer.motion?.space).toBe('2d');
    expect(typeof layer.motion?.state.scale).toBe('number');
    // The pure assembler must not leak pixel concepts: it has no canvas size and
    // no intrinsic video size to compute them from.
    expect(layer.motion).not.toHaveProperty('quad');
    expect(layer.motion).not.toHaveProperty('transform');
    expect(layer.motion).not.toHaveProperty('homography');
  });

  it('omits `motion` entirely for a clip without one', () => {
    const [layer] = buildVideoLayers([entry()], 3, 16 / 9);
    expect(layer.motion).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(layer, 'motion')).toBe(false);
  });

  it('advances the state with composition time', () => {
    const motion = motionFromPreset('zoom-in')!;
    const entries = [entry({ clip: clip({ cameraMotion: motion }) })];
    const start = buildVideoLayers(entries, 0, 16 / 9)[0].motion!.state.scale;
    const end = buildVideoLayers(entries, 6, 16 / 9)[0].motion!.state.scale;
    expect(end).toBeGreaterThan(start);
  });

  it('still folds transition alpha into opacity alongside a motion', () => {
    const motion = motionFromPreset('zoom-in')!;
    const [layer] = buildVideoLayers(
      [
        entry({
          clip: clip({ cameraMotion: motion, transitionIn: { type: 'fade', duration: 2 } }),
        }),
      ],
      0.5,
      16 / 9,
    );
    expect(layer.opacity).toBeGreaterThan(0);
    expect(layer.opacity).toBeLessThan(1);
  });
});

describe('CanvasCompositor._drawVideoLayer — the PIXEL stage', () => {
  it('leaves the draw path untouched when there is no motion (M5)', () => {
    const { compositor, ctx } = attachCompositor();
    compositor.renderFrame([makeVideoLayer()]);
    expect(ctx.calls).toContain('drawImage');
    expect(ctx.calls).not.toContain('transform');
    expect(ctx.calls).not.toContain('setTransform');
  });

  it('composes a 2D motion with `transform`, never `setTransform`', () => {
    // `setTransform` REPLACES the base transform. It happens to be harmless on
    // the main compositor (which sets none) but silently drops the DPR scale on
    // the panel's mini previews — so the multiply form is the only correct one.
    const { compositor, ctx } = attachCompositor();
    const motion = motionFromPreset('zoom-in')!;
    compositor.renderFrame([
      makeVideoLayer({
        motion: { space: '2d', state: { ...motion.to, yaw: 0, pitch: 0, dolly: 1 } },
      }),
    ]);
    expect(ctx.calls).toContain('transform');
    expect(ctx.calls).not.toContain('setTransform');
    expect(ctx.calls).toContain('drawImage');

    const [a, b, c, d] = ctx.transformArgs[0];
    expect(a).toBeCloseTo(1.25, 6);
    expect(d).toBeCloseTo(1.25, 6);
    expect(b).toBeCloseTo(0, 9);
    expect(c).toBeCloseTo(0, 9);
  });

  it('degrades a 3D motion to the affine shadow when WebGL is unavailable', () => {
    // jsdom returns null for getContext('webgl'). The layer must still paint —
    // this repo has a history of black-screen regressions, so "no GL" can never
    // mean "no frame" (L6).
    const { compositor, ctx } = attachCompositor();
    const motion = motionFromPreset('orbit-left')!;
    expect(() =>
      compositor.renderFrame([makeVideoLayer({ motion: { space: '3d', state: motion.from } })]),
    ).not.toThrow();

    expect(ctx.calls).toContain('drawImage');
    expect(ctx.calls).toContain('transform');
    expect(compositor.getStats().drawnFrames).toBe(1);
    expect(compositor.getStats().droppedFrames).toBe(0);
  });

  it('keeps a lower track visible under an upper clip that has a motion', () => {
    const { compositor, ctx } = attachCompositor();
    const motion = motionFromPreset('orbit-left')!;
    compositor.renderFrame([
      makeVideoLayer({ id: 'lower', z: 0 }),
      makeVideoLayer({ id: 'upper', z: 1, motion: { space: '3d', state: motion.from } }),
    ]);
    const drawCount = ctx.calls.filter((call) => call === 'drawImage').length;
    expect(drawCount).toBe(2);
  });

  it('reports the frame as dropped when the source is not ready, motion or not', () => {
    const { compositor } = attachCompositor();
    const notReady = { readyState: 0, videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement;
    const motion = motionFromPreset('zoom-in')!;
    compositor.renderFrame([
      makeVideoLayer({ source: notReady, motion: { space: '2d', state: motion.from } }),
    ]);
    expect(compositor.getStats().drawnFrames).toBe(0);
    expect(compositor.getStats().droppedFrames).toBe(1);
  });

  it('releases the perspective renderer on detach', () => {
    const { compositor } = attachCompositor();
    const motion = motionFromPreset('orbit-left')!;
    compositor.renderFrame([makeVideoLayer({ motion: { space: '3d', state: motion.from } })]);
    expect(() => compositor.detach()).not.toThrow();
  });
});
