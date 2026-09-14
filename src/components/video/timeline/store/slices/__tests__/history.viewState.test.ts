/**
 * TL2-03 / TL2-04: undo and redo restore clips only. Zoom, scroll and the
 * playhead are view state the user set after the edit, and a restored
 * snapshot must not leave selection or the inline editor pointing at clips
 * that no longer exist.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { addItemAction } from '../../actions/addItem';
import { replaceTimelineAction } from '../../actions/replaceTimeline';
import type { TimelineData } from '../../../domain';

const get = () => useTimelineStore.getState();

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1', name: 'Video 1', type: 'video', height: 80, isLocked: false,
        isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [{
          id: 'a', name: 'a', type: 'video', startTime: 0, duration: 4, trackId: 'video-track-1',
          color: '#3b82f6', materialId: 'material-a', clipStart: 0, clipEnd: 4, originalDuration: 4,
        }],
      },
      {
        id: 'subtitle-track-1', name: 'Subtitles', type: 'subtitle', height: 40, isLocked: false,
        isMuted: false, isVisible: true, volume: 100, order: 1, items: [],
      },
    ],
  };
}

const addSecondClip = () =>
  addItemAction(get, 'video-track-1', { id: 'material-b', name: 'b', type: 'video', duration: 4 });

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
  get().deselectAll();
  get().setEditingSubtitle(null);
});

describe('undo and view state', () => {
  it('undo restores clips but keeps zoom, scroll position and playhead', () => {
    addSecondClip();
    get().setZoomLevel(3);
    get().setScrollLeft(2000);
    get().setCurrentTime(3);
    get().undo();
    expect({
      clips: get().tracks[0].items.length,
      zoomLevel: get().zoomLevel,
      scrollLeft: get().scrollLeft,
      currentTime: get().currentTime,
    }).toEqual({ clips: 1, zoomLevel: 3, scrollLeft: 2000, currentTime: 3 });
  });

  it('undo clamps a playhead that the restored timeline no longer reaches', () => {
    addSecondClip();
    get().setCurrentTime(7);
    get().undo();
    expect(get().currentTime).toBe(4);
  });

  it('undo drops selected ids the restored snapshot no longer contains', () => {
    const added = addSecondClip();
    get().selectItem(added!.id);
    get().undo();
    expect(get().selectedItems).toEqual([]);
  });

  it('undo keeps selected ids that still exist', () => {
    get().selectItem('a');
    addSecondClip();
    get().undo();
    expect(get().selectedItems).toEqual(['a']);
  });

  it('undo closes the inline subtitle editor of a subtitle it removes', () => {
    const withSubtitle = get().exportToData();
    withSubtitle.tracks[1].items.push({
      id: 'sub-1', name: 'sub', type: 'subtitle', startTime: 0, duration: 2,
      trackId: 'subtitle-track-1', color: '#f59e0b', text: 'hello',
    });
    replaceTimelineAction(get, withSubtitle, 'subtitles');
    get().setEditingSubtitle('sub-1');
    get().undo();
    expect(get().editingSubtitleId).toBeNull();
  });
});
