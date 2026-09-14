import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { addItemAction } from '../addItem';
import { replaceTimelineAction } from '../replaceTimeline';
import type { TimelineData, TimelineItemData } from '../../../domain';

const get = () => useTimelineStore.getState();

function clip(id: string, startTime: number, duration = 2): TimelineItemData {
  return {
    id,
    name: id,
    type: 'video',
    startTime,
    duration,
    trackId: 'video-track-1',
    color: '#3b82f6',
    materialId: `material-${id}`,
    clipStart: 0,
    clipEnd: duration,
    originalDuration: duration,
    originalMaterialType: 'video',
  };
}

function timelineWith(items: TimelineItemData[]): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 10,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1',
        name: 'Video 1',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items,
      },
    ],
  };
}

const itemIds = () => get().tracks[0].items.map(item => item.id);

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timelineWith([clip('a', 0)]));
  get().clearHistory();
  get().deselectAll();
});

describe('replaceTimelineAction', () => {
  it('replaceTimelineAction is undoable and redoable as one step', () => {
    replaceTimelineAction(get, timelineWith([clip('b', 0), clip('c', 2)]), 'ai-mix');
    get().undo();
    const afterUndo = itemIds();
    get().redo();
    expect({ afterUndo, afterRedo: itemIds() }).toEqual({ afterUndo: ['a'], afterRedo: ['b', 'c'] });
  });

  it('prunes selection ids that no longer exist', () => {
    get().selectItem('a');
    replaceTimelineAction(get, timelineWith([clip('b', 0)]), 'agent');
    expect(get().selectedItems).toEqual([]);
  });

  it('replacing with identical tracks records no history', () => {
    const recorded = replaceTimelineAction(get, get().exportToData(), 'import');
    expect({ recorded, canUndo: get().canUndo }).toEqual({ recorded: false, canUndo: false });
  });

  it('external agent update keeps prior undo history', () => {
    addItemAction(get, 'video-track-1', { id: 'material-manual', name: 'manual', type: 'video', duration: 3 });
    const withAgentClip = get().exportToData();
    withAgentClip.tracks[0].items.push(clip('agent', 5));
    replaceTimelineAction(get, withAgentClip, 'agent');

    get().undo(); // the agent operation
    get().undo(); // the user's own add, still in history

    expect(itemIds()).toEqual(['a']);
  });
});

describe('replaceTimelineAction view state and safety', () => {
  it('an external replace keeps the current zoom, scroll and playhead', () => {
    get().initTimeline(timelineWith([clip('a', 0, 4)]));
    get().setZoomLevel(3);
    get().setScrollLeft(2000);
    get().setCurrentTime(1.5);
    replaceTimelineAction(get, timelineWith([clip('b', 0, 4), clip('c', 4, 4)]), 'ai-mix');
    expect({
      zoomLevel: get().zoomLevel,
      scrollLeft: get().scrollLeft,
      currentTime: get().currentTime,
    }).toEqual({ zoomLevel: 3, scrollLeft: 2000, currentTime: 1.5 });
  });

  it('an external replace clamps the playhead to the new end', () => {
    get().initTimeline(timelineWith([clip('a', 0, 4), clip('b', 4, 4)]));
    get().setCurrentTime(7);
    replaceTimelineAction(get, timelineWith([clip('c', 0, 2)]), 'ai-mix');
    expect(get().currentTime).toBe(2);
  });

  it('an external replace cancels an in-flight drag', () => {
    get().disposeDragActor();
    get().startDrag({
      type: 'POINTER_DOWN', itemId: 'a', trackId: 'video-track-1', clientX: 100, clientY: 10,
      relativeX: 50, itemWidth: 100, originalStartTime: 0, originalDuration: 2, zoomLevel: 1,
      clipStart: 0, clipEnd: 2, originalMediaDuration: 2,
    });
    get().updateDrag({ type: 'POINTER_MOVE', clientX: 250, clientY: 10, deltaX: 150 });
    replaceTimelineAction(get, timelineWith([clip('b', 0)]), 'agent');
    const interacting = get().isInteracting;
    get().endDrag({ type: 'POINTER_UP', clientX: 250, clientY: 10 });
    const result = { interacting, ids: itemIds(), steps: get()._historyService.getHistory().length };
    get().disposeDragActor();
    expect(result).toEqual({ interacting: false, ids: ['b'], steps: 1 });
  });

  it('a malformed timeline throws before any history is recorded', () => {
    let threw = false;
    try {
      replaceTimelineAction(get, timelineWith([clip('bad', -3)]), 'agent');
    } catch {
      threw = true;
    }
    expect({ threw, canUndo: get().canUndo }).toEqual({ threw: true, canUndo: false });
  });

  it('a malformed timeline leaves an in-flight drag running', () => {
    get().disposeDragActor();
    get().startDrag({
      type: 'POINTER_DOWN', itemId: 'a', trackId: 'video-track-1', clientX: 100, clientY: 10,
      relativeX: 50, itemWidth: 100, originalStartTime: 0, originalDuration: 2, zoomLevel: 1,
      clipStart: 0, clipEnd: 2, originalMediaDuration: 2,
    });
    get().updateDrag({ type: 'POINTER_MOVE', clientX: 250, clientY: 10, deltaX: 150 });
    let threw = false;
    try {
      replaceTimelineAction(get, timelineWith([clip('bad', -3)]), 'agent');
    } catch {
      threw = true;
    }
    const interacting = get().isInteracting;
    get().disposeDragActor();
    expect({ threw, interacting }).toEqual({ threw: true, interacting: true });
  });
});
