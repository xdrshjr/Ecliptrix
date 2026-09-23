/**
 * Canvas fit in the preview compositor (spec
 * segment-centric-editor-workbench-r2 §3.9.2).
 *
 * `contain` (and a layer without `fit`) must draw exactly as before; `cover`
 * clips to the frame and draws the enlarged rect; `blur` paints a filtered
 * background, resets the filter, then draws the contain picture.
 */

import { describe, expect, it, vi } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';
import type { CompositorLayer } from '../types';

function makeMockCanvas(width: number, height: number) {
  const filters: string[] = [];
  const ctx = {
    drawImage: vi.fn(() => filters.push(ctx.filter)),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillStyle: '#000',
    globalAlpha: 1,
    filter: 'none',
  };
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:'),
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx, filters };
}

const PORTRAIT = {
  readyState: 4, videoWidth: 1080, videoHeight: 1920,
} as unknown as HTMLVideoElement;

function render(fit?: 'contain' | 'cover' | 'blur') {
  const mock = makeMockCanvas(1920, 1080);
  const compositor = new CanvasCompositor(() => 0);
  compositor.attach(mock.canvas, { aspectRatio: 16 / 9 });
  const layer: CompositorLayer = {
    kind: 'video', id: 'v', source: PORTRAIT, opacity: 1, z: 0,
    ...(fit ? { fit } : {}),
  };
  compositor.renderFrame([layer]);
  return mock;
}

function drawRects(ctx: ReturnType<typeof makeMockCanvas>['ctx']) {
  return ctx.drawImage.mock.calls.map((call: unknown[]) => call.slice(1));
}

describe('CanvasCompositor — canvas fit', () => {
  it('draws contain exactly like a layer without fit', () => {
    const plain = render();
    const contain = render('contain');

    expect(drawRects(contain.ctx)).toEqual(drawRects(plain.ctx));
    expect(contain.ctx.clip).not.toHaveBeenCalled();
    expect(drawRects(plain.ctx)).toEqual([[656.25, 0, 607.5, 1080]]);
  });

  it('clips cover to the frame and draws the enlarged rect', () => {
    const { ctx } = render('cover');

    expect(ctx.rect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    expect(ctx.clip).toHaveBeenCalledTimes(1);
    const [[x, y, width, height]] = drawRects(ctx) as number[][];
    expect(x).toBeCloseTo(0);
    expect(width).toBeCloseTo(1920);
    expect(height).toBeCloseTo(3413.33, 1);
    expect(y).toBeCloseTo(-1166.67, 1);
  });

  it('paints a blurred background, resets the filter, then the contain picture', () => {
    const { ctx, filters } = render('blur');

    expect(filters).toEqual(['blur(20px) brightness(0.6)', 'none']);
    expect(ctx.filter).toBe('none');
    const rects = drawRects(ctx);
    expect(rects[1]).toEqual([656.25, 0, 607.5, 1080]);
    const [bgX, , bgWidth] = rects[0] as number[];
    expect(bgWidth).toBeGreaterThanOrEqual(1920);
    expect(bgX).toBeLessThanOrEqual(0);
  });
});
