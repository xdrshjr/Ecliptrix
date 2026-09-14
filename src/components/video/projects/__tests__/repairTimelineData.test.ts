import { describe, expect, it } from 'vitest';
import type { TimelineData, TimelineItemData } from '@/components/video/timeline/domain/types';
import { repairTimelineData } from '../repairTimelineData';

function item(id: string, overrides: Partial<TimelineItemData> = {}): TimelineItemData {
  return {
    id,
    name: id,
    type: 'video',
    startTime: 0,
    duration: 5,
    trackId: 'video-track-1',
    color: '#4A90D9',
    clipStart: 0,
    clipEnd: 5,
    ...overrides,
  };
}

function timeline(items: TimelineItemData[]): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 10,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items,
    }],
  };
}

describe('repairTimelineData', () => {
  it('clamps a negative start time to zero', () => {
    const input = timeline([item('neg', { startTime: -3, clipStart: -1 }), item('ok', { startTime: 5 })]);

    const { data, report } = repairTimelineData(input);

    expect(data.tracks[0].items.map((entry) => entry.startTime)).toEqual([0, 5]);
    expect(data.tracks[0].items[0].clipStart).toBe(0);
    expect(report).toEqual({ clampedItemIds: ['neg'], droppedItemIds: [] });
    expect(input.tracks[0].items[0].startTime).toBe(-3);
  });

  it('drops items with a non-finite or non-positive duration', () => {
    const input = timeline([
      item('nan', { duration: Number.NaN }),
      item('zero', { duration: 0 }),
      item('text', { duration: 'abc' as unknown as number }),
      item('inverted', { clipStart: 4, clipEnd: 2 }),
      item('keep'),
    ]);

    const { data, report } = repairTimelineData(input);

    expect(data.tracks[0].items.map((entry) => entry.id)).toEqual(['keep']);
    expect(report.droppedItemIds).toEqual(['nan', 'zero', 'text', 'inverted']);
  });

  it('leaves a valid timeline byte-identical', () => {
    const input = timeline([item('a'), item('b', { startTime: 5, clipStart: 2, clipEnd: 7 })]);

    const { data, report } = repairTimelineData(input);

    expect(JSON.stringify(data)).toBe(JSON.stringify(input));
    expect(report).toEqual({ clampedItemIds: [], droppedItemIds: [] });
  });
});
