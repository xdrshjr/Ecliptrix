/**
 * aspectRatios — pure config + helpers extracted from VideoPlayerPanel (D10, S4).
 */

import { describe, it, expect } from 'vitest';
import { buildAspectRatios, aspectRatioToNumber, computeContainBox } from '../aspectRatios';

const LABELS = {
  landscapeStandard: 'Landscape',
  portraitMobile: 'Portrait',
  traditionalScreen: 'Traditional',
  square: 'Square',
  ultrawide: 'Ultrawide',
};

describe('buildAspectRatios', () => {
  it('returns the five ratios in order with stable ids/css and injected descriptions', () => {
    const ratios = buildAspectRatios(LABELS);
    expect(ratios.map((r) => r.id)).toEqual(['16:9', '9:16', '4:3', '1:1', '21:9']);
    expect(ratios[0]).toMatchObject({ ratio: '16/9', cssClass: 'aspect-video', description: 'Landscape' });
    expect(ratios[1].cssClass).toBe('aspect-[9/16]');
    expect(ratios[4].description).toBe('Ultrawide');
  });
});

describe('aspectRatioToNumber', () => {
  it('converts a w/h string to its numeric ratio', () => {
    expect(aspectRatioToNumber('16/9')).toBeCloseTo(16 / 9, 6);
    expect(aspectRatioToNumber('1/1')).toBe(1);
  });

  it('returns undefined for malformed / non-positive ratios', () => {
    expect(aspectRatioToNumber('')).toBeUndefined();
    expect(aspectRatioToNumber('16')).toBeUndefined();
    expect(aspectRatioToNumber('0/9')).toBeUndefined();
    expect(aspectRatioToNumber('16/0')).toBeUndefined();
    expect(aspectRatioToNumber('a/b')).toBeUndefined();
  });
});

describe('computeContainBox', () => {
  const RATIOS = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '4:3': 4 / 3,
    '1:1': 1,
    '21:9': 21 / 9,
  };

  it('fills the height (letterboxes width) when the container is wider than the target', () => {
    // 800x600 container (ratio 1.333) is wider than 16:9 (1.778)? No — 1.333 < 1.778,
    // so 16:9 is width-constrained here. Use a clearly wide container instead.
    const box = computeContainBox(1000, 300, RATIOS['16:9']);
    // container ratio 3.33 > 1.778 → height-constrained: height fills, width = h*ratio.
    expect(box).not.toBeNull();
    expect(box!.height).toBeCloseTo(300, 6);
    expect(box!.width).toBeCloseTo(300 * (16 / 9), 6);
    // never overflows the container
    expect(box!.width).toBeLessThanOrEqual(1000);
  });

  it('fills the width (letterboxes height) when the container is narrower than the target', () => {
    const box = computeContainBox(800, 800, RATIOS['16:9']);
    // container ratio 1.0 < 1.778 → width-constrained: width fills, height = w/ratio.
    expect(box!.width).toBeCloseTo(800, 6);
    expect(box!.height).toBeCloseTo(800 / (16 / 9), 6);
    expect(box!.height).toBeLessThanOrEqual(800);
  });

  it('returns the full container for a 1:1 frame in a square container', () => {
    const box = computeContainBox(500, 500, RATIOS['1:1']);
    expect(box).toEqual({ width: 500, height: 500 });
  });

  it('contains every supported ratio inside both wide and tall containers without overflow', () => {
    const containers = [
      { cw: 1280, ch: 400 }, // 宽受限 (very wide)
      { cw: 400, ch: 1280 }, // 高受限 (very tall)
      { cw: 900, ch: 600 },  // moderate landscape
    ];
    for (const r of Object.values(RATIOS)) {
      for (const { cw, ch } of containers) {
        const box = computeContainBox(cw, ch, r)!;
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        // fits inside the container (allow a hair of float slack)
        expect(box.width).toBeLessThanOrEqual(cw + 1e-6);
        expect(box.height).toBeLessThanOrEqual(ch + 1e-6);
        // preserves the requested aspect ratio
        expect(box.width / box.height).toBeCloseTo(r, 6);
        // the long edge touches the container on exactly one axis
        const fillsWidth = Math.abs(box.width - cw) < 1e-6;
        const fillsHeight = Math.abs(box.height - ch) < 1e-6;
        expect(fillsWidth || fillsHeight).toBe(true);
      }
    }
  });

  it('returns null for degenerate inputs so callers fall back to the CSS min-height', () => {
    expect(computeContainBox(0, 600, RATIOS['16:9'])).toBeNull();
    expect(computeContainBox(800, 0, RATIOS['16:9'])).toBeNull();
    expect(computeContainBox(-10, 600, RATIOS['16:9'])).toBeNull();
    expect(computeContainBox(NaN, 600, RATIOS['16:9'])).toBeNull();
    expect(computeContainBox(800, 600, undefined)).toBeNull();
    expect(computeContainBox(800, 600, 0)).toBeNull();
    expect(computeContainBox(800, 600, NaN)).toBeNull();
  });
});
