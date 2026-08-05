/**
 * The PIXEL stage for stills — the half that has to match FFmpeg.
 *
 * Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §3.2 / §3.4 / §7.5-25.
 *
 * Scope note (R5, unchanged from Iteration 1): jsdom has no WebGL and its
 * `drawImage` is a stub, so the 3D branch can only be verified NEGATIVELY here —
 * that an unavailable context degrades to the affine shadow, still paints, and
 * never throws. What the GPU actually rasterises is settled by N2 and the
 * desktop walkthrough. Mocking a GL context to "prove" the render would be a
 * green test that verifies nothing.
 *
 * What CAN be pinned here is the geometry handed to the draw calls, which is
 * where the export divergences live:
 *   - the transform is built around the still's BOX, not the canvas;
 *   - the image is contained into the box FIRST and the box transformed after
 *     (getting that backwards diverges from export by an amount that grows with
 *     the pan — L4);
 *   - drawing is clipped to the box, matching scheme A's box-sized `perspective`;
 *   - a still with no motion still takes the byte-identical legacy path (N4-②).
 */

import { describe, expect, it } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';
import { motionFromPreset } from '../cameraMotionPresets';
import { cameraBoxHomography, affineFrom } from '../CameraMotionLayer';
import type { CompositorLayer } from '../types';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/** Records the 2D-context calls and their arguments, without a real canvas. */
function makeFakeContext() {
  return {
    calls: [] as string[],
    transformArgs: [] as number[][],
    drawImageArgs: [] as unknown[][],
    clipRects: [] as number[][],
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
    setTransform() {
      this.calls.push('setTransform');
    },
    fillRect() {
      this.calls.push('fillRect');
    },
    drawImage(...args: unknown[]) {
      this.calls.push('drawImage');
      this.drawImageArgs.push(args);
    },
    beginPath() {
      this.calls.push('beginPath');
    },
    rect(...args: number[]) {
      this.calls.push('rect');
      this.clipRects.push(args);
    },
    clip() {
      this.calls.push('clip');
    },
    measureText() {
      return { width: 10 };
    },
    fillText() {},
  };
}

/** A decoded 4:3 image, seeded straight into the compositor's cache. */
function fakeImage(width = 800, height = 600) {
  return { complete: true, naturalWidth: width, naturalHeight: height, src: 'still.png' };
}

function attach(image = fakeImage()) {
  const ctx = makeFakeContext();
  const canvas = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  const compositor = new CanvasCompositor(() => 0);
  compositor.attach(canvas);
  // `_loadImage` would create a never-loading `<img>` in jsdom; seeding the
  // cache is what lets the draw path run at all.
  (compositor as unknown as { _imageCache: Map<string, unknown> })._imageCache.set(
    'still.png',
    image,
  );
  return { compositor, ctx };
}

function imageLayer(
  overrides: Partial<Extract<CompositorLayer, { kind: 'image' }>> = {},
): Extract<CompositorLayer, { kind: 'image' }> {
  return {
    kind: 'image',
    id: 'still-1',
    src: 'still.png',
    // 1920x1080 canvas => a 960x270 box at (192, 216).
    bounds: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 },
    opacity: 1,
    z: 10,
    ...overrides,
  };
}

const BOX = { x: 0.1 * CANVAS_WIDTH, y: 0.2 * CANVAS_HEIGHT, width: 0.5 * CANVAS_WIDTH, height: 0.25 * CANVAS_HEIGHT };

describe('CanvasCompositor._drawImageLayer — no motion', () => {
  it('takes the legacy path untouched (N4-②)', () => {
    const { compositor, ctx } = attach();
    compositor.renderFrame([imageLayer()]);

    expect(ctx.calls).toContain('drawImage');
    expect(ctx.calls).not.toContain('transform');
    expect(ctx.calls).not.toContain('clip');
    // Contain-fit in CANVAS coordinates, exactly as before.
    const [, x, y, w, h] = ctx.drawImageArgs[0] as [unknown, number, number, number, number];
    expect(w).toBeCloseTo(BOX.height * (800 / 600), 6);
    expect(h).toBeCloseTo(BOX.height, 6);
    expect(x).toBeCloseTo(BOX.x + (BOX.width - w) / 2, 6);
    expect(y).toBeCloseTo(BOX.y, 6);
  });
});

