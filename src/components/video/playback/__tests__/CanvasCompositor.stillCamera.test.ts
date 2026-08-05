/**
 * CanvasCompositor — still camera draw path (camera-motion-stills §9.1).
 *
 * The still path reuses the video path's routine verbatim; what is genuinely
 * different, and therefore what this file pins, is the RECT it acts on. A video
 * moves inside the fit-rect; a still moves inside its own contain rect within
 * its position box, and the clip has to match — a rolled still that spills out
 * of its box lands on top of whatever is next to it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';
import { resolveCameraDraw } from '../camera/resolveCameraDraw';
import { applyPreset, emptyCameraMotion } from '../camera/cameraPresets';
import { _clearCameraConstantsCache } from '../camera/cameraGeometry';
import type { CompositorLayer } from '../types';

const CANVAS_W = 1920;
const CANVAS_H = 1080;

/** 1600x1200 (4:3) inside a full-canvas 16:9 box → a 1440x1080 contain rect. */
const NAT_W = 1600;
const NAT_H = 1200;
const CONTENT_W = (CANVAS_H * NAT_W) / NAT_H; // 1440
const CONTENT_H = CANVAS_H;
const CONTENT_X = (CANVAS_W - CONTENT_W) / 2;

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

type StubCtx = ReturnType<typeof makeCtx>;

