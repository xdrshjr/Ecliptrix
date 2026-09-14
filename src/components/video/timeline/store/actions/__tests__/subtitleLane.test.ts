/**
 * @vitest-environment node
 *
 * TL3-04: hand edits on the subtitle lane never create overlapping captions.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { moveItemAction } from '../moveItem';
import { resizeItemAction } from '../resizeItem';
import type { TimelineData, TimelineItemData } from '../../../domain';

const get = () => useTimelineStore.getState();

function caption(id: string, startTime: number, duration: number): TimelineItemData {
  return {
    id, name: id, type: 'subtitle', startTime, duration, trackId: 'subtitle-track-1',
    color: '#f59e0b', text: id,
  };
}

function timelineWith(items: TimelineItemData[]): TimelineData {
  return {
    currentTime: 0, totalDuration: 6, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'subtitle-track-1', name: 'Subtitles', type: 'subtitle', height: 40,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items,
    }],
  };
}

const spans = () => get().tracks[0].items.map((item) => [item.id, item.startTime, item.duration]);

beforeEach(() => {
  get().setExternalEditLock(null);
});

describe('subtitle lane edits', () => {
  it('trimming a subtitle past the next caption stops at its start', () => {
    get().initTimeline(timelineWith([caption('S1', 0, 1), caption('S2', 2, 2)]));
    get().clearHistory();
    resizeItemAction(get, 'S1', 'end', 3);
    expect(spans()).toEqual([['S1', 0, 2], ['S2', 2, 2]]);
  });

  it('moving a subtitle onto another caption is refused without history', () => {
    // The only gap that holds S1 is its own slot, so it stays where it is.
    get().initTimeline(timelineWith([caption('S1', 0, 2), caption('S2', 2, 2), caption('S3', 4, 2)]));
    get().clearHistory();
    moveItemAction(get, 'S1', 2.8);
    expect({ spans: spans(), canUndo: get().canUndo }).toEqual({
      spans: [['S1', 0, 2], ['S2', 2, 2], ['S3', 4, 2]],
      canUndo: false,
    });
  });
});
