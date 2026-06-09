/**
 * Tests for TimelineItem.resize INV-3 strong constraint (spec 01 §2.1 / §2.6 / §6 #3).
 *
 * Resize is a TRIM of the source interval, not a stretch: after any resize,
 * `duration === clipEnd - clipStart` must hold exactly, and the trim must
 * never read past [0, originalDuration].
 */

import { describe, it, expect } from 'vitest';
import { TimelineItem } from '../TimelineItem';
import { TimePosition } from '../../value-objects/TimePosition';
import type { TimelineItemData } from '../../types';

function clip(overrides: Partial<TimelineItemData> = {}): TimelineItem {
  return TimelineItem.fromPlainObject({
    id: 'c', name: 'c', type: 'video', startTime: 10, duration: 6,
    trackId: 'video-track-1', color: '#4A90D9',
    clipStart: 2, clipEnd: 8, originalDuration: 12, volume: 1, opacity: 1,
    ...overrides,
  });
}

describe('TimelineItem.resize — INV-3 (duration == clipEnd - clipStart)', () => {
  it('end-edge trim shrinks duration and clipEnd in lock-step', () => {
    const item = clip();
    item.resize('end', TimePosition.create(13)); // new end at 13 → duration 3
    expect(item.duration.value).toBe(3);
    expect(item.clipStart!.value).toBe(2);
    expect(item.clipEnd!.value).toBe(5);
    expect(item.duration.value).toBeCloseTo(item.clipEnd!.value - item.clipStart!.value, 9);
  });

  it('start-edge trim shifts startTime and clipStart in lock-step', () => {
    const item = clip();
    item.resize('start', TimePosition.create(12)); // start +2 → clipStart 4, duration 4
    expect(item.startTime.value).toBe(12);
    expect(item.clipStart!.value).toBe(4);
    expect(item.clipEnd!.value).toBe(8);
    expect(item.duration.value).toBe(4);
    expect(item.duration.value).toBeCloseTo(item.clipEnd!.value - item.clipStart!.value, 9);
  });

  it('end-edge trim clamps clipEnd to originalDuration', () => {
    const item = clip({ clipStart: 2, clipEnd: 8, originalDuration: 10, duration: 6 });
    // Try to extend the end far past the source — clipEnd caps at originalDuration 10.
    item.resize('end', TimePosition.create(20));
    expect(item.clipEnd!.value).toBe(10);
    expect(item.duration.value).toBeCloseTo(item.clipEnd!.value - item.clipStart!.value, 9);
  });

  it('start-edge trim never drives clipStart below 0', () => {
    const item = clip({ clipStart: 1, clipEnd: 8, originalDuration: 12, startTime: 10, duration: 7 });
    item.resize('start', TimePosition.create(8)); // would push clipStart to -1 → clamps at 0
    expect(item.clipStart!.value).toBe(0);
    expect(item.duration.value).toBeCloseTo(item.clipEnd!.value - item.clipStart!.value, 9);
  });

  it('falls back to edge-derived duration when no clip info is present', () => {
    const item = TimelineItem.fromPlainObject({
      id: 'c', name: 'c', type: 'video', startTime: 10, duration: 6,
      trackId: 'video-track-1', color: '#4A90D9', volume: 1, opacity: 1,
    });
    item.resize('end', TimePosition.create(14));
    expect(item.duration.value).toBe(4);
  });
});
