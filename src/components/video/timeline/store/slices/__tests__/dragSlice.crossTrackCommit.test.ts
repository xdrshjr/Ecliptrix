/**
 * @vitest-environment node
 *
 * The drag release path for moves that change lanes or land on a caption:
 * a cross-lane drop onto a magnetic lane takes the slot the drop point names
 * (TL3-01) in one undoable step, and a caption released onto another caption
 * is fitted into a free gap (TL3-04).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import type { TimelineData, TimelineItemData, TrackData } from '../../../domain';

const get = () => useTimelineStore.getState();
const PIXELS_PER_SECOND = 50;

function clip(id: string, trackId: string, startTime: number, duration: number): TimelineItemData {
  const isSubtitle = trackId.startsWith('subtitle');
  return {
    id, name: id, type: isSubtitle ? 'subtitle' : 'video', startTime, duration, trackId,
    color: '#3b82f6',
    ...(isSubtitle
      ? { text: id }
      : { materialId: `m-${id}`, clipStart: 0, clipEnd: duration, originalDuration: duration }),
  };
}

function track(id: string, order: number, items: TimelineItemData[]): TrackData {
  return {
    id, name: id, type: id.startsWith('subtitle') ? 'subtitle' : 'video', height: 60,
    isLocked: false, isMuted: false, isVisible: true, volume: 100, order, items,
  };
}

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 20, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      track('video-track-1', 0, [clip('A', 'video-track-1', 0, 2), clip('B', 'video-track-1', 2, 2)]),
      track('video-track-2', 1, [clip('C', 'video-track-2', 0, 10)]),
      track('subtitle-track-1', 2, [clip('S1', 'subtitle-track-1', 0, 2), clip('S2', 'subtitle-track-1', 4, 2)]),
      track('subtitle-track-2', 3, [clip('S3', 'subtitle-track-2', 0, 3)]),
    ],
  };
}

function drag(options: {
  itemId: string; trackId: string; startTime: number; duration: number;
  toStart: number; targetTrackId: string;
}): void {
  const width = options.duration * PIXELS_PER_SECOND;
  const deltaX = (options.toStart - options.startTime) * PIXELS_PER_SECOND;
  get().startDrag({
    type: 'POINTER_DOWN', itemId: options.itemId, trackId: options.trackId, clientX: 0, clientY: 0,
    relativeX: width / 2, itemWidth: width, originalStartTime: options.startTime,
    originalDuration: options.duration, zoomLevel: 1, clipStart: 0, clipEnd: options.duration,
    originalMediaDuration: options.duration,
  });
  get().updateDrag({ type: 'POINTER_MOVE', clientX: 10, clientY: 0, deltaX: 10 });
  get().updateDrag({
    type: 'POINTER_MOVE', clientX: deltaX, clientY: 0, deltaX, targetTrackId: options.targetTrackId,
  });
  get().endDrag({ type: 'POINTER_UP', clientX: deltaX, clientY: 0, targetTrackId: options.targetTrackId });
}

function lane(trackId: string): Array<[string, number]> {
  const found = get().tracks.find((candidate) => candidate.id === trackId)!;
  return [...found.items]
    .sort((a, b) => a.startTime - b.startTime)
    .map((item) => [item.id, item.startTime]);
}

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => {
  get().disposeDragActor();
});

describe('drag release across lanes', () => {
  it('a clip dropped at time 0 on another magnetic lane becomes its first clip', () => {
    drag({ itemId: 'C', trackId: 'video-track-2', startTime: 0, duration: 10, toStart: 0, targetTrackId: 'video-track-1' });
    expect({ lane: lane('video-track-1'), entries: get()._historyService.getActionCount() })
      .toEqual({ lane: [['C', 0], ['A', 10], ['B', 12]], entries: 1 });
  });

  it('one undo puts a cross-lane magnetic drop back on both lanes and redo replays it', () => {
    drag({ itemId: 'C', trackId: 'video-track-2', startTime: 0, duration: 10, toStart: 0, targetTrackId: 'video-track-1' });
    get().undo();
    const undone = { target: lane('video-track-1'), source: lane('video-track-2') };
    get().redo();
    expect({ undone, redone: lane('video-track-1') }).toEqual({
      undone: { target: [['A', 0], ['B', 2]], source: [['C', 0]] },
      redone: [['C', 0], ['A', 10], ['B', 12]],
    });
  });

  it('a caption dropped onto another lane lands in the nearest gap that holds it', () => {
    drag({ itemId: 'S3', trackId: 'subtitle-track-2', startTime: 0, duration: 3, toStart: 1, targetTrackId: 'subtitle-track-1' });
    expect({ lane: lane('subtitle-track-1'), selected: get().selectedItems })
      .toEqual({ lane: [['S1', 0], ['S2', 4], ['S3', 6]], selected: ['S3'] });
  });

  it('a caption released onto its neighbour on its own lane is fitted beside it', () => {
    drag({ itemId: 'S2', trackId: 'subtitle-track-1', startTime: 4, duration: 2, toStart: 1, targetTrackId: 'subtitle-track-1' });
    expect({ lane: lane('subtitle-track-1'), entries: get()._historyService.getActionCount() })
      .toEqual({ lane: [['S1', 0], ['S2', 2]], entries: 1 });
  });
});
