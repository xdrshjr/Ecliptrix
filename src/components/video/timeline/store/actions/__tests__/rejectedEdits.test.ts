import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { addItemAction } from '../addItem';
import { removeItemsAction } from '../removeItem';
import { swapItemsAction } from '../swapItems';
import type { TimelineData, TimelineItemData } from '../../../domain';

const get = () => useTimelineStore.getState();

function audioClip(id: string, startTime: number): TimelineItemData {
  return {
    id,
    name: id,
    type: 'audio',
    startTime,
    duration: 3,
    trackId: 'audio-track-1',
    color: '#10b981',
    materialId: `material-${id}`,
    clipStart: 0,
    clipEnd: 3,
    originalDuration: 3,
  };
}

function timeline(): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 6,
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
        items: [
          {
            id: 'video-1',
            name: 'video-1',
            type: 'video',
            startTime: 0,
            duration: 2,
            trackId: 'video-track-1',
            color: '#3b82f6',
            materialId: 'material-video-1',
            clipStart: 0,
            clipEnd: 2,
            originalDuration: 2,
          },
        ],
      },
      {
        id: 'audio-track-1',
        name: 'Audio 1',
        type: 'audio',
        height: 60,
        isLocked: true,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 1,
        items: [audioClip('audio-1', 0), audioClip('audio-2', 3)],
      },
    ],
  };
}

const idsOn = (trackId: string) =>
  get().tracks.find(track => track.id === trackId)?.items.map(item => item.id) ?? [];

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

describe('refused edits leave history untouched', () => {
  it('removeItemsAction on a locked-track selection records no history and keeps redo', () => {
    addItemAction(get, 'video-track-1', { id: 'material-new', name: 'new', type: 'video', duration: 2 });
    get().undo();

    removeItemsAction(get, ['audio-1']);

    expect({ lockedClips: idsOn('audio-track-1'), canRedo: get().canRedo })
      .toEqual({ lockedClips: ['audio-1', 'audio-2'], canRedo: true });
  });

  it('removeItemsAction removes only the unlocked part of a mixed selection', () => {
    removeItemsAction(get, ['video-1', 'audio-1']);
    expect({ video: idsOn('video-track-1'), audio: idsOn('audio-track-1') })
      .toEqual({ video: [], audio: ['audio-1', 'audio-2'] });
  });

  it('addItemAction onto a locked or incompatible explicit track adds nothing and records nothing', () => {
    const audioMaterial = { id: 'material-audio', name: 'voice', type: 'audio' as const, duration: 2 };
    const onLockedTrack = addItemAction(get, 'audio-track-1', audioMaterial);
    const onIncompatibleTrack = addItemAction(get, 'video-track-1', audioMaterial);

    expect({ onLockedTrack, onIncompatibleTrack, canUndo: get().canUndo })
      .toEqual({ onLockedTrack: null, onIncompatibleTrack: null, canUndo: false });
  });

  it('swapItemsAction on a locked track records nothing', () => {
    swapItemsAction(get, 'audio-1', 'audio-2');
    expect({ order: idsOn('audio-track-1'), canUndo: get().canUndo })
      .toEqual({ order: ['audio-1', 'audio-2'], canUndo: false });
  });
});
