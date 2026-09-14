/**
 * TL2-20: when a delete shortens the timeline, the playhead must not stay
 * parked past the new end (the ruler reported aria-valuenow > aria-valuemax).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { moveItemAction } from '../moveItem';
import { removeItemsAction } from '../removeItem';
import type { TimelineData, TimelineItemData } from '../../../domain';

const get = () => useTimelineStore.getState();

function clip(id: string, startTime: number): TimelineItemData {
  return {
    id, name: id, type: 'video', startTime, duration: 4, trackId: 'video-track-1',
    color: '#3b82f6', materialId: `material-${id}`, clipStart: 0, clipEnd: 4, originalDuration: 4,
  };
}

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 8, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80, isLocked: false,
      isMuted: false, isVisible: true, volume: 100, order: 0, items: [clip('a', 0), clip('b', 4)],
    }],
  };
}

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

describe('playhead clamp after a delete', () => {
  it('deleting the last clip moves a playhead past the end back to the end', () => {
    get().setCurrentTime(7);
    removeItemsAction(get, ['b']);
    expect(get().currentTime).toBe(4);
  });

  it('a playhead inside the remaining content stays where it is', () => {
    get().setCurrentTime(2.5);
    removeItemsAction(get, ['b']);
    expect(get().currentTime).toBe(2.5);
  });

  it('moving the last subtitle earlier moves a playhead past the new end back to the end', () => {
    const data = timeline();
    data.tracks.push({
      id: 'subtitle-track-1', name: 'Subtitles', type: 'subtitle', height: 40, isLocked: false,
      isMuted: false, isVisible: true, volume: 100, order: 1,
      items: [{
        id: 's', name: 's', type: 'subtitle', startTime: 9, duration: 2,
        trackId: 'subtitle-track-1', color: '#f59e0b', text: 'hello',
      }],
    });
    get().initTimeline(data);
    get().setCurrentTime(10.5);
    moveItemAction(get, 's', 1);
    expect(get().currentTime).toBe(8);
  });
});
