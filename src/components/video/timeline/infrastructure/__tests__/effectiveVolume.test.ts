/**
 * effectiveVolume — EX-01 unified volume rule (T22).
 *
 * Pins the one formula preview and export share: item × track%, clamped to
 * the backend's `le=2`, with a 0% track silent and garbage input defaulted.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_EFFECTIVE_VOLUME,
  computeEffectiveVolume,
} from '../effectiveVolume';

describe('computeEffectiveVolume', () => {
  it('clamps item x track volume to 2', () => {
    // AI mixed editing default: item 2.0 on a 200% track → 4.0 unclamped.
    expect(computeEffectiveVolume(2, 200)).toBe(MAX_EFFECTIVE_VOLUME);
  });

  it('treats a 0% track as silent', () => {
    expect(computeEffectiveVolume(1.5, 0)).toBe(0);
  });

  it('falls back to defaults for non-finite input', () => {
    expect([
      computeEffectiveVolume(undefined, undefined),
      computeEffectiveVolume(Number.NaN, Number.POSITIVE_INFINITY),
    ]).toEqual([1, 1]);
  });

  it('multiplies item volume by the track percentage inside the range', () => {
    expect(computeEffectiveVolume(0.5, 150)).toBeCloseTo(0.75);
  });

  it('never returns a negative volume', () => {
    expect(computeEffectiveVolume(-1, 100)).toBe(0);
  });
});
