/**
 * @vitest-environment node
 *
 * TL2-18: while a drag is in flight the gesture owns the timeline. Undo must
 * not restore a snapshot under it, and a release whose clip disappeared
 * mid-drag must not write history.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { removeItemsAction } from '../../actions/removeItem';
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

function dragA(deltaX: number): void {
  const down: PointerDownEvent = {
    type: 'POINTER_DOWN', itemId: 'a', trackId: 'video-track-1', clientX: 100, clientY: 10,
    relativeX: 100, itemWidth: 200, originalStartTime: 0, originalDuration: 4, zoomLevel: 1,
    clipStart: 0, clipEnd: 4, originalMediaDuration: 4,
  };
  get().startDrag(down);
  get().updateDrag({ type: 'POINTER_MOVE', clientX: 100 + deltaX, clientY: 10, deltaX });
}

const itemIds = () => get().tracks[0].items.map((item) => item.id).sort();

beforeEach(() => {
  get().disposeDragActor();
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => {
  get().disposeDragActor();
});

describe('history during a drag', () => {
  it('undo is ignored while a drag is in flight', () => {
    removeItemsAction(get, ['b']);
    dragA(150);
    get().undo();
    const duringDrag = itemIds();
    get().endDrag({ type: 'POINTER_UP', clientX: 250, clientY: 10 });
    expect(duringDrag).toEqual(['a']);
  });

  it('a commit for a vanished clip records nothing', () => {
    dragA(150);
    get().removeItem('a');
    get().endDrag({ type: 'POINTER_UP', clientX: 250, clientY: 10 });
    expect({ canUndo: get().canUndo, interacting: get().isInteracting }).toEqual({
      canUndo: false,
      interacting: false,
    });
  });
});
