/**
 * aspectRatioToSize — exact pixel outputs for the five supported ratios.
 *
 * The 1080-px short-side rule is the canonical contract — all five sizes
 * must hold simultaneously: 16:9 → 1920×1080, 9:16 → 1080×1920, 1:1 →
 * 1080×1080, 4:3 → 1440×1080, 21:9 → 2520×1080.
 */

import { describe, it, expect } from 'vitest';

import { aspectRatioToSize } from '../utils/aspectRatioToSize';

describe('aspectRatioToSize', () => {
  it('16:9 → 1920×1080', () => {
    expect(aspectRatioToSize('16:9')).toEqual({ width: 1920, height: 1080 });
  });

  it('9:16 → 1080×1920', () => {
    expect(aspectRatioToSize('9:16')).toEqual({ width: 1080, height: 1920 });
  });

  it('1:1 → 1080×1080', () => {
    expect(aspectRatioToSize('1:1')).toEqual({ width: 1080, height: 1080 });
  });

  it('4:3 → 1440×1080', () => {
    expect(aspectRatioToSize('4:3')).toEqual({ width: 1440, height: 1080 });
  });

  it('21:9 → 2520×1080', () => {
    expect(aspectRatioToSize('21:9')).toEqual({ width: 2520, height: 1080 });
  });
});
