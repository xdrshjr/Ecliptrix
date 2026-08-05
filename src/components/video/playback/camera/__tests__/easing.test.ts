/**
 * Camera motion — progress / easing / window solve (spec §9.1).
 */

import { describe, it, expect } from 'vitest';
import {
  ease,
  easedProgressAt,
  keyframeAt,
  progressAt,
  resolveWindow,
} from '../easing';
import { MIN_WINDOW, type CameraMotion } from '../types';

function motion(overrides: Partial<CameraMotion> = {}): CameraMotion {
  return {
    version: 1,
    mode: '2d',
    presetId: 'custom',
    intensity: 1,
    easing: 'linear',
    start: { scale: 1, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
    end: { scale: 2, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
    ...overrides,
  };
}

describe('ease', () => {
  it('pins both endpoints for every curve', () => {
    (['linear', 'easeIn', 'easeOut', 'easeInOut'] as const).forEach((curve) => {
      expect(ease(0, curve)).toBeCloseTo(0, 10);
      expect(ease(1, curve)).toBeCloseTo(1, 10);
    });
  });

  it('matches the spec formulas at the midpoint', () => {
    expect(ease(0.5, 'linear')).toBeCloseTo(0.5, 10);
    expect(ease(0.5, 'easeIn')).toBeCloseTo(0.125, 10);
    expect(ease(0.5, 'easeOut')).toBeCloseTo(0.875, 10);
    expect(ease(0.5, 'easeInOut')).toBeCloseTo(0.5, 10);
  });

  it('clamps out-of-range progress instead of extrapolating', () => {
    expect(ease(-1, 'linear')).toBe(0);
    expect(ease(2, 'linear')).toBe(1);
  });
});

describe('resolveWindow', () => {
  it('defaults to the whole clip', () => {
    expect(resolveWindow({}, 6)).toEqual({ start: 0, duration: 6 });
  });

  it('keeps a negative startOffset — a split clip resumes mid-window', () => {
    expect(resolveWindow({ startOffset: -2, duration: 6 }, 4)).toEqual({ start: -2, duration: 6 });
  });

  it('produces no NaN when startOffset reaches the clip end (P2-3)', () => {
    const { start, duration } = resolveWindow({ startOffset: 6 }, 6);
    expect(Number.isFinite(start)).toBe(true);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThanOrEqual(MIN_WINDOW);
  });

  it('does NOT clip an explicit window to the clip length', () => {
    // A window longer than its clip is what a split produces: the left half
    // keeps the original window and therefore plays only part of the motion
    // (§4.6 / P1-5). Clamping here would replay the whole motion in the
    // shorter span — exactly the jump the rebase prevents.
    expect(resolveWindow({ startOffset: 0, duration: 6 }, 2).duration).toBe(6);
    expect(progressAt({ startOffset: 0, duration: 6 }, 2, 2)).toBeCloseTo(1 / 3, 10);
  });
});

describe('progressAt', () => {
  it('holds at 0 before the window and 1 after it', () => {
    const m = motion({ startOffset: 1, duration: 2 });
    expect(progressAt(m, 0, 6)).toBe(0);
    expect(progressAt(m, 0.5, 6)).toBe(0);
    expect(progressAt(m, 2, 6)).toBeCloseTo(0.5, 10);
    expect(progressAt(m, 3, 6)).toBe(1);
    expect(progressAt(m, 5.9, 6)).toBe(1);
  });

  it('starts a negative-offset window part-way through', () => {
    // The right half of a 6s clip split at t=2: the window opened 2s earlier.
    const m = motion({ startOffset: -2, duration: 6 });
    expect(progressAt(m, 0, 4)).toBeCloseTo(2 / 6, 10);
  });
});

describe('keyframeAt', () => {
  it('interpolates then clamps, component-wise', () => {
    const m = motion();
    expect(keyframeAt(m, 0).scale).toBeCloseTo(1, 10);
    expect(keyframeAt(m, 0.5).scale).toBeCloseTo(1.5, 10);
    expect(keyframeAt(m, 1).scale).toBeCloseTo(2, 10);
  });

  it('parks a component on its bound rather than skewing the trajectory', () => {
    // start 1.25 → end 1 at intensity 2 undershoots the scale floor mid-window.
    const m = motion({
      intensity: 2,
      start: { scale: 1.25, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
      end: { scale: 1, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
    });
    expect(keyframeAt(m, 1).scale).toBe(1);
  });

  it('holds the start keyframe when intensity is 0', () => {
    const m = motion({
      intensity: 0,
      start: { scale: 1.25, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
    });
    expect(keyframeAt(m, 1).scale).toBeCloseTo(1.25, 10);
  });
});

describe('easedProgressAt', () => {
  it('composes the window solve with the easing curve', () => {
    const m = motion({ easing: 'easeIn', startOffset: 0, duration: 4 });
    expect(easedProgressAt(m, 2, 4)).toBeCloseTo(0.125, 10);
  });
});
