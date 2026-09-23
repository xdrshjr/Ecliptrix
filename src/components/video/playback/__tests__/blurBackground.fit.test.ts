/**
 * BlurBackgroundPainter (spec segment-centric-editor-workbench-r2 §3.9.2,
 * RV2-19 / IF-FIT-9): the per-window cost sample is logged once, an
 * over-budget window switches the painter to the 1/4 offscreen path for good,
 * and the filter is always reset after a draw.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlurBackgroundPainter, BLUR_BUDGET_MS } from '../internal/blurBackground';

const FRAME = { x: 0, y: 0, width: 1920, height: 1080 };
const COVER = { x: 0, y: -1167, width: 1920, height: 3413 };

function fakeContext() {
  const filters: string[] = [];
  const ctx = {
    filter: 'none',
    drawImage: vi.fn(() => { filters.push(ctx.filter); }),
    clearRect: vi.fn(),
  };
  return { ctx, filters };
}

function fakeScratch() {
  const { ctx } = fakeContext();
  return { width: 0, height: 0, getContext: () => ctx, ctx };
}

/** A clock where every paint costs `costMs`. */
function steppingClock(costMs: number): () => number {
  let now = 0;
  let isStart = true;
  return () => {
    if (!isStart) now += costMs;
    isStart = !isStart;
    return now;
  };
}

function paintTimes(painter: BlurBackgroundPainter, ctx: unknown, count: number) {
  for (let i = 0; i < count; i += 1) {
    painter.paint(
      ctx as CanvasRenderingContext2D,
      {} as CanvasImageSource,
      COVER,
      FRAME,
    );
  }
}

describe('BlurBackgroundPainter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws with the blur filter and resets it to none', () => {
    const { ctx, filters } = fakeContext();
    const painter = new BlurBackgroundPainter(steppingClock(0), () => null);

    paintTimes(painter, ctx, 1);

    expect(filters).toEqual(['blur(20px) brightness(0.6)']);
    expect(ctx.filter).toBe('none');
  });

  it('logs the first cost window once while under budget', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { ctx } = fakeContext();
    const painter = new BlurBackgroundPainter(steppingClock(1), () => null);

    paintTimes(painter, ctx, 90);

    expect(info).toHaveBeenCalledTimes(1);
    expect(painter.isDownscaled()).toBe(false);
  });

  it('switches to the offscreen downscale once a window is over budget', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { ctx } = fakeContext();
    const scratch = fakeScratch();
    const painter = new BlurBackgroundPainter(
      steppingClock(BLUR_BUDGET_MS + 1),
      () => scratch as unknown as HTMLCanvasElement,
    );

    paintTimes(painter, ctx, 30);
    expect(painter.isDownscaled()).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);

    paintTimes(painter, ctx, 31);
    expect(info).toHaveBeenCalledTimes(1);
    expect(scratch.width).toBe(480);
    expect(scratch.height).toBe(270);
    expect(scratch.ctx.filter).toBe('none');
    expect(ctx.drawImage).toHaveBeenLastCalledWith(scratch, 0, 0, 1920, 1080);
  });

  it('falls back to the direct draw when no offscreen canvas exists', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { ctx, filters } = fakeContext();
    const painter = new BlurBackgroundPainter(
      steppingClock(BLUR_BUDGET_MS + 1),
      () => null,
    );

    paintTimes(painter, ctx, 31);

    expect(painter.isDownscaled()).toBe(true);
    expect(filters[filters.length - 1]).toBe('blur(20px) brightness(0.6)');
  });
});
