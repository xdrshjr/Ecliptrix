/**
 * Tests for SplitService — the domain one-into-two split (spec 01 §2.3 / §6).
 *
 * Verifies: the canonical worked example, seamless left/right adjacency,
 * end-point / out-of-range no-op, and that both halves satisfy INV-1..INV-3
 * (duration > 0, clip interval ordered & in-bounds, duration == clipEnd-clipStart).
 */

import { describe, it, expect } from 'vitest';
import { Track } from '../../entities/Track';
import { SplitService } from '../SplitService';
import { TIME_EPSILON } from '../ClipTimeMapping';
import type { TimelineItemData } from '../../types';

function videoItem(overrides: Partial<TimelineItemData> = {}): TimelineItemData {
  return {
    id: 'clip-1',
    name: 'clip-1',
    type: 'video',
    startTime: 10,
    duration: 6,
    trackId: 'video-track-1',
    color: '#4A90D9',
    clipStart: 2,
    clipEnd: 8,
    originalDuration: 12,
    volume: 1,
    opacity: 1,
    ...overrides,
  };
}

function buildTrack(items: TimelineItemData[]): Track {
  return Track.fromPlainObject({
    id: 'video-track-1',
    name: 'V1',
    type: 'video',
    height: 80,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 0,
    items,
  });
}

describe('SplitService.splitItemAtTime', () => {
  it('splits start=10 dur=6 clip=[2,8] at t=13 into [2,5] and [5,8]', () => {
    const track = buildTrack([videoItem()]);
    const result = SplitService.splitItemAtTime(track, 'clip-1', 13);

    expect(result).not.toBeNull();
    const left = track.findItem(result!.leftId)!;
    const right = track.findItem(result!.rightId)!;

    expect(left.startTime.value).toBe(10);
    expect(left.duration.value).toBe(3);
    expect(left.clipStart!.value).toBe(2);
    expect(left.clipEnd!.value).toBe(5);

    expect(right.startTime.value).toBe(13);
    expect(right.duration.value).toBe(3);
    expect(right.clipStart!.value).toBe(5);
    expect(right.clipEnd!.value).toBe(8);
  });

  it('keeps the original id on the left half and mints a new id for the right', () => {
    const track = buildTrack([videoItem()]);
    const result = SplitService.splitItemAtTime(track, 'clip-1', 13)!;
    expect(result.leftId).toBe('clip-1');
    expect(result.rightId).not.toBe('clip-1');
  });

  it('produces seamless adjacency: left.end == right.start, left.clipEnd == right.clipStart', () => {
    const track = buildTrack([videoItem()]);
    const result = SplitService.splitItemAtTime(track, 'clip-1', 12.5)!;
    const left = track.findItem(result.leftId)!;
    const right = track.findItem(result.rightId)!;
    expect(left.endTime().value).toBeCloseTo(right.startTime.value, 9);
    expect(left.clipEnd!.value).toBeCloseTo(right.clipStart!.value, 9);
  });

  it('replaces one item with two, preserving sort order', () => {
    const track = buildTrack([videoItem()]);
    SplitService.splitItemAtTime(track, 'clip-1', 13);
    const ids = track.items.map(i => i.id);
    expect(track.items.length).toBe(2);
    expect(track.items[0].startTime.value).toBeLessThan(track.items[1].startTime.value);
    expect(new Set(ids).size).toBe(2);
  });

  it('no-ops (returns null) when tCut is at the clip start', () => {
    const track = buildTrack([videoItem()]);
    expect(SplitService.splitItemAtTime(track, 'clip-1', 10)).toBeNull();
    expect(track.items.length).toBe(1);
  });

  it('no-ops when tCut is at the clip end', () => {
    const track = buildTrack([videoItem()]);
    expect(SplitService.splitItemAtTime(track, 'clip-1', 16)).toBeNull();
    expect(track.items.length).toBe(1);
  });

  it('no-ops when tCut is within epsilon of an end-point', () => {
    const track = buildTrack([videoItem()]);
    expect(
      SplitService.splitItemAtTime(track, 'clip-1', 10 + TIME_EPSILON / 2),
    ).toBeNull();
    expect(track.items.length).toBe(1);
  });

  it('no-ops when tCut is outside the clip range', () => {
    const track = buildTrack([videoItem()]);
    expect(SplitService.splitItemAtTime(track, 'clip-1', 4)).toBeNull();
    expect(SplitService.splitItemAtTime(track, 'clip-1', 99)).toBeNull();
    expect(track.items.length).toBe(1);
  });

  it('returns null when the item is not on the track', () => {
    const track = buildTrack([videoItem()]);
    expect(SplitService.splitItemAtTime(track, 'missing', 13)).toBeNull();
  });

  it('both halves satisfy INV-1..INV-3', () => {
    const track = buildTrack([videoItem({ clipStart: 0, clipEnd: 6, originalDuration: 6 })]);
    const result = SplitService.splitItemAtTime(track, 'clip-1', 12.3)!;
    for (const id of [result.leftId, result.rightId]) {
      const it = track.findItem(id)!;
      // INV-1: duration > 0
      expect(it.duration.value).toBeGreaterThan(0);
      // INV-2: 0 <= clipStart < clipEnd <= originalDuration
      const cs = it.clipStart!.value;
      const ce = it.clipEnd!.value;
      const od = it.originalDuration!.value;
      expect(cs).toBeGreaterThanOrEqual(0);
      expect(cs).toBeLessThan(ce);
      expect(ce).toBeLessThanOrEqual(od + 1e-9);
      // INV-3: duration == clipEnd - clipStart
      expect(it.duration.value).toBeCloseTo(ce - cs, 9);
    }
  });

  it('falls back to duration-derived clip bounds when clip info is absent', () => {
    const track = buildTrack([
      videoItem({ clipStart: undefined, clipEnd: undefined, originalDuration: undefined }),
    ]);
    const result = SplitService.splitItemAtTime(track, 'clip-1', 13)!;
    const left = track.findItem(result.leftId)!;
    const right = track.findItem(result.rightId)!;
    // Default clip = [0, duration]; split offset 3 → left [0,3], right [3,6]
    expect(left.clipStart!.value).toBe(0);
    expect(left.clipEnd!.value).toBe(3);
    expect(right.clipStart!.value).toBe(3);
    expect(right.clipEnd!.value).toBe(6);
  });
});
