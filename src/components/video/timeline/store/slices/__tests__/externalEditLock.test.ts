import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { addItemAction } from '../../actions/addItem';
import type { TimelineData } from '../../../domain';

const get = () => useTimelineStore.getState();

function emptyTimeline(): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 0,
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
        items: [],
      },
    ],
  };
}

const itemCount = () => get().tracks[0].items.length;

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(emptyTimeline());
  get().clearHistory();
  addItemAction(get, 'video-track-1', { id: 'm1', name: 'clip', type: 'video', duration: 2 });
});

describe('external edit lock', () => {
  it('undo and redo are no-ops while the agent edit lock is set', () => {
    get().setExternalEditLock('agent');
    get().undo();
    const afterLockedUndo = itemCount();

    get().setExternalEditLock(null);
    get().undo();
    get().setExternalEditLock('agent');
    get().redo();

    expect({ afterLockedUndo, afterLockedRedo: itemCount() }).toEqual({
      afterLockedUndo: 1,
      afterLockedRedo: 0,
    });
  });

  it('releasing the lock restores undo', () => {
    get().setExternalEditLock('agent');
    get().setExternalEditLock(null);
    get().undo();
    expect(itemCount()).toBe(0);
  });
});
