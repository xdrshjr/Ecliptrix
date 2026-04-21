import { describe, it, expect } from 'vitest';
import { TimelineAggregate, TrackLockedError } from '../domain';
import type { TimelineData } from '../domain';

function item(id: string, start: number, dur: number, trackId: string, type: 'video' | 'audio' | 'subtitle' = 'video') {
  return {
    id, name: id, type, startTime: start, duration: dur, trackId,
    color: '#4A90D9', volume: 1, opacity: 1,
  };
}

function buildTimeline(tracks: TimelineData['tracks']): TimelineAggregate {
  return TimelineAggregate.fromPlainObject({
    currentTime: 0, totalDuration: 1, zoomLevel: 1, playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks,
  });
}

describe('TimelineAggregate.swapItems', () => {
  it('swaps two video items on the same track', () => {
    const t = buildTimeline([{
      id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [item('a', 0, 3, 'v'), item('b', 3, 4, 'v')],
    }]);
    t.swapItems('a', 'b');
    const items = t.toPlainObject().tracks[0].items;
    const a = items.find(i => i.id === 'a')!;
    const b = items.find(i => i.id === 'b')!;
    expect(a.startTime).toBe(3);
    expect(b.startTime).toBe(0);
    expect(a.duration).toBe(3);
    expect(b.duration).toBe(4);
  });

  it('rejects self-swap', () => {
    const t = buildTimeline([{
      id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [item('a', 0, 3, 'v')],
    }]);
    expect(() => t.swapItems('a', 'a')).toThrow(/itself/);
  });

  it('rejects cross-track swap', () => {
    const t = buildTimeline([
      { id: 'v1', name: 'v1', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [item('a', 0, 3, 'v1')] },
      { id: 'v2', name: 'v2', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1, items: [item('b', 0, 3, 'v2')] },
    ]);
    expect(() => t.swapItems('a', 'b')).toThrow(/cross-track/);
  });

  it('rejects locked track', () => {
    const t = buildTimeline([{
      id: 'v', name: 'v', type: 'video', height: 80, isLocked: true, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [item('a', 0, 3, 'v'), item('b', 3, 4, 'v')],
    }]);
    expect(() => t.swapItems('a', 'b')).toThrow(TrackLockedError);
  });

  it('rejects subtitle track swap', () => {
    const t = buildTimeline([{
      id: 's', name: 's', type: 'subtitle', height: 40, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [item('a', 0, 3, 's', 'subtitle'), item('b', 3, 4, 's', 'subtitle')],
    }]);
    expect(() => t.swapItems('a', 'b')).toThrow(/subtitle/);
  });

  it('rejects when item not found', () => {
    const t = buildTimeline([{
      id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [item('a', 0, 3, 'v')],
    }]);
    expect(() => t.swapItems('a', 'nope')).toThrow(/not found/);
    expect(() => t.swapItems('nope', 'a')).toThrow(/not found/);
  });

  it('preserves duration on equal-length swap', () => {
    const t = buildTimeline([{
      id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [item('a', 0, 5, 'v'), item('b', 5, 5, 'v')],
    }]);
    t.swapItems('a', 'b');
    const items = t.toPlainObject().tracks[0].items;
    expect(items.find(i => i.id === 'a')!.startTime).toBe(5);
    expect(items.find(i => i.id === 'b')!.startTime).toBe(0);
    // Order after sortItems: b first (startTime 0), then a
    expect(items.map(i => i.id)).toEqual(['b', 'a']);
  });
});
