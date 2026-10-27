import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_WINDOW_TOKENS, contextLevel, contextRatio, idleReading,
  ratioPercent, type ContextUsageReading,
} from '../contextUsage';

const reading = (usedTokens: number, patch: Partial<ContextUsageReading> = {}): ContextUsageReading => ({
  usedTokens, windowTokens: 10_000, maxOutputTokens: 1_000, dropped: false, ...patch,
});

describe('contextRatio', () => {
  it('uses window minus output reservation minus the safety margin as the denominator', () => {
    // capacity = 10000 - 1000 - 2048 = 6952
    expect(contextRatio(reading(6952))).toBeCloseTo(1, 5);
    expect(contextRatio(reading(3476))).toBeCloseTo(0.5, 5);
  });

  it('treats a window that cannot hold the reservation as full', () => {
    expect(contextRatio(reading(1, { windowTokens: 2_000 }))).toBe(1);
  });
});

describe('contextLevel', () => {
  it.each([
    [0.1, 'ok'], [0.59, 'ok'], [0.6, 'notice'], [0.79, 'notice'], [0.8, 'warn'], [1.4, 'warn'],
  ] as const)('ratio %s is %s', (ratio, level) => {
    expect(contextLevel(ratio, false)).toBe(level);
  });

  it('a dropped request is a warning whatever the ratio', () => {
    expect(contextLevel(0.1, true)).toBe('dropped');
  });
});

describe('ratioPercent', () => {
  it('rounds and never exceeds 100', () => {
    expect(ratioPercent(0.724)).toBe(72);
    expect(ratioPercent(3)).toBe(100);
  });
});

describe('idleReading', () => {
  it('falls back to default model limits before any server reading', () => {
    expect(idleReading(500, null)).toEqual({
      usedTokens: 500, windowTokens: DEFAULT_WINDOW_TOKENS,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS, dropped: false,
    });
  });

  it('takes the model limits from the last server reading', () => {
    expect(idleReading(500, reading(100))).toMatchObject({ windowTokens: 10_000, maxOutputTokens: 1_000 });
  });

  it('the larger of estimate and server count wins (the server count also covers the system prompt)', () => {
    expect(idleReading(500, reading(900)).usedTokens).toBe(900);
    expect(idleReading(900, reading(500)).usedTokens).toBe(900);
  });
});
