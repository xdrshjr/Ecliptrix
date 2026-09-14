import { describe, expect, it } from 'vitest';
import type { TimelineData, TimelineItemData, TrackData } from '@/components/video/timeline/domain/types';
import { TimelineAggregate } from '@/components/video/timeline/domain';
import { repairTimelineData, salvageTimelineData } from '../repairTimelineData';

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

function lane(id: string, items: TimelineItemData[]): TrackData {
  return {
    id, name: id, type: 'video', height: 80,
    isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items,
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
    tracks: [lane('video-track-1', items)],
  };
}

const itemIds = (data: TimelineData) => data.tracks[0].items.map((entry) => entry.id);

describe('repairTimelineData', () => {
  it('clamps a negative start time to zero', () => {
    const input = timeline([item('neg', { startTime: -3, clipStart: -1 }), item('ok', { startTime: 5 })]);

    const { data, report } = repairTimelineData(input);

    expect(data.tracks[0].items.map((entry) => entry.startTime)).toEqual([0, 5]);
    expect(data.tracks[0].items[0].clipStart).toBe(0);
    expect(report).toEqual({ clampedItemIds: ['neg'], droppedItemIds: [] });
    expect(input.tracks[0].items[0].startTime).toBe(-3);
  });

  it('keeps a legacy agent image whose clipEnd is 0', () => {
    const input = timeline([
      item('neg', { startTime: -3 }),
      item('image', { startTime: 5, duration: 4, clipStart: 0, clipEnd: 0, originalMaterialType: 'image' }),
    ]);

    const { data, report } = repairTimelineData(input);

    expect({ ids: itemIds(data), image: data.tracks[0].items[1], report }).toEqual({
      ids: ['neg', 'image'],
      image: input.tracks[0].items[1],
      report: { clampedItemIds: ['neg'], droppedItemIds: [] },
    });
  });

  it('keeps a zero-duration item the aggregate itself accepts', () => {
    const input = timeline([item('zero', { duration: 0 }), item('nan', { duration: Number.NaN })]);

    const { data, report } = repairTimelineData(input);

    expect({
      ids: itemIds(data),
      zeroDuration: data.tracks[0].items[0].duration,
      nanHasDuration: 'duration' in data.tracks[0].items[1],
      report,
    }).toEqual({
      ids: ['zero', 'nan'],
      zeroDuration: 0,
      nanHasDuration: false,
      report: { clampedItemIds: ['nan'], droppedItemIds: [] },
    });
    expect(() => TimelineAggregate.fromPlainObject(data)).not.toThrow();
  });

  it('keeps an imported clip whose clipEnd is not after clipStart', () => {
    const input = timeline([item('inverted', { clipStart: 4, clipEnd: 2 })]);

    const { data, report } = repairTimelineData(input);

    expect({ ids: itemIds(data), report }).toEqual({
      ids: ['inverted'],
      report: { clampedItemIds: [], droppedItemIds: [] },
    });
  });

  it('drops only the items that cannot be constructed', () => {
    const input = timeline([
      null as unknown as TimelineItemData,
      item('unbuildable', { originalDuration: Number.POSITIVE_INFINITY }),
      item('bad-end', { clipEnd: -1 }),
      item('bad-image-end', { clipEnd: -1, duration: 4, originalMaterialType: 'image' }),
      item('keep', { startTime: 5 }),
    ]);

    const { data, report } = repairTimelineData(input);

    expect({
      ids: itemIds(data),
      badEndHasClipEnd: 'clipEnd' in data.tracks[0].items[0],
      imageClipEnd: data.tracks[0].items[1].clipEnd,
      report,
    }).toEqual({
      ids: ['bad-end', 'bad-image-end', 'keep'],
      badEndHasClipEnd: false,
      imageClipEnd: 4,
      report: { clampedItemIds: ['bad-end', 'bad-image-end'], droppedItemIds: ['video-track-1#0', 'unbuildable'] },
    });
  });

  it('a null clip field the aggregate reads as absent is not reported as repaired', () => {
    const nulls = { clipStart: null, clipEnd: null, duration: null } as unknown as Partial<TimelineItemData>;
    const input = timeline([item('neg', { startTime: -3 }), item('nulls', { startTime: 5, ...nulls })]);

    const { data, report } = repairTimelineData(input);

    expect({ nulls: data.tracks[0].items[1], report }).toEqual({
      nulls: input.tracks[0].items[1],
      report: { clampedItemIds: ['neg'], droppedItemIds: [] },
    });
  });

  it('leaves a valid timeline byte-identical', () => {
    const input = timeline([item('a'), item('b', { startTime: 5, clipStart: 2, clipEnd: 7 })]);

    const { data, report } = repairTimelineData(input);

    expect(JSON.stringify(data)).toBe(JSON.stringify(input));
    expect(report).toEqual({ clampedItemIds: [], droppedItemIds: [] });
  });
});

describe('salvageTimelineData', () => {
  it('salvage keeps readable clips and drops only the ones that cannot be built', () => {
    const raw = {
      ...timeline([]),
      tracks: [
        lane('video-track-1', [
          item('keep'),
          item('neg', { startTime: -2 }),
          item('unbuildable', { originalDuration: Number.POSITIVE_INFINITY }),
        ]),
        { ...lane('audio-track-1', []), type: 'audio', items: 'broken' },
        'not-a-track',
        { name: 'no id', type: 'video', items: [] },
      ],
    };

    const salvaged = salvageTimelineData(raw);

    expect({
      tracks: salvaged?.data.tracks.map((track) => [track.id, track.items.map((entry) => entry.id)]),
      report: salvaged?.report,
    }).toEqual({
      tracks: [['video-track-1', ['keep', 'neg']], ['audio-track-1', []]],
      report: { droppedTrackIds: ['#2', '#3'], droppedItemIds: ['unbuildable'] },
    });
    expect(() => TimelineAggregate.fromPlainObject(salvaged!.data)).not.toThrow();
  });

  it('salvage reads nothing from a value without a tracks array', () => {
    expect([salvageTimelineData(null), salvageTimelineData({ tracks: 'x' }), salvageTimelineData('x')])
      .toEqual([null, null, null]);
  });
});
