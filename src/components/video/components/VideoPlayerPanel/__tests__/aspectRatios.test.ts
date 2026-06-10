/**
 * aspectRatios — pure config + helpers extracted from VideoPlayerPanel (D10, S4).
 */

import { describe, it, expect } from 'vitest';
import { buildAspectRatios, aspectRatioToNumber } from '../aspectRatios';

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
