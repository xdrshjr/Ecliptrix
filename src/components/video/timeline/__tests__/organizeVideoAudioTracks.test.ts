import { describe, it, expect } from 'vitest';
import { TimelineAggregate } from '../domain';
import type { TimelineData } from '../domain';

function makeItem(id: string, startTime: number, duration: number, trackId: string, type: 'video' | 'audio' | 'subtitle' = 'video') {
  return {
    id,
    name: id,
    type,
    startTime,
    duration,
    trackId,
    color: '#4A90D9',
    volume: 1,
    opacity: 1,
  };
}

function makeTimeline(tracks: TimelineData['tracks']): TimelineAggregate {
  return TimelineAggregate.fromPlainObject({
    currentTime: 0,
    totalDuration: 1,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
    tracks,
  });
}

describe('TimelineAggregate.organizeVideoAudioTracks', () => {
  it('packs items flush from 0 with no gaps', () => {
    const t = makeTimeline([
      {
        id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          makeItem('a', 10, 3, 'v'),
          makeItem('b', 20, 2, 'v'),
          makeItem('c', 30, 4, 'v'),
        ],
      },
    ]);
    t.organizeVideoAudioTracks();
    const items = t.toPlainObject().tracks[0].items;
    expect(items.map(i => i.startTime)).toEqual([0, 3, 5]);
    expect(items.map(i => i.duration)).toEqual([3, 2, 4]);
  });

  it('sorts by startTime before packing', () => {
    const t = makeTimeline([
      {
        id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          makeItem('late', 30, 4, 'v'),
          makeItem('early', 0, 3, 'v'),
          makeItem('mid', 10, 2, 'v'),
        ],
      },
    ]);
    t.organizeVideoAudioTracks();
    const items = t.toPlainObject().tracks[0].items;
    expect(items.map(i => i.id)).toEqual(['early', 'mid', 'late']);
    expect(items.map(i => i.startTime)).toEqual([0, 3, 5]);
  });

  it('leaves subtitle tracks untouched', () => {
    const t = makeTimeline([
      {
        id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [makeItem('va', 5, 2, 'v'), makeItem('vb', 20, 3, 'v')],
      },
      {
        id: 's', name: 's', type: 'subtitle', height: 40, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [
          makeItem('s1', 1.5, 1, 's', 'subtitle'),
          makeItem('s2', 4, 1, 's', 'subtitle'),
        ],
      },
    ]);
    t.organizeVideoAudioTracks();
    const data = t.toPlainObject();
    // video packed
    expect(data.tracks[0].items.map(i => i.startTime)).toEqual([0, 2]);
    // subtitle untouched
    expect(data.tracks[1].items.map(i => i.startTime)).toEqual([1.5, 4]);
  });

  it('skips locked tracks', () => {
    const t = makeTimeline([
      {
        id: 'v', name: 'v', type: 'video', height: 80, isLocked: true, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [makeItem('a', 5, 2, 'v'), makeItem('b', 12, 1, 'v')],
      },
    ]);
    t.organizeVideoAudioTracks();
    expect(t.toPlainObject().tracks[0].items.map(i => i.startTime)).toEqual([5, 12]);
  });

  it('is a no-op on empty tracks', () => {
    const t = makeTimeline([
      {
        id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [],
      },
    ]);
    expect(() => t.organizeVideoAudioTracks()).not.toThrow();
    expect(t.toPlainObject().tracks[0].items).toEqual([]);
  });

  it('mixes video+audio+subtitle: packs v/a, leaves subtitle alone', () => {
    const t = makeTimeline([
      {
        id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [makeItem('v1', 5, 3, 'v')],
      },
      {
        id: 'a', name: 'a', type: 'audio', height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [makeItem('a1', 8, 2, 'a', 'audio'), makeItem('a2', 20, 4, 'a', 'audio')],
      },
      {
        id: 's', name: 's', type: 'subtitle', height: 40, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 2,
        items: [makeItem('s1', 9, 1, 's', 'subtitle')],
      },
    ]);
    t.organizeVideoAudioTracks();
    const d = t.toPlainObject();
    expect(d.tracks[0].items.map(i => i.startTime)).toEqual([0]);
    expect(d.tracks[1].items.map(i => i.startTime)).toEqual([0, 2]);
    expect(d.tracks[2].items.map(i => i.startTime)).toEqual([9]);
  });
});
