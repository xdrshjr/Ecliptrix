import { describe, it, expect } from 'vitest';
import { computeOptimalGrid } from '../gridUtils';

describe('computeOptimalGrid', () => {
  it('returns 1x1 for 0 or 1 frame', () => {
    expect(computeOptimalGrid(0)).toEqual({ rows: 1, cols: 1 });
    expect(computeOptimalGrid(1)).toEqual({ rows: 1, cols: 1 });
  });

  it('returns 2x2 for 4 frames', () => {
    expect(computeOptimalGrid(4)).toEqual({ rows: 2, cols: 2 });
  });

  it('returns 3x3 for 9 frames', () => {
    expect(computeOptimalGrid(9)).toEqual({ rows: 3, cols: 3 });
  });

  it('returns 3x4 for 10 frames (uses 12 cells)', () => {
    expect(computeOptimalGrid(10)).toEqual({ rows: 3, cols: 4 });
  });

  it('returns 8x8 for 64 frames', () => {
    expect(computeOptimalGrid(64)).toEqual({ rows: 8, cols: 8 });
  });

  it('returns 7x8 for 63 frames', () => {
    const { rows, cols } = computeOptimalGrid(63);
    expect(rows).toBe(8);
    expect(cols).toBe(8);
  });
});
