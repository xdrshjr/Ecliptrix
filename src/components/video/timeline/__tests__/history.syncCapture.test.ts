import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../store/useTimelineStore';
import { addItemAction } from '../store/actions/addItem';
import { HistoryService } from '../domain/services/HistoryService';
import type { TimelineData, TimelineSnapshot } from '../domain/types';

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

const materialIds = () => get().tracks[0].items.map(item => item.materialId);

function snapshot(marker: string): TimelineSnapshot {
  return { marker } as unknown as TimelineSnapshot;
}

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(emptyTimeline());
  get().clearHistory();
});

describe('synchronous history capture', () => {
  it('two addItemAction calls in the same tick are both redoable', () => {
    addItemAction(get, 'video-track-1', { id: 'm1', name: 'one', type: 'video', duration: 2 });
    addItemAction(get, 'video-track-1', { id: 'm2', name: 'two', type: 'video', duration: 2 });

    get().undo();
    get().undo();
    get().redo();
    get().redo();

    expect(materialIds()).toEqual(['m1', 'm2']);
  });

  it('capture after undo does not overwrite the undone entry', () => {
    const service = new HistoryService();
    const after = snapshot('after');
    service.addAction({ type: 'ADD_ITEM', timestamp: new Date(), previousState: snapshot('before') });
    service.captureAfterState(after);

    service.undo();
    service.captureAfterState(snapshot('stale'));

    expect(service.redo()).toBe(after);
  });
});
