/**
 * imageOverlayGeometry — clampImagePosition (D3), alignDefaultBoxToImage (D6)
 * and resizeKeepingAspect (D4), spec
 * docs/plans/image-overlay-fit-and-transform/spec.md §6 / §8.
 *
 * Pure geometry extracted from `<ImageOverlay>` so the clamp-as-single-source,
 * first-frame alignment and equal-ratio resize math are unit-testable without
 * rendering React (the project Vitest config preserves JSX — see spec §10).
 */

import { describe, it, expect } from 'vitest';
import type { ImagePosition } from '@/types';
import {
  clampImagePosition,
  alignDefaultBoxToImage,
  resizeKeepingAspect,
  DEFAULT_IMAGE_POSITION,
  MIN_OVERLAY_SIZE,
} from '../imageOverlayGeometry';

describe('clampImagePosition (D3)', () => {
  it('passes a valid centered-80% position through unchanged', () => {
    const p: ImagePosition = { x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 };
    expect(clampImagePosition(p)).toEqual(p);
  });

  it('clamps width>1 to 1 and pulls x back so x+width<=1 (no reversed interval)', () => {
    const out = clampImagePosition({ x: 0.5, y: 0.2, width: 1.5, height: 0.3 });
    expect(out.width).toBe(1);
    // 1 - width === 0 → x must be 0, never negative.
    expect(out.x).toBe(0);
    expect(out.x + out.width).toBeLessThanOrEqual(1);
  });

  it('limits x/y so the box stays inside the frame (x+width<=1, y+height<=1)', () => {
    const out = clampImagePosition({ x: 0.9, y: 0.95, width: 0.5, height: 0.5 });
    expect(out.x).toBeCloseTo(0.5, 6);
    expect(out.y).toBeCloseTo(0.5, 6);
    expect(out.x + out.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(out.y + out.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('floors invalid (<=0 / NaN) size to a positive minimum and clamps negative offsets to 0', () => {
    const out = clampImagePosition({ x: -0.3, y: 0.1, width: 0, height: Number.NaN });
    expect(out.width).toBe(MIN_OVERLAY_SIZE);
    expect(out.height).toBe(MIN_OVERLAY_SIZE);
    expect(out.x).toBe(0);
  });

  it('preserves zIndex', () => {
    expect(clampImagePosition({ x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 42 }).zIndex).toBe(42);
  });
});

describe('alignDefaultBoxToImage (D6)', () => {
  /** Box pixel aspect = (width*frameW)/(height*frameH) = (width/height)*frameAR. */
  function boxPixelAspect(p: ImagePosition, frameAR: number): number {
    return (p.width / p.height) * frameAR;
  }

  it('returns null for a non-sentinel (user-adjusted / historical) position', () => {
    expect(alignDefaultBoxToImage({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, 1920, 1080, 16 / 9)).toBeNull();
  });

  it('returns null for invalid natural size or frame aspect', () => {
    expect(alignDefaultBoxToImage(DEFAULT_IMAGE_POSITION, 0, 1080, 16 / 9)).toBeNull();
    expect(alignDefaultBoxToImage(DEFAULT_IMAGE_POSITION, 1920, 0, 16 / 9)).toBeNull();
    expect(alignDefaultBoxToImage(DEFAULT_IMAGE_POSITION, 1920, 1080, 0)).toBeNull();
  });

  it('landscape image whose ratio == frame ratio keeps the full centered-80% box', () => {
    const out = alignDefaultBoxToImage(DEFAULT_IMAGE_POSITION, 1920, 1080, 16 / 9)!;
    expect(out.width).toBeCloseTo(0.8, 6);
    expect(out.height).toBeCloseTo(0.8, 6);
    expect(out.x).toBeCloseTo(0.1, 6);
    expect(out.y).toBeCloseTo(0.1, 6);
  });

  it('portrait image in a 16:9 frame: box becomes image-ratio, centered, <=80% each axis', () => {
    const frameAR = 16 / 9;
    const out = alignDefaultBoxToImage(DEFAULT_IMAGE_POSITION, 1080, 1920, frameAR)!;
    // height-limited (taller than wide once normalized).
    expect(out.height).toBeCloseTo(0.8, 6);
    expect(out.width).toBeLessThanOrEqual(0.8 + 1e-9);
    // Centered.
    expect(out.x).toBeCloseTo((1 - out.width) / 2, 6);
    expect(out.y).toBeCloseTo((1 - out.height) / 2, 6);
    // Box pixel aspect now equals the image natural aspect → contain fills the box.
    expect(boxPixelAspect(out, frameAR)).toBeCloseTo(1080 / 1920, 6);
  });

  it('wide image in a square frame: box becomes image-ratio, width-limited, centered', () => {
    const frameAR = 1; // square frame
    const out = alignDefaultBoxToImage(DEFAULT_IMAGE_POSITION, 200, 100, frameAR)!;
    expect(out.width).toBeCloseTo(0.8, 6);
    expect(out.height).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(out.x).toBeCloseTo(0.1, 6);
    expect(out.y).toBeCloseTo((1 - out.height) / 2, 6);
    expect(boxPixelAspect(out, frameAR)).toBeCloseTo(200 / 100, 6);
  });
});

describe('resizeKeepingAspect (D4)', () => {
  it('derives height from width so box pixel ratio == image ratio (square frame)', () => {
    const frameAR = 1;
    const imageAspect = 2; // wide image
    const { width, height } = resizeKeepingAspect(0.6, 0.6, 0.9, 0.9, imageAspect, frameAR);
    expect(width).toBeCloseTo(0.6, 6);
    // height = width * frameAR / aspect = 0.6 * 1 / 2 = 0.3
    expect(height).toBeCloseTo(0.3, 6);
    expect((width / height) * frameAR).toBeCloseTo(imageAspect, 6);
  });

  it('re-derives width from height when the height bound is hit (stays in proportion)', () => {
    const frameAR = 1;
    const imageAspect = 0.5; // tall image → height grows fast
    // rawWidth large; height would exceed maxHeight=0.4 → clamp height, shrink width.
    const { width, height } = resizeKeepingAspect(0.9, 0.9, 0.9, 0.4, imageAspect, frameAR);
    expect(height).toBeCloseTo(0.4, 6);
    // width = height * aspect / frameAR = 0.4 * 0.5 / 1 = 0.2
    expect(width).toBeCloseTo(0.2, 6);
    expect((width / height) * frameAR).toBeCloseTo(imageAspect, 6);
  });

  it('enforces a minimum size along the tighter axis without breaking the ratio', () => {
    const frameAR = 1;
    const imageAspect = 4; // very wide → height tiny relative to width
    // tiny rawWidth → would drive height below the min; min floors the tighter axis.
    const { width, height } = resizeKeepingAspect(0.12, 0.12, 0.9, 0.9, imageAspect, frameAR);
    expect(width).toBeGreaterThanOrEqual(MIN_OVERLAY_SIZE - 1e-9);
    expect(height).toBeGreaterThanOrEqual(MIN_OVERLAY_SIZE - 1e-9);
    expect((width / height) * frameAR).toBeCloseTo(imageAspect, 6);
  });

  it('falls back to free resize when the image aspect is unknown (naturalW/H not ready)', () => {
    const { width, height } = resizeKeepingAspect(0.5, 0.7, 0.9, 0.9, null, 1.5);
    expect(width).toBeCloseTo(0.5, 6);
    expect(height).toBeCloseTo(0.7, 6);
  });

  it('clamps free resize to the available space and minimum', () => {
    const free = resizeKeepingAspect(2, -1, 0.6, 0.6, null, 1);
    expect(free.width).toBeCloseTo(0.6, 6); // capped at maxWidth
    expect(free.height).toBe(MIN_OVERLAY_SIZE); // floored at min
  });
});
