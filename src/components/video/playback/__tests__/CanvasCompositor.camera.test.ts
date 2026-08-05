/**
 * CanvasCompositor — camera-motion draw path (spec §9.1 "合成器").
 *
 * Asserts the D13 contract at the level that actually matters: the 9-argument
 * `drawImage` call, the clip() that keeps the overflow off the neighbours, and
 * the `rollPad`-magnified destination rect concentric with the fit-rect. Also
 * pins the zero-regression case — no motion is still a 5-argument call.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';
import { resolveCameraDraw } from '../camera/resolveCameraDraw';
import { applyPreset } from '../camera/cameraPresets';
import { _clearCameraConstantsCache } from '../camera/cameraGeometry';
import type { CompositorLayer } from '../types';
import type { ResolvedCameraDraw } from '../camera/types';

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const ASPECT = 16 / 9;

interface StubCtx {
  drawImage: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  globalAlpha: number;
  fillStyle: string;
  imageSmoothingQuality: string;
}

function makeCtx(): StubCtx {
  return {
    drawImage: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    fillRect: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
    imageSmoothingQuality: '',
  };
}

function attach(compositor: CanvasCompositor, ctx: StubCtx): void {
  const canvas = {
    width: CANVAS_W,
    height: CANVAS_H,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  compositor.attach(canvas);
}

function videoSource(): HTMLVideoElement {
  return { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement;
}

/** The tsconfig target predates Array.prototype.at — index explicitly. */
function lastCall(mock: { mock: { calls: unknown[][] } }): number[] {
  const { calls } = mock.mock;
  return calls[calls.length - 1] as unknown as number[];
}

function videoLayer(camera?: ResolvedCameraDraw): CompositorLayer {
  return {
    kind: 'video',
    id: 'video-1',
    source: videoSource(),
    opacity: 1,
    z: 0,
    camera,
  } as CompositorLayer;
}

describe('CanvasCompositor — camera draw path', () => {
  beforeEach(() => {
    _clearCameraConstantsCache();
  });

  it('takes the legacy 5-arg path when there is no motion (zero regression)', () => {
    const ctx = makeCtx();
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor, ctx);
    compositor.renderFrame([videoLayer(undefined)]);

    const call = lastCall(ctx.drawImage);
    expect(call).toHaveLength(5);
    expect(ctx.clip).not.toHaveBeenCalled();
  });

  it('uses a 9-arg crop draw with the resolved source rect', () => {
    const ctx = makeCtx();
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor, ctx);

    const motion = { ...applyPreset('push-in', '2d'), easing: 'linear' as const };
    const camera = resolveCameraDraw(motion, 5, 5, ASPECT)!;
    compositor.renderFrame([videoLayer(camera)]);

    const call = lastCall(ctx.drawImage);
    expect(call).toHaveLength(9);
    const [, sx, sy, sw, sh] = call;
    expect(sx).toBeCloseTo(camera.crop.x * 1920, 6);
    expect(sy).toBeCloseTo(camera.crop.y * 1080, 6);
    expect(sw).toBeCloseTo(camera.crop.w * 1920, 6);
    expect(sh).toBeCloseTo(camera.crop.h * 1080, 6);
    expect(ctx.clip).toHaveBeenCalled();
  });

  it('magnifies the DESTINATION rect by rollPad, concentric with the fit-rect', () => {
    const ctx = makeCtx();
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor, ctx);

    const motion = { ...applyPreset('roll-slight', '2d'), easing: 'linear' as const };
    const camera = resolveCameraDraw(motion, 0, 5, ASPECT)!;
    expect(camera.rollPad).toBeGreaterThan(1);
    compositor.renderFrame([videoLayer(camera)]);

    const [, , , , , dx, dy, dw, dh] = lastCall(ctx.drawImage);
    expect(dw).toBeCloseTo(CANVAS_W * camera.rollPad, 4);
    expect(dh).toBeCloseTo(CANVAS_H * camera.rollPad, 4);
    // Concentric with the fit-rect (which is the full canvas at 16:9).
    expect(dx + dw / 2).toBeCloseTo(CANVAS_W / 2, 4);
    expect(dy + dh / 2).toBeCloseTo(CANVAS_H / 2, 4);
    expect(ctx.rotate).toHaveBeenCalled();
  });

  it('does not rotate when roll is 0', () => {
    const ctx = makeCtx();
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor, ctx);
    const camera = resolveCameraDraw(applyPreset('push-in', '2d'), 5, 5, ASPECT)!;
    compositor.renderFrame([videoLayer(camera)]);
    expect(ctx.rotate).not.toHaveBeenCalled();
  });

  it('keeps the layer opacity — motion must not swallow transitions', () => {
    const ctx = makeCtx();
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor, ctx);
    const camera = resolveCameraDraw(applyPreset('push-in', '2d'), 5, 5, ASPECT)!;
    const layer = { ...(videoLayer(camera) as Record<string, unknown>), opacity: 0.25 } as CompositorLayer;
    compositor.renderFrame([layer]);
    expect(ctx.globalAlpha).toBeCloseTo(0.25, 6);
  });

  it('falls back to a 2D crop when a 3D frame cannot use WebGL (jsdom)', () => {
    const ctx = makeCtx();
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor, ctx);
    const camera = resolveCameraDraw(applyPreset('orbit-left', '3d'), 2.5, 5, ASPECT)!;
    expect(camera.mode).toBe('3d');
    compositor.renderFrame([videoLayer(camera)]);
    // jsdom has no WebGL, so the renderer reports unavailable and we degrade.
    const call = lastCall(ctx.drawImage);
    expect(call).toHaveLength(9);
    expect(compositor.camera3DDegraded()).toBe(true);
  });
});
