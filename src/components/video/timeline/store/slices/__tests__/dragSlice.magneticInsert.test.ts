/**
 * @vitest-environment node
 *
 * TL3-01: releasing a clip at the front of a magnetic lane makes it the first
 * clip. The commit used to move the clip to its preview start and let the
 * stable sort keep the clip already starting there in front of it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { resizeItemAction } from '../../actions/resizeItem';
import type { TimelineData, TimelineItemData } from '../../../domain';

const get = () => useTimelineStore.getState();
const PX_PER_SECOND = 50;

function clip(id: string, startTime: number, duration: number): TimelineItemData {
  return {
    id, name: id, type: 'video', startTime, duration, trackId: 'video-track-1', color: '#3b82f6',
    materialId: `m-${id}`, clipStart: 0, clipEnd: duration, originalDuration: duration,
  };
}

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 16, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [clip('A', 0, 2), clip('B', 2, 2), clip('C', 4, 10), clip('D', 14, 2)],
    }],
  };
}

/** Press in the middle of a clip, cross the threshold, then drag by `deltaX` px. */
function dragClip(id: string, startTime: number, duration: number, deltaX: number): void {
  const width = duration * PX_PER_SECOND;
  get().startDrag({
    type: 'POINTER_DOWN', itemId: id, trackId: 'video-track-1', clientX: 0, clientY: 0,
    relativeX: width / 2, itemWidth: width, originalStartTime: startTime,
    originalDuration: duration, zoomLevel: 1, clipStart: 0, clipEnd: duration,
    originalMediaDuration: duration,
  });
  get().updateDrag({ type: 'POINTER_MOVE', clientX: Math.sign(deltaX) * 10, clientY: 0, deltaX: Math.sign(deltaX) * 10 });
  get().updateDrag({ type: 'POINTER_MOVE', clientX: deltaX, clientY: 0, deltaX });
  get().endDrag({ type: 'POINTER_UP', clientX: deltaX, clientY: 0 });
}

const order = () => get().tracks[0].items.map((item) => [item.id, item.startTime]);

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => {
  get().disposeDragActor();
});

describe('magnetic lane drag commit', () => {
  it('dragging a clip to time 0 makes it the first clip', () => {
    dragClip('C', 4, 10, -1000);
    expect(order()).toEqual([['C', 0], ['A', 10], ['B', 12], ['D', 14]]);
  });

  it('a drag that keeps the same neighbours records no history', () => {
    resizeItemAction(get, 'D', 'end', 15);
    get().undo();
    dragClip('B', 2, 2, 25);
    expect({
      order: order(),
      historyLength: get()._historyService.getActionCount(),
      canRedo: get().canRedo,
    }).toEqual({
      order: [['A', 0], ['B', 2], ['C', 4], ['D', 14]],
      historyLength: 1,
      canRedo: true,
    });
  });
});
