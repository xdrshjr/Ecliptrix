/**
 * @vitest-environment node
 *
 * TL3-02 / S12: an edit that leaves the tracks exactly as they were must not
 * add an undo entry, and must not throw away the redo branch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { resizeItemAction } from '../../actions/resizeItem';
import {
  commitTrackVolumeAction,
  toggleTrackLockAction,
  toggleTrackMuteAction,
} from '../../actions/trackActions';
import { HistoryService, type TimelineAction } from '../../../domain/services/HistoryService';
import type { TimelineData, TimelineItemData } from '../../../domain';

const get = () => useTimelineStore.getState();

function clip(id: string, trackId: string, startTime: number, duration: number): TimelineItemData {
  return {
    id, name: id, type: trackId.startsWith('audio') ? 'audio' : 'video', startTime, duration,
    trackId, color: '#3b82f6', materialId: `m-${id}`, clipStart: 0, clipEnd: duration,
    originalDuration: duration,
  };
}

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 16, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          clip('A', 'video-track-1', 0, 2), clip('B', 'video-track-1', 2, 2),
          clip('C', 'video-track-1', 4, 10), clip('D', 'video-track-1', 14, 2),
        ],
      },
      {
        id: 'audio-track-1', name: 'Audio 1', type: 'audio', height: 60,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [clip('M', 'audio-track-1', 0, 6)],
      },
    ],
  };
}

function drag(options: {
  itemId: string; trackId: string; startTime: number; duration: number;
  deltaX: number; targetTrackId?: string;
}): void {
  const width = options.duration * 50;
  get().startDrag({
    type: 'POINTER_DOWN', itemId: options.itemId, trackId: options.trackId, clientX: 0, clientY: 0,
    relativeX: width / 2, itemWidth: width, originalStartTime: options.startTime,
    originalDuration: options.duration, zoomLevel: 1, clipStart: 0, clipEnd: options.duration,
    originalMediaDuration: options.duration,
  });
  get().updateDrag({
    type: 'POINTER_MOVE', clientX: 10, clientY: 0, deltaX: 10, targetTrackId: options.targetTrackId,
  });
  get().updateDrag({
    type: 'POINTER_MOVE', clientX: options.deltaX, clientY: 0, deltaX: options.deltaX,
    targetTrackId: options.targetTrackId,
  });
  get().endDrag({
    type: 'POINTER_UP', clientX: options.deltaX, clientY: 0, targetTrackId: options.targetTrackId,
  });
}

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
  // A real edit, undone: the redo branch every case below must keep.
  resizeItemAction(get, 'D', 'end', 15);
  get().undo();
});

afterEach(() => {
  get().disposeDragActor();
});

const NO_OP_EDITS: Array<[string, () => void]> = [
  ['a drag that snaps back', () => drag({ itemId: 'B', trackId: 'video-track-1', startTime: 2, duration: 2, deltaX: 25 })],
  ['a release over an incompatible lane', () => drag({
    itemId: 'M', trackId: 'audio-track-1', startTime: 0, duration: 6, deltaX: 12, targetTrackId: 'video-track-1',
  })],
  ['organizing a tidy timeline', () => {
    get().recordAction('UPDATE_ITEM', { operation: 'organize_materials' });
    get().autoOrganize();
    get().captureNextState();
  }],
  ['committing an unchanged volume', () => commitTrackVolumeAction(get, 'audio-track-1', 100, 100)],
  ['muting a locked track', () => {
    toggleTrackLockAction(get, 'audio-track-1');
    toggleTrackMuteAction(get, 'audio-track-1');
  }],
];

describe('no-op history entries (S12)', () => {
  it.each(NO_OP_EDITS)(
    'an edit that leaves the tracks unchanged records no history and keeps redo: %s',
    (_name, edit) => {
      const tracksBefore = JSON.stringify(get().exportToData().tracks.map((track) => track.items));
      edit();
      expect({
        items: JSON.stringify(get().exportToData().tracks.map((track) => track.items)),
        actionCount: get()._historyService.getActionCount(),
        canUndo: get().canUndo,
        canRedo: get().canRedo,
      }).toEqual({ items: tracksBefore, actionCount: 1, canUndo: false, canRedo: true });
    },
  );

  it('discarding restores the entry trimmed by MAX_HISTORY', () => {
    const service = new HistoryService();
    const snapshot = timeline();
    const action = (n: number): TimelineAction => ({
      type: 'UPDATE_ITEM', payload: { n }, timestamp: new Date(0), previousState: snapshot,
    });
    for (let n = 0; n < HistoryService.MAX_HISTORY; n += 1) {
      service.addAction(action(n));
      service.captureAfterState(snapshot);
    }
    service.addAction(action(HistoryService.MAX_HISTORY));
    service.discardLastAction();
    expect({
      count: service.getActionCount(),
      first: service.getHistory()[0].payload,
      index: service.getCurrentIndex(),
    }).toEqual({ count: HistoryService.MAX_HISTORY, first: { n: 0 }, index: HistoryService.MAX_HISTORY - 1 });
  });
});
