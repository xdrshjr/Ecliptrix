/**
 * CanvasCompositor._containRect — D2 `object-contain` geometry (spec
 * docs/plans/image-overlay-fit-and-transform/spec.md §4.2 / §8).
 *
 * The image overlay must be drawn inside its bounds box keeping the image's
 * natural aspect ratio (never stretched) and centered in the leftover gap.
 * `_containRect` is the pure geometry behind {@link CanvasCompositor._drawImageLayer};
 * it is exercised directly here (private — accessed via a typed cast) so the
 * contain math is covered without a real GPU / loaded `<img>`.
 */

import { describe, it, expect } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';

interface ContainRect {
  (
    natW: number,
    natH: number,
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
  ): { x: number; y: number; w: number; h: number };
}

/** Private-method accessor — `_containRect` has no DOM/state dependency. */
function containRect(): ContainRect {
  const c = new CanvasCompositor() as unknown as { _containRect: ContainRect };
  return c._containRect.bind(c);
}

/** Assert the rect stays fully inside the box (no overflow on any edge). */
function expectInsideBox(
  rect: { x: number; y: number; w: number; h: number },
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
): void {
  expect(rect.x).toBeGreaterThanOrEqual(boxX - 1e-9);
  expect(rect.y).toBeGreaterThanOrEqual(boxY - 1e-9);
  expect(rect.x + rect.w).toBeLessThanOrEqual(boxX + boxW + 1e-9);
  expect(rect.y + rect.h).toBeLessThanOrEqual(boxY + boxH + 1e-9);
}

describe('CanvasCompositor._containRect', () => {
  it('wide image in a 1:1 box: width fills, height shrinks, vertically centered', () => {
    const rect = containRect()(200, 100, 0, 0, 100, 100);
    expect(rect).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expectInsideBox(rect, 0, 0, 100, 100);
  });

  it('tall image in a 1:1 box: height fills, width shrinks, horizontally centered', () => {
    const rect = containRect()(100, 200, 0, 0, 100, 100);
    expect(rect).toEqual({ x: 25, y: 0, w: 50, h: 100 });
    expectInsideBox(rect, 0, 0, 100, 100);
  });

  it('square image in a 16:9 box: height fills, width centered (pillarbox)', () => {
    const rect = containRect()(100, 100, 0, 0, 160, 90);
    expect(rect.w).toBeCloseTo(90, 6);
    expect(rect.h).toBeCloseTo(90, 6);
    expect(rect.x).toBeCloseTo(35, 6);
    expect(rect.y).toBeCloseTo(0, 6);
    expectInsideBox(rect, 0, 0, 160, 90);
  });

  it('square image in a 9:16 box: width fills, height centered (letterbox)', () => {
    const rect = containRect()(100, 100, 0, 0, 90, 160);
    expect(rect.w).toBeCloseTo(90, 6);
    expect(rect.h).toBeCloseTo(90, 6);
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo(35, 6);
    expectInsideBox(rect, 0, 0, 90, 160);
  });

  it('image ratio == box ratio: contain degenerates to filling the box exactly', () => {
    const rect = containRect()(160, 90, 0, 0, 160, 90);
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo(0, 6);
    expect(rect.w).toBeCloseTo(160, 6);
    expect(rect.h).toBeCloseTo(90, 6);
  });

  it('honors a non-zero box offset (centering is relative to the box origin)', () => {
    const rect = containRect()(200, 100, 10, 20, 100, 100);
    expect(rect).toEqual({ x: 10, y: 45, w: 100, h: 50 });
    expectInsideBox(rect, 10, 20, 100, 100);
  });

  it('falls back to the box itself for degenerate natural/box sizes', () => {
    expect(containRect()(0, 100, 5, 6, 100, 80)).toEqual({ x: 5, y: 6, w: 100, h: 80 });
    expect(containRect()(100, 100, 5, 6, 0, 80)).toEqual({ x: 5, y: 6, w: 0, h: 80 });
  });
});
