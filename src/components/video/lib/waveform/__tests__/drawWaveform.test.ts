import { describe, it, expect, vi } from 'vitest';
import {
  slicePeaksForClip,
  mapPeaksToColumns,
  drawWaveform,
} from '../drawWaveform';

describe('slicePeaksForClip', () => {
  const peaks = Array.from({ length: 100 }, (_, i) => i / 100); // 10s @ 10pps

  it('returns the whole array when no clip bounds are given', () => {
    expect(slicePeaksForClip(peaks, 10, undefined, undefined)).toEqual(peaks);
  });

  it('slices the [clipStart, clipEnd] interval to the matching peaks subrange', () => {
    // clip=[2,5] at 10 peaks/sec → peaks indices [20, 50)
    const sliced = slicePeaksForClip(peaks, 10, 2, 5);
    expect(sliced).toEqual(peaks.slice(20, 50));
    expect(sliced.length).toBe(30);
  });

  it('clamps clip bounds to the available peaks range', () => {
    const sliced = slicePeaksForClip(peaks, 10, -1, 999);
    expect(sliced).toEqual(peaks);
  });

  it('returns an empty array for an inverted/zero-length clip', () => {
    expect(slicePeaksForClip(peaks, 10, 5, 5)).toEqual([]);
    expect(slicePeaksForClip(peaks, 10, 6, 4)).toEqual([]);
  });

  it('returns the input unchanged when peaksPerSecond is non-positive', () => {
    expect(slicePeaksForClip(peaks, 0, 2, 5)).toEqual(peaks);
  });
});

describe('mapPeaksToColumns', () => {
  it('takes the max within each column when downsampling', () => {
    const peaks = [0.1, 0.9, 0.2, 0.3, 0.8, 0.4];
    // 6 peaks → 3 columns: [0.1,0.9] [0.2,0.3] [0.8,0.4]
    expect(mapPeaksToColumns(peaks, 3)).toEqual([0.9, 0.3, 0.8]);
  });

  it('upsamples by repeating coverage when columns exceed peaks', () => {
    const peaks = [0.2, 0.8];
    const cols = mapPeaksToColumns(peaks, 4);
    expect(cols).toHaveLength(4);
    // Every column maps into one of the two source peaks.
    expect(cols.every((c) => c === 0.2 || c === 0.8)).toBe(true);
    expect(Math.max(...cols)).toBe(0.8);
  });

  it('returns all-zero columns for an empty peaks array', () => {
    expect(mapPeaksToColumns([], 3)).toEqual([0, 0, 0]);
  });

  it('guards against a non-positive column count', () => {
    expect(mapPeaksToColumns([0.5], 0)).toEqual([]);
  });
});

// Minimal CanvasRenderingContext2D test double.
function makeFakeCtx() {
  return {
    canvas: { width: 200, height: 40 },
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
  };
}

describe('drawWaveform', () => {
  it('clears the canvas and draws one symmetric bar per column from peaks', () => {
    const ctx = makeFakeCtx() as ReturnType<typeof makeFakeCtx>;
    const peaks = Array.from({ length: 50 }, () => 0.5);
    drawWaveform(ctx, peaks, {
      width: 100,
      height: 40,
      peaksPerSecond: 10,
      color: '#fff',
    });
    expect(ctx.clearRect).toHaveBeenCalled();
    // At least one bar drawn (fillRect per column).
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(0);
  });

  it('clip slicing limits the rendered region to the clip interval', () => {
    const ctx = makeFakeCtx() as ReturnType<typeof makeFakeCtx>;
    const peaks = Array.from({ length: 100 }, (_, i) => (i < 50 ? 0 : 1));
    // clip=[5,10] selects the loud second half only → bars should be tall.
    drawWaveform(ctx, peaks, {
      width: 100,
      height: 40,
      peaksPerSecond: 10,
      clipStart: 5,
      clipEnd: 10,
      color: '#fff',
    });
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('degrades to a flat placeholder line for empty peaks (no throw)', () => {
    const ctx = makeFakeCtx() as ReturnType<typeof makeFakeCtx>;
    expect(() =>
      drawWaveform(ctx, [], { width: 100, height: 40, peaksPerSecond: 10 }),
    ).not.toThrow();
    // Placeholder still clears the canvas and draws a baseline.
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('is a no-op (no throw) when the context is null', () => {
    expect(() =>
      drawWaveform(null, [0.5], { width: 100, height: 40, peaksPerSecond: 10 }),
    ).not.toThrow();
  });

  it('never decodes audio — only reads the peaks array', () => {
    // Smoke guard: drawWaveform must not reference any AudioContext global.
    const ctx = makeFakeCtx() as ReturnType<typeof makeFakeCtx>;
    const spy = vi.fn();
    (globalThis as Record<string, unknown>).AudioContext = spy;
    drawWaveform(ctx, [0.3, 0.6, 0.9], {
      width: 60,
      height: 40,
      peaksPerSecond: 10,
    });
    expect(spy).not.toHaveBeenCalled();
    delete (globalThis as Record<string, unknown>).AudioContext;
  });
});
