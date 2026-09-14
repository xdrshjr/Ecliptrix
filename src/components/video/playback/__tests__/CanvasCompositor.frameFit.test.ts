/**
 * PV3-01 / S11 — every preview layer is placed against the output frame, and a
 * video is contained in that frame by its OWN aspect ratio (export pads, it
 * never stretches).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';

function makeMockCanvas(width: number, height: number) {
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '#000',
    globalAlpha: 1,
    imageSmoothingQuality: 'high',
  };
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:'),
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

class LoadedImage {
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = true;
  naturalWidth = 400;
  naturalHeight = 400;
  src = '';
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CanvasCompositor — output frame fit (PV3-01)', () => {
  it('draws a portrait source pillarboxed inside a 16:9 output frame', () => {
    const { canvas, ctx } = makeMockCanvas(1600, 900);
    const compositor = new CanvasCompositor(() => 0);
    compositor.attach(canvas, { aspectRatio: 16 / 9 });
    const source = { readyState: 4, videoWidth: 1080, videoHeight: 1920 } as unknown as HTMLVideoElement;

    compositor.renderFrame([{ kind: 'video', id: 'v', source, opacity: 1, z: 0 }]);

    const [, x, y, width, height] = ctx.drawImage.mock.calls[0];
    expect({ x, y, width, height }).toEqual({
      x: expect.closeTo(546.875, 3),
      y: expect.closeTo(0, 6),
      width: expect.closeTo(506.25, 3),
      height: expect.closeTo(900, 6),
    });
  });

  it('positions image layers against the output frame when no video layer is ready', () => {
    vi.stubGlobal('Image', LoadedImage);
    // 1600×1200 canvas, 16:9 project → output frame y = 150, height = 900.
    const { canvas, ctx } = makeMockCanvas(1600, 1200);
    const compositor = new CanvasCompositor(() => 0);
    compositor.attach(canvas, { aspectRatio: 16 / 9 });
    const unready = { readyState: 1, videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement;

    compositor.renderFrame([
      { kind: 'video', id: 'v', source: unready, opacity: 1, z: 0 },
      { kind: 'image', id: 'i', src: '/img.png', bounds: { x: 0, y: 0, w: 0.5, h: 0.5 }, opacity: 1, z: 1 },
    ]);

    const [, x, y, width, height] = ctx.drawImage.mock.calls[0];
    // Square image contained in the 800×450 box at the frame origin.
    expect({ x, y, width, height }).toEqual({ x: 175, y: 150, width: 450, height: 450 });
  });
});
