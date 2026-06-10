/**
 * TransitionLayer — spec 02 §2.4 / §6 #5.
 *
 * Pure unit tests for fade-in / fade-out / cross-dissolve alpha curves.
 * Outside any transition window alpha is 1; inside, it ramps linearly.
 */

import { describe, it, expect } from 'vitest';
import { alphaFor, TransitionLayer, type TransitionClip } from '../TransitionLayer';

function clip(over: Partial<TransitionClip> = {}): TransitionClip {
  return { startTime: 0, duration: 10, ...over };
}

describe('TransitionLayer.alphaFor', () => {
  it('returns 1 in the clip body when there are no transitions', () => {
    expect(alphaFor(clip(), 5)).toBe(1);
    expect(alphaFor(clip(), 0)).toBe(1);
    expect(alphaFor(clip(), 10)).toBe(1);
  });

  it('returns 0 outside the clip', () => {
    expect(alphaFor(clip({ startTime: 2, duration: 4 }), 1)).toBe(0);
    expect(alphaFor(clip({ startTime: 2, duration: 4 }), 7)).toBe(0);
  });

  it('ramps 0→1 across a fade-in window', () => {
    const c = clip({ startTime: 0, duration: 10, transitionIn: { type: 'fade', duration: 2 } });
    expect(alphaFor(c, 0)).toBeCloseTo(0, 5);
    expect(alphaFor(c, 1)).toBeCloseTo(0.5, 5);
    expect(alphaFor(c, 2)).toBeCloseTo(1, 5);
    expect(alphaFor(c, 5)).toBe(1); // body
  });

  it('ramps 1→0 across a fade-out window', () => {
    const c = clip({ startTime: 0, duration: 10, transitionOut: { type: 'fade', duration: 2 } });
    expect(alphaFor(c, 8)).toBeCloseTo(1, 5);
    expect(alphaFor(c, 9)).toBeCloseTo(0.5, 5);
    expect(alphaFor(c, 10)).toBeCloseTo(0, 5);
  });

  it('combines fade-in and fade-out on the same clip without exceeding 1 in the middle', () => {
    const c = clip({
      startTime: 0,
      duration: 10,
      transitionIn: { type: 'fade', duration: 2 },
      transitionOut: { type: 'fade', duration: 2 },
    });
    expect(alphaFor(c, 1)).toBeCloseTo(0.5, 5);
    expect(alphaFor(c, 5)).toBe(1);
    expect(alphaFor(c, 9)).toBeCloseTo(0.5, 5);
  });

  it('clamps fade durations to half the clip so they never cross over', () => {
    // duration 4, fade-in 10 → clamped to 2. At t=2 (midpoint) alpha hits 1.
    const c = clip({
      startTime: 0,
      duration: 4,
      transitionIn: { type: 'dissolve', duration: 10 },
    });
    expect(alphaFor(c, 2)).toBeCloseTo(1, 5);
    expect(alphaFor(c, 1)).toBeCloseTo(0.5, 5);
  });

  it('models a cross-dissolve as overlapping out/in alphas summing visually', () => {
    // prev clip [0,4] fading out over last 2s; next clip [2,6] fading in over
    // first 2s. In the [2,4] overlap, the two alphas are complementary.
    const prev = clip({ startTime: 0, duration: 4, transitionOut: { type: 'dissolve', duration: 2 } });
    const next = clip({ startTime: 2, duration: 4, transitionIn: { type: 'dissolve', duration: 2 } });
    const t = 3;
    const aPrev = alphaFor(prev, t);
    const aNext = alphaFor(next, t);
    expect(aPrev).toBeCloseTo(0.5, 5);
    expect(aNext).toBeCloseTo(0.5, 5);
    expect(aPrev + aNext).toBeCloseTo(1, 5);
  });

  it('facade delegates to the pure function', () => {
    const layer = new TransitionLayer();
    const c = clip({ transitionIn: { type: 'fade', duration: 2 } });
    expect(layer.alphaFor(c, 1)).toBeCloseTo(0.5, 5);
  });
});
