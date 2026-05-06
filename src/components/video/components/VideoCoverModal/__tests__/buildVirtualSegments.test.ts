/**
 * buildVirtualSegments — virtual timeline construction.
 *
 * Behaviour under test:
 *   - One video clip → single segment, virtualStart=0, virtualEnd=duration.
 *   - Gaps + audio-only items are skipped (only video items are concatenated).
 *   - Zero video items → totalVirtualDurationMs === 0 and segments === [].
 *   - Items are concatenated in startTime order, not arbitrary order.
 */

import { describe, it, expect } from 'vitest';

import { buildVirtualSegments } from '../hooks/useFrameExtraction';
import type { MaterialItem, TimelineItem } from '@/types';

const mat = (id: string, dur = 30): MaterialItem =>
  ({
    id,
    name: id,
    type: 'video',
    format: 'mp4',
    size: 0,
    duration: dur,
    url: `https://example.com/${id}.mp4`,
    createdAt: new Date(),
  }) as MaterialItem;

function vid(opts: {
  id: string;
  materialId: string;
  startTime: number;
  duration: number;
  clipStart?: number;
}): TimelineItem {
  return {
    id: opts.id,
    name: opts.id,
    type: 'video',
    startTime: opts.startTime,
    duration: opts.duration,
    trackId: 't',
    color: '#fff',
    materialId: opts.materialId,
    clipStart: opts.clipStart,
  } as TimelineItem;
}

function aud(opts: { id: string; startTime: number; duration: number }): TimelineItem {
  return {
    id: opts.id,
    name: opts.id,
    type: 'audio',
    startTime: opts.startTime,
    duration: opts.duration,
    trackId: 't-aud',
    color: '#0ff',
  } as TimelineItem;
}

describe('buildVirtualSegments', () => {
  it('one video clip → single segment matching its duration', () => {
    const m = mat('a');
    const items = [vid({ id: 'i1', materialId: 'a', startTime: 0, duration: 12 })];
    const result = buildVirtualSegments([m], items);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].virtualStart).toBe(0);
    expect(result.segments[0].virtualEnd).toBe(12);
    expect(result.totalVirtualDurationMs).toBe(12_000);
    expect(result.segments[0].clipOffset).toBe(0);
  });

  it('gap between video clips is skipped — segments are contiguous in virtual time', () => {
    const m1 = mat('a');
    const m2 = mat('b');
    const items = [
      vid({ id: 'i1', materialId: 'a', startTime: 0, duration: 5 }),
      // 10s gap on the timeline (startTime 15)
      vid({ id: 'i2', materialId: 'b', startTime: 15, duration: 7, clipStart: 2 }),
    ];
    const result = buildVirtualSegments([m1, m2], items);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].virtualStart).toBe(0);
    expect(result.segments[0].virtualEnd).toBe(5);
    expect(result.segments[1].virtualStart).toBe(5);
    expect(result.segments[1].virtualEnd).toBe(12);
    expect(result.segments[1].clipOffset).toBe(2);
    expect(result.totalVirtualDurationMs).toBe(12_000);
  });

  it('audio-only items are skipped', () => {
    const m = mat('a');
    const items = [
      aud({ id: 'a1', startTime: 0, duration: 30 }),
      vid({ id: 'i1', materialId: 'a', startTime: 5, duration: 8 }),
    ];
    const result = buildVirtualSegments([m], items);
    expect(result.segments).toHaveLength(1);
    expect(result.totalVirtualDurationMs).toBe(8_000);
  });

  it('zero video items → empty segments + zero duration', () => {
    const items = [aud({ id: 'a1', startTime: 0, duration: 30 })];
    const result = buildVirtualSegments([], items);
    expect(result.segments).toEqual([]);
    expect(result.totalVirtualDurationMs).toBe(0);
  });

  it('items are concatenated in startTime order regardless of input order', () => {
    const m1 = mat('a');
    const m2 = mat('b');
    const items = [
      vid({ id: 'i2', materialId: 'b', startTime: 100, duration: 4 }),
      vid({ id: 'i1', materialId: 'a', startTime: 0, duration: 6 }),
    ];
    const result = buildVirtualSegments([m1, m2], items);
    expect(result.segments[0].material.id).toBe('a');
    expect(result.segments[1].material.id).toBe('b');
    expect(result.totalVirtualDurationMs).toBe(10_000);
  });
});