describe('CanvasCompositor._drawImageLayer — 2D motion', () => {
  it('transforms the BOX, then paints the contain rect box-locally', () => {
    const motion = motionFromPreset('ken-burns')!;
    const state = { ...motion.to };
    const { compositor, ctx } = attach();
    compositor.renderFrame([imageLayer({ motion: { space: '2d', state } })]);

    expect(ctx.calls).toContain('transform');
    expect(ctx.calls).toContain('drawImage');

    // 1) The transform is the box homography — NOT the canvas one.
    const expected = affineFrom(cameraBoxHomography(state, BOX));
    ctx.transformArgs[0].forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index], 6);
    });

    // 2) The painted rect is contained in BOX-LOCAL space (origin 0,0). Getting
    //    this backwards is invisible when the box and image ratios match and
    //    diverges from export by the whole letterbox gap when they do not.
    const [, x, y, w, h] = ctx.drawImageArgs[0] as [unknown, number, number, number, number];
    expect(h).toBeCloseTo(BOX.height, 6);
    expect(w).toBeCloseTo(BOX.height * (800 / 600), 6);
    expect(x).toBeCloseTo((BOX.width - w) / 2, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it('clips to the box, matching scheme A on the export side (§3.4)', () => {
    const motion = motionFromPreset('ken-burns')!;
    const { compositor, ctx } = attach();
    compositor.renderFrame([imageLayer({ motion: { space: '2d', state: motion.to } })]);

    expect(ctx.calls).toContain('clip');
    expect(ctx.clipRects[0]).toEqual([BOX.x, BOX.y, BOX.width, BOX.height]);
    // The clip is applied BEFORE the transform, i.e. in canvas space.
    expect(ctx.calls.indexOf('clip')).toBeLessThan(ctx.calls.indexOf('transform'));
  });

  it('composes with `transform`, never `setTransform`', () => {
    const motion = motionFromPreset('zoom-in')!;
    const { compositor, ctx } = attach();
    compositor.renderFrame([imageLayer({ motion: { space: '2d', state: motion.to } })]);
    expect(ctx.calls).not.toContain('setTransform');
  });

  it('paints the still exactly once', () => {
    const motion = motionFromPreset('zoom-in')!;
    const { compositor, ctx } = attach();
    compositor.renderFrame([imageLayer({ motion: { space: '2d', state: motion.to } })]);
    expect(ctx.drawImageArgs).toHaveLength(1);
  });
});

describe('CanvasCompositor._drawImageLayer — 3D motion without WebGL', () => {
  it('degrades to the affine shadow and still paints (L6)', () => {
    // jsdom returns null for getContext('webgl'). "No GL" can never mean "no
    // frame": this repo has a history of black-screen regressions.
    const motion = motionFromPreset('orbit-left')!;
    const { compositor, ctx } = attach();
    expect(() =>
      compositor.renderFrame([imageLayer({ motion: { space: '3d', state: motion.from } })]),
    ).not.toThrow();

    expect(ctx.calls).toContain('drawImage');
    expect(ctx.calls).toContain('transform');
    expect(compositor.getStats().drawnFrames).toBe(1);
    expect(compositor.getStats().droppedFrames).toBe(0);
  });

  it('keeps a lower video track visible beneath a moving still', () => {
    const motion = motionFromPreset('orbit-left')!;
    const { compositor, ctx } = attach();
    const source = {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;
    compositor.renderFrame([
      { kind: 'video', id: 'track-1', source, opacity: 1, z: 0 },
      imageLayer({ motion: { space: '3d', state: motion.from } }),
    ]);
    expect(ctx.drawImageArgs).toHaveLength(2);
  });

  it('drops the layer cleanly when the image has not decoded yet', () => {
    const { compositor } = attach({ complete: false, naturalWidth: 0, naturalHeight: 0, src: 'still.png' });
    const motion = motionFromPreset('ken-burns')!;
    compositor.renderFrame([imageLayer({ motion: { space: '2d', state: motion.to } })]);
    expect(compositor.getStats().drawnFrames).toBe(0);
  });

  it('releases its raster + GL state on detach', () => {
    const motion = motionFromPreset('orbit-left')!;
    const { compositor } = attach();
    compositor.renderFrame([imageLayer({ motion: { space: '3d', state: motion.from } })]);
    expect(() => compositor.detach()).not.toThrow();
  });
});
