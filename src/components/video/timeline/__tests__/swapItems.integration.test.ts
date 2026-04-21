/**
 * Integration tests for the drag-to-swap feature wired through the
 * Zustand store.
 *
 * The drag state machine (XState) is difficult to drive without a real
 * DOM, so the tests here focus on the slice-level behavior that
 * downstream UI code relies on:
 *   - swapItems action records a SWAP_ITEMS history entry and the
 *     undo path reverts cleanly.
 *   - DragCalculationService.findSwapTarget returns what the slice
 *     would put into swapTargetItemId.
 *   - subtitle / locked / cross-track combinations refuse the swap.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimelineStore } from '../store';
import { swapItemsAction } from '../store';
import { DragCalculationService } from '../domain';
import type { TimelineData } from '../domain';

function baseData(): TimelineData {
  return {
    currentTime: 0, totalDuration: 10, zoomLevel: 1, playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1', name: 'V1', type: 'video', height: 80,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          { id: 'v-a', name: 'A', type: 'video', startTime: 0, duration: 3, trackId: 'video-track-1', color: '#4A90D9', volume: 1, opacity: 1 },
          { id: 'v-b', name: 'B', type: 'video', startTime: 3, duration: 4, trackId: 'video-track-1', color: '#4A90D9', volume: 1, opacity: 1 },
          { id: 'v-c', name: 'C', type: 'video', startTime: 7, duration: 2, trackId: 'video-track-1', color: '#4A90D9', volume: 1, opacity: 1 },
        ],
      },
      {
        id: 'video-track-2', name: 'V2', type: 'video', height: 80,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [
          { id: 'v2-x', name: 'X', type: 'video', startTime: 0, duration: 5, trackId: 'video-track-2', color: '#4A90D9', volume: 1, opacity: 1 },
        ],
      },
      {
        id: 'subtitle-track-1', name: 'S1', type: 'subtitle', height: 40,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 2,
        items: [
          { id: 's-1', name: 'S', type: 'subtitle', startTime: 0, duration: 3, trackId: 'subtitle-track-1', color: '#E67E22', text: 'hi' },
          { id: 's-2', name: 'T', type: 'subtitle', startTime: 3, duration: 3, trackId: 'subtitle-track-1', color: '#E67E22', text: 'there' },
        ],
      },
    ],
  };
}

describe('swap integration', () => {
  beforeEach(() => {
    useTimelineStore.getState().initTimeline(baseData());
    useTimelineStore.getState().clearHistory();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0);
      return 0 as unknown as number;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useTimelineStore.getState().disposeDragActor();
  });

  it('swapItemsAction: A↔B startTimes exchange and autoOrganize closes any gap', async () => {
    swapItemsAction(() => useTimelineStore.getState(), 'v-a', 'v-c');
    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    // durations a=3, b=4, c=2 → after swap a has startTime 7, c has 0.
    // autoOrganize then repacks in startTime order: c(2), b(4), a(3)
    expect(video.items.map(i => i.id)).toEqual(['v-c', 'v-b', 'v-a']);
    expect(video.items.map(i => i.startTime)).toEqual([0, 2, 6]);
  });

  it('swapItemsAction records a SWAP_ITEMS entry and undo reverts cleanly', async () => {
    const beforeSnap = useTimelineStore.getState().exportToData();
    swapItemsAction(() => useTimelineStore.getState(), 'v-a', 'v-c');
    await new Promise(r => setTimeout(r, 5));

    expect(useTimelineStore.getState().canUndo).toBe(true);
    const history = useTimelineStore.getState()._historyService.getHistory();
    expect(history[history.length - 1].type).toBe('SWAP_ITEMS');

    useTimelineStore.getState().undo();
    const after = useTimelineStore.getState().exportToData();
    expect(after.tracks).toEqual(beforeSnap.tracks);
  });

  it('redo restores the swapped state', async () => {
    swapItemsAction(() => useTimelineStore.getState(), 'v-a', 'v-c');
    await new Promise(r => setTimeout(r, 5));
    const swappedSnap = useTimelineStore.getState().exportToData();
    useTimelineStore.getState().undo();
    useTimelineStore.getState().redo();
    expect(useTimelineStore.getState().exportToData().tracks).toEqual(swappedSnap.tracks);
  });

  it('no-op when passed identical ids', () => {
    swapItemsAction(() => useTimelineStore.getState(), 'v-a', 'v-a');
    // canUndo should remain false — no history entry created.
    expect(useTimelineStore.getState().canUndo).toBe(false);
  });

  it('cross-track candidates are not considered hits by findSwapTarget', () => {
    const tracks = useTimelineStore.getState().tracks;
    // Dragged is v-a (track 1); v2-x sits on track 2. Preview center 2 → inside v2-x center band but wrong track.
    const hit = DragCalculationService.findSwapTarget(tracks, 'v-a', { startTime: 1, duration: 2 });
    expect(hit).not.toBe('v2-x');
  });

  it('subtitle track is never a swap target', () => {
    const tracks = useTimelineStore.getState().tracks;
    const hit = DragCalculationService.findSwapTarget(tracks, 's-1', { startTime: 3, duration: 3 });
    expect(hit).toBeNull();
  });

  it('locked track is never a swap source', () => {
    useTimelineStore.getState().toggleTrackLock('video-track-1');
    const tracks = useTimelineStore.getState().tracks;
    const hit = DragCalculationService.findSwapTarget(tracks, 'v-a', { startTime: 4, duration: 2 });
    expect(hit).toBeNull();
  });

  it('findSwapTarget returns null for single-item track', () => {
    const tracks = useTimelineStore.getState().tracks;
    const hit = DragCalculationService.findSwapTarget(tracks, 'v2-x', { startTime: 2, duration: 2 });
    expect(hit).toBeNull();
  });
});
