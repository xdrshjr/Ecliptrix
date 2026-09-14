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
