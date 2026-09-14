/**
 * @vitest-environment node
 *
 * TL3-03: a trim drag on a caption's left edge commits an earlier start.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import type { TimelineData } from '../../../domain';

const get = () => useTimelineStore.getState();

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 7, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'subtitle-track-1', name: 'Subtitles', type: 'subtitle', height: 40,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [{
        id: 's1', name: 'caption', type: 'subtitle', startTime: 5, duration: 2,
        trackId: 'subtitle-track-1', color: '#f59e0b', text: 'hello',
      }],
    }],
  };
}

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => {
  get().disposeDragActor();
});

describe('subtitle trim drag', () => {
  it("a trim drag moves a subtitle's start earlier", () => {
    get().startDrag({
      type: 'POINTER_DOWN', itemId: 's1', trackId: 'subtitle-track-1', clientX: 0, clientY: 0,
      relativeX: 2, itemWidth: 100, originalStartTime: 5, originalDuration: 2, zoomLevel: 1,
      originalMediaDuration: Number.POSITIVE_INFINITY, isStill: true,
    });
    get().updateDrag({ type: 'POINTER_MOVE', clientX: -10, clientY: 0, deltaX: -10 });
    get().updateDrag({ type: 'POINTER_MOVE', clientX: -50, clientY: 0, deltaX: -50 });
    get().endDrag({ type: 'POINTER_UP', clientX: -50, clientY: 0 });
    const caption = get().tracks[0].items[0];
    expect({ startTime: caption.startTime, duration: caption.duration }).toEqual({ startTime: 4, duration: 3 });
  });
});
