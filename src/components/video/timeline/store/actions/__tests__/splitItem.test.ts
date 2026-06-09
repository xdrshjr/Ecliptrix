/**
 * Integration tests for the split orchestrated action (spec 01 §2.3 / §6 #4).
 *
 * Drives the real Zustand store: a playhead split fans out to every visible,
 * unlocked item the cursor sits inside, recorded as ONE history entry; undo
 * restores the pre-split timeline exactly and redo re-applies the split.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimelineStore } from '../../useTimelineStore';
import { splitAction } from '../splitItem';
import type { TimelineData } from '../../../domain';

function baseData(): TimelineData {
  return {
    currentTime: 0, totalDuration: 12, zoomLevel: 1, playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1', name: 'V1', type: 'video', height: 80,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          {
            id: 'v-a', name: 'A', type: 'video', startTime: 0, duration: 6,
            trackId: 'video-track-1', color: '#4A90D9',
            clipStart: 0, clipEnd: 6, originalDuration: 6, volume: 1, opacity: 1,
          },
        ],
      },
      {
        id: 'audio-track-1', name: 'A1', type: 'audio', height: 60,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [
          {
            id: 'a-a', name: 'Asnd', type: 'audio', startTime: 0, duration: 6,
            trackId: 'audio-track-1', color: '#10b981',
            clipStart: 0, clipEnd: 6, originalDuration: 6, volume: 1, opacity: 1,
          },
        ],
      },
      {
        id: 'video-track-2', name: 'V2', type: 'video', height: 80,
        isLocked: true, isMuted: false, isVisible: true, volume: 100, order: 2,
        items: [
          {
            id: 'v-locked', name: 'L', type: 'video', startTime: 0, duration: 6,
            trackId: 'video-track-2', color: '#4A90D9',
            clipStart: 0, clipEnd: 6, originalDuration: 6, volume: 1, opacity: 1,
          },
        ],
      },
    ],
  };
}

describe('splitAction', () => {
  beforeEach(() => {
    useTimelineStore.getState().initTimeline(baseData());
    useTimelineStore.getState().clearHistory();
    useTimelineStore.getState().deselectAll();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0);
      return 0 as unknown as number;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('playhead scope cuts every visible unlocked item under the cursor', () => {
    splitAction(() => useTimelineStore.getState(), 3, 'playhead');

    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    const audio = useTimelineStore.getState().tracks.find(t => t.id === 'audio-track-1')!;
    expect(video.items.length).toBe(2);
    expect(audio.items.length).toBe(2);
    // Left half keeps original id, duration 3, clip [0,3].
    const left = video.items.find(i => i.id === 'v-a')!;
    expect(left.duration).toBe(3);
    expect(left.clipEnd).toBe(3);
  });

  it('does not split items on a locked track', () => {
    splitAction(() => useTimelineStore.getState(), 3, 'playhead');
    const locked = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-2')!;
    expect(locked.items.length).toBe(1);
  });

  it('records exactly one SPLIT_ITEM history entry for a multi-item cut', () => {
    splitAction(() => useTimelineStore.getState(), 3, 'playhead');
    const history = useTimelineStore.getState()._historyService.getHistory();
    expect(history.length).toBe(1);
    expect(history[history.length - 1].type).toBe('SPLIT_ITEM');
  });

  it('undo restores the pre-split timeline exactly; redo re-applies', async () => {
    const before = useTimelineStore.getState().exportToData();
    splitAction(() => useTimelineStore.getState(), 3, 'playhead');
    await new Promise(r => setTimeout(r, 5));
    const afterSplit = useTimelineStore.getState().exportToData();

    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().exportToData().tracks).toEqual(before.tracks);

    useTimelineStore.getState().redo();
    expect(useTimelineStore.getState().exportToData().tracks).toEqual(afterSplit.tracks);
  });

  it('no-op (no history) when the cut hits no item', () => {
    splitAction(() => useTimelineStore.getState(), 50, 'playhead');
    expect(useTimelineStore.getState().canUndo).toBe(false);
    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    expect(video.items.length).toBe(1);
  });

  it('selected scope only cuts selected items', () => {
    useTimelineStore.getState().selectItem('v-a');
    splitAction(() => useTimelineStore.getState(), 3, 'selected');
    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    const audio = useTimelineStore.getState().tracks.find(t => t.id === 'audio-track-1')!;
    expect(video.items.length).toBe(2);
    expect(audio.items.length).toBe(1);
  });
});
