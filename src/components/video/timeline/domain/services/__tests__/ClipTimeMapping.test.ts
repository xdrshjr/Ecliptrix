/**
 * Tests for ClipTimeMapping — the single clip time-mapping contract.
 *
 * Per spec 01 §2.2 / §6: the pair of pure functions maps timeline time ↔
 * source-media time using clipStart/clipEnd, with TIME_EPSILON edge handling.
 * This is THE shared contract for preview (TODO 02) and export (TODO 05);
 * these tests pin its behaviour so downstream consumers can rely on it.
 */

import { describe, it, expect } from 'vitest';
import {
  TIME_EPSILON,
  mapTimelineTimeToSourceTime,
  mapSourceTimeToTimelineTime,
  type ClipTimeRef,
} from '../ClipTimeMapping';

/** clip=[2,5] placed at start=10, duration=3. */
function trimmedClip(): ClipTimeRef {
  return { startTime: 10, duration: 3, clipStart: 2, clipEnd: 5 };
}

describe('TIME_EPSILON', () => {
  it('is the agreed 0.001 boundary tolerance', () => {
    expect(TIME_EPSILON).toBe(0.001);
  });
});

describe('mapTimelineTimeToSourceTime', () => {
  it('maps timeline 12 to source 4 for clip=[2,5] start=10', () => {
    // local = 12 - 10 = 2; source = clipStart(2) + 2 = 4
    expect(mapTimelineTimeToSourceTime(trimmedClip(), 12)).toBe(4);
  });

  it('maps the clip start to clipStart', () => {
    expect(mapTimelineTimeToSourceTime(trimmedClip(), 10)).toBe(2);
  });

  it('maps the clip end to clipEnd', () => {
    expect(mapTimelineTimeToSourceTime(trimmedClip(), 13)).toBe(5);
  });

  it('clamps timeline time before the clip to clipStart', () => {
    expect(mapTimelineTimeToSourceTime(trimmedClip(), 5)).toBe(2);
  });

  it('clamps timeline time past the clip end to clipEnd', () => {
    expect(mapTimelineTimeToSourceTime(trimmedClip(), 999)).toBe(5);
  });

  it('defaults clipStart to 0 when absent', () => {
    const ref: ClipTimeRef = { startTime: 0, duration: 4 };
    expect(mapTimelineTimeToSourceTime(ref, 1.5)).toBe(1.5);
  });

  it('treats within-epsilon overrun as the exact end (no jitter)', () => {
    // 13 + half-epsilon should still resolve to clipEnd, not overshoot it.
    const v = mapTimelineTimeToSourceTime(trimmedClip(), 13 + TIME_EPSILON / 2);
    expect(v).toBeCloseTo(5, 6);
    expect(v).toBeLessThanOrEqual(5);
  });
});

describe('mapSourceTimeToTimelineTime', () => {
  it('maps source 4 back to timeline 12', () => {
    expect(mapSourceTimeToTimelineTime(trimmedClip(), 4)).toBe(12);
  });

  it('clamps source before clipStart to the clip start', () => {
    expect(mapSourceTimeToTimelineTime(trimmedClip(), 0)).toBe(10);
  });

  it('clamps source past clipEnd to the clip end', () => {
    expect(mapSourceTimeToTimelineTime(trimmedClip(), 999)).toBe(13);
  });
});

describe('round-trip invariant', () => {
  it('source→timeline→source is identity inside the clip', () => {
    const ref = trimmedClip();
    for (const tSource of [2, 2.5, 3.75, 5]) {
      const tTimeline = mapSourceTimeToTimelineTime(ref, tSource);
      const back = mapTimelineTimeToSourceTime(ref, tTimeline);
      expect(back).toBeCloseTo(tSource, 9);
    }
  });

  it('timeline→source→timeline is identity inside the clip', () => {
    const ref = trimmedClip();
    for (const tTimeline of [10, 11.25, 12.5, 13]) {
      const tSource = mapTimelineTimeToSourceTime(ref, tTimeline);
      const back = mapSourceTimeToTimelineTime(ref, tSource);
      expect(back).toBeCloseTo(tTimeline, 9);
    }
  });
});
