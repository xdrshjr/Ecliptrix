/**
 * ImageOverlayLayer — spec 02 §2.2 / §3.
 *
 * Pure unit tests: active-at-time selection (incl. epsilon boundaries) and
 * normalized bounds / effective opacity computation against the canvas
 * fit-rect. No DOM — this is the DATA layer; the draw is the compositor's.
 */

import { describe, it, expect } from 'vitest';
import {
  ImageOverlayLayer,
  activeImageItemsAt,
  computeImageBounds,
  effectiveImageOpacity,
  buildImageLayersAt,
  type ImageOverlayInput,
  type FitRect,
} from '../ImageOverlayLayer';
import { TIME_EPSILON } from '../../timeline/domain/services/ClipTimeMapping';

function img(
  id: string,
  startTime: number,
  duration: number,
  over: Partial<ImageOverlayInput> = {},
): ImageOverlayInput {
  return {
    id,
    src: `/api/storage/files/images/${id}.png`,
    startTime,
    duration,
    position: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, zIndex: 5 },
    ...over,
  };
}

describe('activeImageItemsAt', () => {
  it('selects items whose half-open interval covers t', () => {
    const items = [img('a', 0, 4), img('b', 4, 4)];
    expect(activeImageItemsAt(items, 2).map(i => i.id)).toEqual(['a']);
    // boundary 4.0 belongs to b (half-open trailing edge for a).
    expect(activeImageItemsAt(items, 4).map(i => i.id)).toEqual(['b']);
  });

  it('returns multiple overlapping active items (image tracks may overlap)', () => {
    const items = [img('a', 0, 10), img('b', 2, 3)];
    expect(activeImageItemsAt(items, 3).map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('does not select an item before its start (epsilon honored)', () => {
    const items = [img('a', 10, 5)];
    expect(activeImageItemsAt(items, 10 - TIME_EPSILON / 2).map(i => i.id)).toEqual(['a']);
    expect(activeImageItemsAt(items, 10 - TIME_EPSILON * 2)).toEqual([]);
  });

  it('does not leak one frame past the trailing edge (epsilon honored)', () => {
    const items = [img('a', 0, 5)];
    // exact end 5.0 → no longer active (half-open).
    expect(activeImageItemsAt(items, 5)).toEqual([]);
    // just inside the trailing edge → still active.
    expect(activeImageItemsAt(items, 5 - TIME_EPSILON * 2).map(i => i.id)).toEqual(['a']);
  });

  it('returns empty for a time in a gap', () => {
    const items = [img('a', 0, 2), img('b', 5, 2)];
    expect(activeImageItemsAt(items, 3)).toEqual([]);
  });
});

describe('computeImageBounds', () => {
  it('passes a normalized position through against the full canvas (identity)', () => {
    const bounds = computeImageBounds({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    expect(bounds).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it('projects the position into a sub fit-rect (letterboxed video area)', () => {
    const fit: FitRect = { x: 0.1, y: 0.0, w: 0.8, h: 1.0 };
    // x = 0.1 + 0.5*0.8 = 0.5 ; w = 0.25 * 0.8 = 0.2
    const bounds = computeImageBounds({ x: 0.5, y: 0.25, width: 0.25, height: 0.5 }, fit);
    expect(bounds.x).toBeCloseTo(0.5, 6);
    expect(bounds.w).toBeCloseTo(0.2, 6);
    expect(bounds.y).toBeCloseTo(0.25, 6);
    expect(bounds.h).toBeCloseTo(0.5, 6);
  });

  it('clamps out-of-range positions into [0,1] and limits w/h to the remaining space', () => {
    const bounds = computeImageBounds({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 });
    expect(bounds.x).toBe(0.9);
    expect(bounds.y).toBe(0.9);
    // x + w must not exceed 1.
    expect(bounds.w).toBeCloseTo(0.1, 6);
    expect(bounds.h).toBeCloseTo(0.1, 6);
  });

  it('applies the centered-80% default position when none is supplied (D1)', () => {
    const bounds = computeImageBounds(undefined);
    expect(bounds).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  });
});

describe('effectiveImageOpacity', () => {
  it('defaults to fully opaque when absent', () => {
    expect(effectiveImageOpacity(undefined)).toBe(1);
    expect(effectiveImageOpacity(null)).toBe(1);
  });

  it('clamps to [0,1]', () => {
    expect(effectiveImageOpacity(0.5)).toBe(0.5);
    expect(effectiveImageOpacity(-1)).toBe(0);
    expect(effectiveImageOpacity(2)).toBe(1);
  });
});

describe('buildImageLayersAt', () => {
  it('builds image compositor layers for active items with bounds + opacity + z', () => {
    const items = [
      img('a', 0, 10, { opacity: 0.5, position: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, zIndex: 3 } }),
      img('b', 0, 10, { position: { x: 0, y: 0, width: 0.5, height: 0.5, zIndex: 7 } }),
    ];
    const layers = buildImageLayersAt(items, 5);
    expect(layers).toHaveLength(2);
    const a = layers.find(l => l.id === 'a')!;
    expect(a.kind).toBe('image');
    expect(a.bounds).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(a.opacity).toBe(0.5);
    expect(a.z).toBe(3);
    expect(layers.find(l => l.id === 'b')!.z).toBe(7);
  });

  it('drops items with empty src or zero area', () => {
    const items = [
      img('nosrc', 0, 10, { src: '' }),
      img('zero', 0, 10, { position: { x: 0.5, y: 0.5, width: 0, height: 0.3 } }),
      img('ok', 0, 10),
    ];
    const layers = buildImageLayersAt(items, 5);
    expect(layers.map(l => l.id)).toEqual(['ok']);
  });

  it('uses the export default zIndex 10 when absent and clamps out-of-range values', () => {
    // Input order among equal zIndex is added by assembleLayers, not here.
    const items = [
      img('a', 0, 10, { position: { x: 0, y: 0, width: 0.2, height: 0.2 } }),
      img('b', 0, 10, { position: { x: 0.2, y: 0.2, width: 0.2, height: 0.2, zIndex: 4000 } }),
      img('c', 0, 10, { position: { x: 0.4, y: 0.4, width: 0.2, height: 0.2, zIndex: -3 } }),
    ];
    const layers = buildImageLayersAt(items, 5);
    expect(layers.map(l => [l.id, l.z])).toEqual([['a', 10], ['b', 999], ['c', 0]]);
  });
});

describe('ImageOverlayLayer facade', () => {
  it('delegates to the pure functions', () => {
    const layer = new ImageOverlayLayer();
    const items = [img('a', 0, 4)];
    expect(layer.activeAt(items, 2).map(i => i.id)).toEqual(['a']);
    expect(layer.buildLayers(items, 2)[0].id).toBe('a');
  });
});
