import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { addItemAction } from '../addItem';
import {
  fitImagePositionAction,
  updateImagePositionAction,
  updateSubtitleTextAction,
} from '../updateItemFields';
import type { ImagePosition, TimelineData } from '../../../domain';

const get = () => useTimelineStore.getState();

const INITIAL_POSITION: ImagePosition = { x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 };

function timeline(isLocked = false): TimelineData {
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
        isLocked,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: [
          {
            id: 'image-1',
            name: 'Overlay',
            type: 'video',
            startTime: 0,
            duration: 6,
            trackId: 'video-track-1',
            color: '#8b5cf6',
            materialId: 'image-material-1',
            originalMaterialType: 'image',
            imagePosition: INITIAL_POSITION,
          },
        ],
      },
      {
        id: 'subtitle-track-1',
        name: 'Subtitles',
        type: 'subtitle',
        height: 40,
        isLocked,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 1,
        items: [
          {
            id: 'sub-1',
            name: 'Subtitle',
            type: 'subtitle',
            startTime: 0,
            duration: 2,
            trackId: 'subtitle-track-1',
            color: '#f59e0b',
            text: 'hello',
          },
        ],
      },
    ],
  };
}

function findItem(itemId: string) {
  return get().tracks.flatMap(track => track.items).find(item => item.id === itemId);
}

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

describe('updateSubtitleTextAction', () => {
  it('subtitle text edit is its own undo step and survives redo', () => {
    updateSubtitleTextAction(get, 'sub-1', 'world');
    get().undo();
    const afterUndo = findItem('sub-1')?.text;
    get().redo();
    expect({ afterUndo, afterRedo: findItem('sub-1')?.text }).toEqual({ afterUndo: 'hello', afterRedo: 'world' });
  });

  it('undoing a text edit leaves the previous step in place', () => {
    addItemAction(get, 'video-track-1', { id: 'material-video', name: 'clip', type: 'video', duration: 2 });
    updateSubtitleTextAction(get, 'sub-1', 'world');
    get().undo();
    expect({
      text: findItem('sub-1')?.text,
      videoItems: get().tracks[0].items.length,
    }).toEqual({ text: 'hello', videoItems: 2 });
  });

  it('an unchanged text records nothing', () => {
    expect({ applied: updateSubtitleTextAction(get, 'sub-1', 'hello'), canUndo: get().canUndo })
      .toEqual({ applied: false, canUndo: false });
  });
});

describe('updateImagePositionAction', () => {
  it('image position confirm is undoable', () => {
    updateImagePositionAction(get, 'image-1', { ...INITIAL_POSITION, x: 0.3 });
    const afterConfirm = findItem('image-1')?.imagePosition?.x;
    get().undo();
    expect({ afterConfirm, afterUndo: findItem('image-1')?.imagePosition?.x })
      .toEqual({ afterConfirm: 0.3, afterUndo: 0.1 });
  });
});

describe('locked tracks', () => {
  it('edits on locked tracks record nothing', () => {
    get().initTimeline(timeline(true));
    get().clearHistory();
    expect({
      text: updateSubtitleTextAction(get, 'sub-1', 'world'),
      position: updateImagePositionAction(get, 'image-1', { ...INITIAL_POSITION, x: 0.3 }),
      canUndo: get().canUndo,
    }).toEqual({ text: false, position: false, canUndo: false });
  });

  it('image position edits are refused while the agent edit lock is set', () => {
    get().setExternalEditLock('agent');
    expect({
      applied: updateImagePositionAction(get, 'image-1', { ...INITIAL_POSITION, x: 0.3 }),
      x: findItem('image-1')?.imagePosition?.x,
      canUndo: get().canUndo,
    }).toEqual({ applied: false, x: 0.1, canUndo: false });
  });
});

describe('fitImagePositionAction', () => {
  it('writes an auto-fit position into the store without an undo entry', () => {
    const applied = fitImagePositionAction(get, 'image-1', { ...INITIAL_POSITION, width: 0.5 });
    expect({ applied, width: findItem('image-1')?.imagePosition?.width, canUndo: get().canUndo })
      .toEqual({ applied: true, width: 0.5, canUndo: false });
  });

  it('skips while the agent edit lock is set', () => {
    get().setExternalEditLock('agent');
    const applied = fitImagePositionAction(get, 'image-1', { ...INITIAL_POSITION, width: 0.5 });
    expect({ applied, width: findItem('image-1')?.imagePosition?.width }).toEqual({ applied: false, width: 0.8 });
  });
});
