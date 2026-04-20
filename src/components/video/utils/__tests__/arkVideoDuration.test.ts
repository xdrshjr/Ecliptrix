import { describe, it, expect } from 'vitest';
import {
  ARK_DURATION_BUCKETS,
  mapSentenceDurationToArkBucket,
  isArkDurationBucket,
} from '../arkVideoDuration';

describe('mapSentenceDurationToArkBucket', () => {
  it('maps NaN / non-finite to 5 (defensive fallback)', () => {
    expect(mapSentenceDurationToArkBucket(Number.NaN)).toBe(5);
    expect(mapSentenceDurationToArkBucket(Number.POSITIVE_INFINITY)).toBe(5);
    expect(mapSentenceDurationToArkBucket(-Infinity)).toBe(5);
  });

  it('maps ≤ 0 to 5', () => {
    expect(mapSentenceDurationToArkBucket(0)).toBe(5);
    expect(mapSentenceDurationToArkBucket(-1)).toBe(5);
  });

  it('rounds up to the nearest bucket', () => {
    expect(mapSentenceDurationToArkBucket(2.4)).toBe(5);
    expect(mapSentenceDurationToArkBucket(5)).toBe(5);
    expect(mapSentenceDurationToArkBucket(5.01)).toBe(7);
    expect(mapSentenceDurationToArkBucket(7)).toBe(7);
    expect(mapSentenceDurationToArkBucket(7.01)).toBe(10);
    expect(mapSentenceDurationToArkBucket(8.5)).toBe(10);
    expect(mapSentenceDurationToArkBucket(10)).toBe(10);
    expect(mapSentenceDurationToArkBucket(10.01)).toBe(12);
    expect(mapSentenceDurationToArkBucket(11.2)).toBe(12);
    expect(mapSentenceDurationToArkBucket(12)).toBe(12);
  });

  it('caps > 12 at 12', () => {
    expect(mapSentenceDurationToArkBucket(12.01)).toBe(12);
    expect(mapSentenceDurationToArkBucket(15)).toBe(12);
    expect(mapSentenceDurationToArkBucket(100)).toBe(12);
  });
});

describe('isArkDurationBucket', () => {
  it('accepts only the legal buckets', () => {
    for (const b of ARK_DURATION_BUCKETS) {
      expect(isArkDurationBucket(b)).toBe(true);
    }
    expect(isArkDurationBucket(6)).toBe(false);
    expect(isArkDurationBucket(0)).toBe(false);
    expect(isArkDurationBucket(13)).toBe(false);
    expect(isArkDurationBucket(5.5)).toBe(false);
  });
});
