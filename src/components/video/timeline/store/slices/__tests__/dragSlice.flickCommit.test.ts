/**
 * @vitest-environment node
 *
 * TL2-16: a pointerup that follows the threshold-crossing move straight away
 * used to leave the drag machine parked in `committed` (no preview → no
 * COMMIT_COMPLETE), killing every later drag in the session.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import type { PointerDownEvent, TimelineData, TimelineItemData } from '../../../domain';

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

function pointerDown(itemId: string, originalStartTime: number): PointerDownEvent {
  return {
    type: 'POINTER_DOWN', itemId, trackId: 'video-track-1', clientX: 400, clientY: 10,
    relativeX: 100, itemWidth: 200, originalStartTime, originalDuration: 4, zoomLevel: 1,
    clipStart: 0, clipEnd: 4, originalMediaDuration: 4,
  };
}

function move(deltaX: number): void {
  get().updateDrag({ type: 'POINTER_MOVE', clientX: 400 + deltaX, clientY: 10, deltaX });
}

function release(deltaX: number): void {
  get().endDrag({ type: 'POINTER_UP', clientX: 400 + deltaX, clientY: 10 });
}

const orderByStart = () =>
  [...get().tracks[0].items].sort((x, y) => x.startTime - y.startTime).map((item) => item.id);

beforeEach(() => {
  get().disposeDragActor();
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => {
  get().disposeDragActor();
});

describe('drag commit right after the threshold', () => {
  it('a pointerup right after the threshold-crossing move commits and returns to idle', () => {
    get().startDrag(pointerDown('b', 4));
    move(-250);
    release(-250);
    expect({ order: orderByStart(), interacting: get().isInteracting, canUndo: get().canUndo }).toEqual({
      order: ['b', 'a'],
      interacting: false,
      canUndo: true,
    });
  });

  it('a later drag still starts after a flick', () => {
    get().startDrag(pointerDown('b', 4));
    move(-250);
    release(-250);
    get().startDrag(pointerDown('a', 4));
    move(100);
    expect(get().isDragging).toBe(true);
  });

  it('a drag released at its origin records no history', () => {
    get().startDrag(pointerDown('a', 0));
    move(150);
    move(0);
    release(0);
    expect({ order: orderByStart(), interacting: get().isInteracting, canUndo: get().canUndo }).toEqual({
      order: ['a', 'b'],
      interacting: false,
      canUndo: false,
    });
  });

  it('a drag whose preview shortens the timeline leaves the playhead where it was', () => {
    get().setCurrentTime(7.5);
    get().startDrag(pointerDown('b', 4));
    move(-150); // b previews at 1–5, so the content briefly ends at 5
    const duringDrag = get().currentTime;
    move(0);
    release(0);
    expect({ duringDrag, afterRelease: get().currentTime }).toEqual({
      duringDrag: 7.5,
      afterRelease: 7.5,
    });
  });
});
