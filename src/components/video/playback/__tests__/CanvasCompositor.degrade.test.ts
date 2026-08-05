/**
 * CanvasCompositor — the 3D degrade signal (camera-motion-stills §4.3.5 / D20).
 *
 * Two properties, both about restraint:
 *   1. it fires ONCE. The flag is set inside the draw hot path, so a per-frame
 *      notification would turn a diagnostic into a setState storm;
 *   2. it fires for BOTH causes. "No WebGL" is what a static probe can see;
 *      "the projection degenerated mid-motion" is what it cannot, and that one
 *      happens on machines with perfectly good WebGL (A26b).
 */

import { describe, it, expect, vi } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';
import type { CompositorLayer } from '../types';
import type { ResolvedCameraDraw } from '../camera/types';

const CANVAS_W = 1920;
const CANVAS_H = 1080;

function makeCtx() {
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

function attach(compositor: CanvasCompositor) {
  const ctx = makeCtx();
  const canvas = {
    width: CANVAS_W,
    height: CANVAS_H,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  compositor.attach(canvas);
  return ctx;
}

function videoLayer(camera: ResolvedCameraDraw): CompositorLayer {
  return {
    kind: 'video',
    id: 'video-1',
    source: { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement,
    opacity: 1,
    z: 0,
    camera,
  } as CompositorLayer;
}

/** A 3D draw the math kernel already marked degenerate (no WebGL involved). */
const DEGENERATE_3D: ResolvedCameraDraw = {
  mode: '3d',
  crop: { x: 0, y: 0, w: 1, h: 1 },
  roll: 0,
  rollPad: 1,
  degraded: true,
};

/** A 3D draw with a real quad — reaches the WebGL renderer first. */
const WEBGL_3D: ResolvedCameraDraw = {
  mode: '3d',
  crop: { x: 0, y: 0, w: 1, h: 1 },
  roll: 0,
  rollPad: 1,
  quad: {
    pts: [
      { x: 0, y: 0, q: 1 },
      { x: 1, y: 0, q: 1 },
      { x: 0, y: 1, q: 1 },
      { x: 1, y: 1, q: 1 },
    ],
  },
};

describe('CanvasCompositor — 3D degrade notification', () => {
  it('fires once no matter how many frames degrade', () => {
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor);
    const onDegrade = vi.fn();
    compositor.onCamera3DDegrade(onDegrade);

    for (let i = 0; i < 30; i += 1) {
      compositor.renderFrame([videoLayer(DEGENERATE_3D)]);
    }

    expect(onDegrade).toHaveBeenCalledTimes(1);
    expect(compositor.camera3DDegraded()).toBe(true);
  });

  it('covers the run-time projection degrade a static probe cannot see (A26b)', () => {
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor);
    const onDegrade = vi.fn();
    compositor.onCamera3DDegrade(onDegrade);

    // `degraded: true` comes from the math kernel — a corner behind the camera.
    // No WebGL call is involved, and `Camera3DRenderer.isSupported()` would
    // happily report "3D is fine" on this machine.
    compositor.renderFrame([videoLayer(DEGENERATE_3D)]);
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });

  it('covers the WebGL-unusable path too', () => {
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor);
    const onDegrade = vi.fn();
    compositor.onCamera3DDegrade(onDegrade);

    // jsdom has no WebGL, so `_ensureCamera3DRenderer` yields no usable renderer
    // and the draw falls back to the 2D approximation.
    compositor.renderFrame([videoLayer(WEBGL_3D)]);
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });

  it('stays silent for 2D motion', () => {
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor);
    const onDegrade = vi.fn();
    compositor.onCamera3DDegrade(onDegrade);

    compositor.renderFrame([
      videoLayer({ mode: '2d', crop: { x: 0, y: 0, w: 1, h: 1 }, roll: 0, rollPad: 1 }),
    ]);

    expect(onDegrade).not.toHaveBeenCalled();
    expect(compositor.camera3DDegraded()).toBe(false);
  });

  it('can fire again after detach (a fresh engine is a fresh verdict)', () => {
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor);
    const onDegrade = vi.fn();
    compositor.onCamera3DDegrade(onDegrade);
    compositor.renderFrame([videoLayer(DEGENERATE_3D)]);
    expect(onDegrade).toHaveBeenCalledTimes(1);

    compositor.detach();
    expect(compositor.camera3DDegraded()).toBe(false);

    attach(compositor);
    compositor.onCamera3DDegrade(onDegrade);
    compositor.renderFrame([videoLayer(DEGENERATE_3D)]);
    expect(onDegrade).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes cleanly', () => {
    const compositor = new CanvasCompositor(() => 0);
    attach(compositor);
    const onDegrade = vi.fn();
    const unsubscribe = compositor.onCamera3DDegrade(onDegrade);
    unsubscribe();

    compositor.renderFrame([videoLayer(DEGENERATE_3D)]);

    expect(onDegrade).not.toHaveBeenCalled();
    // The flag itself still records what happened — only the push is detached.
    expect(compositor.camera3DDegraded()).toBe(true);
  });
});
