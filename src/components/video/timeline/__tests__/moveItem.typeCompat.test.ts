/**
 * TimelineAggregate.moveItem — cross-track type-compatibility guard.
 *
 * spec 01 §6 #6: a cross-track move must honour the same material/track
 * type-compat rule as placement (Track.canAcceptMaterial). Moving a VIDEO item
 * onto a SUBTITLE (or AUDIO) track is rejected — the target track's addItem
 * throws before the move commits. This covers the existing guard behaviour;
 * no production code is changed.
 */

import { describe, it, expect } from 'vitest';
import { TimelineAggregate, TimePosition } from '../domain';
import type { TimelineData } from '../domain';

function item(
  id: string,
  start: number,
  dur: number,
  trackId: string,
  type: 'video' | 'audio' | 'subtitle' = 'video',
) {
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

describe('TimelineAggregate.moveItem cross-track type-compat', () => {
  it('rejects moving a video item onto a subtitle track', () => {
    const t = buildTimeline([
      {
        id: 'v', name: 'v', type: 'video', height: 80, isLocked: false,
        isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('clip', 0, 3, 'v', 'video')],
      },
      {
        id: 's', name: 's', type: 'subtitle', height: 50, isLocked: false,
        isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [],
      },
    ]);

    expect(() => t.moveItem('clip', TimePosition.create(0), 's')).toThrow(
      /cannot accept material of type "video"/,
    );

    // The type-compat guard fires inside the target track's addItem, so the
    // incompatible clip never lands on the subtitle track.
    const tracks = t.toPlainObject().tracks;
    expect(tracks.find((tr) => tr.id === 's')!.items).toEqual([]);
  });

  it('rejects moving a video item onto an audio track', () => {
    const t = buildTimeline([
      {
        id: 'v', name: 'v', type: 'video', height: 80, isLocked: false,
        isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('clip', 0, 3, 'v', 'video')],
      },
      {
        id: 'a', name: 'a', type: 'audio', height: 60, isLocked: false,
        isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [],
      },
    ]);

    expect(() => t.moveItem('clip', TimePosition.create(0), 'a')).toThrow(
      /cannot accept material of type "video"/,
    );
    const tracks = t.toPlainObject().tracks;
    expect(tracks.find((tr) => tr.id === 'a')!.items).toEqual([]);
  });
});