function attach(compositor: CanvasCompositor, ctx: StubCtx): void {
  const canvas = {
    width: CANVAS_W,
    height: CANVAS_H,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  compositor.attach(canvas);
}

/** Seed the compositor's image cache so no real decode is needed. */
function seedImage(
  compositor: CanvasCompositor,
  src: string,
  naturalWidth = NAT_W,
  naturalHeight = NAT_H,
): void {
  const img = {
    complete: true,
    naturalWidth,
    naturalHeight,
  } as unknown as HTMLImageElement;
  (compositor as unknown as { _imageCache: Map<string, HTMLImageElement> })._imageCache.set(src, img);
}

/**
 * Hand out fake `<canvas>` elements so the down-sample branch is observable.
 * jsdom has no 2D backend, so a real `getContext('2d')` returns null and the
 * texture would silently come back as "not built" — testing nothing.
 */
function stubCanvasFactory(): { canvases: HTMLCanvasElement[]; restore: () => void } {
  const canvases: HTMLCanvasElement[] = [];
  const original = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation(((
    tagName: string,
    ...rest: unknown[]
  ) => {
    if (tagName !== 'canvas') {
      return (original as (t: string, ...r: unknown[]) => HTMLElement)(tagName, ...rest);
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => makeCtx(),
    } as unknown as HTMLCanvasElement;
    canvases.push(canvas);
    return canvas;
  }) as typeof document.createElement);
  return { canvases, restore: () => spy.mockRestore() };
}

function imageLayer(cameraInput?: CompositorLayer extends never ? never : unknown): CompositorLayer {
  return {
    kind: 'image',
    id: 'img-1',
    src: 'still.png',
    bounds: { x: 0, y: 0, w: 1, h: 1 },
    opacity: 1,
    z: 100,
    ...(cameraInput ? { cameraInput } : {}),
  } as CompositorLayer;
}

function lastCall(mock: { mock: { calls: unknown[][] } }): number[] {
  const { calls } = mock.mock;
  return calls[calls.length - 1] as unknown as number[];
}

function render(cameraInput?: unknown): { ctx: StubCtx; compositor: CanvasCompositor } {
  const ctx = makeCtx();
  const compositor = new CanvasCompositor(() => 0);
  attach(compositor, ctx);
  seedImage(compositor, 'still.png');
  compositor.renderFrame([imageLayer(cameraInput)]);
  return { ctx, compositor };
}

describe('CanvasCompositor — still camera draw', () => {
  beforeEach(() => {
    _clearCameraConstantsCache();
  });

  it('keeps the plain contain draw when there is no motion (zero regression)', () => {
    const { ctx } = render(undefined);
    const call = lastCall(ctx.drawImage);
    expect(call).toHaveLength(5);
    expect(ctx.clip).not.toHaveBeenCalled();
  });

  it('falls back to the contain draw when the motion resolves to nothing', () => {
    // The layer normally filters identity out before it gets here; if one slips
    // through, the compositor must take the fast path, not crash.
    const { ctx } = render({ motion: emptyCameraMotion('2d'), tLocal: 2, clipDuration: 6 });
    expect(lastCall(ctx.drawImage)).toHaveLength(5);
  });

  it('honours a static non-default framing (pull-out at intensity 0)', () => {
    // Not identity: it holds a 1.25x crop for the whole clip. Exporting the
    // un-cropped frame here would contradict what the panel showed.
    const { ctx } = render({
      motion: { ...applyPreset('pull-out', '2d'), intensity: 0 },
      tLocal: 2,
      clipDuration: 6,
    });
    const call = lastCall(ctx.drawImage);
    expect(call).toHaveLength(9);
    expect(call[3]).toBeCloseTo(NAT_W / 1.25, 4);
  });

  it('crops the SOURCE by the resolved rect against the image aspect (D15)', () => {
    const motion = { ...applyPreset('push-in', '2d'), easing: 'linear' as const };
    const { ctx } = render({ motion, tLocal: 6, clipDuration: 6 });
    const camera = resolveCameraDraw(motion, 6, 6, NAT_W / NAT_H)!;

    const call = lastCall(ctx.drawImage);
    expect(call).toHaveLength(9);
    const [, sx, sy, sw, sh] = call;
    expect(sx).toBeCloseTo(camera.crop.x * NAT_W, 4);
    expect(sy).toBeCloseTo(camera.crop.y * NAT_H, 4);
    expect(sw).toBeCloseTo(camera.crop.w * NAT_W, 4);
    expect(sh).toBeCloseTo(camera.crop.h * NAT_H, 4);
  });

  it('clips to the CONTENT rect, not the whole fit-rect', () => {
    const motion = { ...applyPreset('push-in', '2d'), easing: 'linear' as const };
    const { ctx } = render({ motion, tLocal: 3, clipDuration: 6 });

    expect(ctx.clip).toHaveBeenCalled();
    const [x, y, w, h] = lastCall(ctx.rect);
    expect(w).toBeCloseTo(CONTENT_W, 4);
    expect(h).toBeCloseTo(CONTENT_H, 4);
    expect(x).toBeCloseTo(CONTENT_X, 4);
    expect(y).toBeCloseTo(0, 4);
    // The pillarboxed columns either side stay untouched — that is where the
    // neighbouring layers live.
    expect(w).toBeLessThan(CANVAS_W);
  });

  it('magnifies the destination by rollPad, concentric with the content rect', () => {
    const motion = { ...applyPreset('roll-slight', '2d'), easing: 'linear' as const };
    const { ctx } = render({ motion, tLocal: 0, clipDuration: 6 });
    const camera = resolveCameraDraw(motion, 0, 6, NAT_W / NAT_H)!;
    expect(camera.rollPad).toBeGreaterThan(1);

    const [, , , , , dx, dy, dw, dh] = lastCall(ctx.drawImage);
    expect(dw).toBeCloseTo(CONTENT_W * camera.rollPad, 3);
    expect(dh).toBeCloseTo(CONTENT_H * camera.rollPad, 3);
    expect(dx + dw / 2).toBeCloseTo(CONTENT_X + CONTENT_W / 2, 3);
    expect(dy + dh / 2).toBeCloseTo(CONTENT_H / 2, 3);
    expect(ctx.rotate).toHaveBeenCalled();
  });

  it('does not build a down-sampled texture for a small image (D19)', () => {
    const { compositor } = render({
      motion: applyPreset('push-in', '2d'), tLocal: 1, clipDuration: 6,
    });
    const cache = (compositor as unknown as {
      _stillTextureCache: Map<string, HTMLCanvasElement | null>;
    })._stillTextureCache;
    // 1600px natural vs a 1440px content rect: 2x headroom already covers it,
    // so the original is used directly and nothing extra is allocated.
    expect(cache.get('still.png')).toBeNull();
  });

  it('down-samples a huge still and crops against the TEXTURE (D19)', () => {
    // The branch that gives D19 its reason to exist: an 8000x6000 original is
    // ~48 megapixels of upload per frame. Down-sampling is only equivalent
    // because the crop rect is NORMALIZED — pin that, or a later "optimization"
    // can pass the texture while still scaling by the natural size and skew
    // every still on the timeline by ~2.8x.
    const { canvases, restore } = stubCanvasFactory();
    try {
      const ctx = makeCtx();
      const compositor = new CanvasCompositor(() => 0);
      attach(compositor, ctx);
      seedImage(compositor, 'huge.png', 8000, 6000);

      const motion = { ...applyPreset('push-in', '2d'), easing: 'linear' as const };
      const layer = { ...imageLayer({ motion, tLocal: 6, clipDuration: 6 }), src: 'huge.png' };
      compositor.renderFrame([layer as CompositorLayer]);

      // 2 x the 1440px content rect, rounded up to even — same 4:3 aspect.
      expect(canvases).toHaveLength(1);
      expect(canvases[0].width).toBe(2880);
      expect(canvases[0].height).toBe(2160);

      const camera = resolveCameraDraw(motion, 6, 6, 8000 / 6000)!;
      const call = lastCall(ctx.drawImage);
      expect(call).toHaveLength(9);
      expect(call[0]).toBe(canvases[0]);
      const [, sx, sy, sw, sh] = call;
      expect(sx).toBeCloseTo(camera.crop.x * 2880, 4);
      expect(sy).toBeCloseTo(camera.crop.y * 2160, 4);
      expect(sw).toBeCloseTo(camera.crop.w * 2880, 4);
      expect(sh).toBeCloseTo(camera.crop.h * 2160, 4);

      // Second frame reuses it: one allocation for the compositor's life.
      compositor.renderFrame([layer as CompositorLayer]);
      expect(canvases).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('never touches the texture cache for a still without motion', () => {
    const { compositor } = render(undefined);
    const cache = (compositor as unknown as {
      _stillTextureCache: Map<string, HTMLCanvasElement | null>;
    })._stillTextureCache;
    expect(cache.size).toBe(0);
  });
});
