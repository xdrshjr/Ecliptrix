/**
 * Integration tests for the "auto-organize after every track operation"
 * behavior. Exercises the Zustand store end-to-end via orchestrated
 * actions and verifies that:
 *   - video/audio tracks are packed flush from 0 after each mutation,
 *   - subtitle tracks are never touched,
 *   - drag-commit paths (which previously bypassed history) now enter the
 *     undo stack and can be reversed in a single step.
 *
 * These tests drive the store through its public surface (the orchestrated
 * actions + slice methods), not component code, so they run in a
 * headless Node environment without touching the DOM.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimelineStore } from '../store';
import {
  addItemAction,
  removeItemAction,
  addTrackAction,
  removeTrackAction,
} from '../store';
import type { TimelineData, MaterialData } from '../domain';

function baseTimelineData(): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 10,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          { id: 'v-a', name: 'A', type: 'video', startTime: 0, duration: 3, trackId: 'video-track-1', color: '#4A90D9', volume: 1, opacity: 1 },
          { id: 'v-b', name: 'B', type: 'video', startTime: 10, duration: 2, trackId: 'video-track-1', color: '#4A90D9', volume: 1, opacity: 1 },
        ],
      },
      {
        id: 'audio-track-1', name: 'Audio 1', type: 'audio', height: 60,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [
          { id: 'a-1', name: 'A1', type: 'audio', startTime: 0, duration: 4, trackId: 'audio-track-1', color: '#27AE60', volume: 1 },
        ],
      },
      {
        id: 'subtitle-track-1', name: 'Subtitle 1', type: 'subtitle', height: 40,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 2,
        items: [
          { id: 's-1', name: 'S1', type: 'subtitle', startTime: 1.5, duration: 1, trackId: 'subtitle-track-1', color: '#E67E22', text: 'hello' },
        ],
      },
    ],
  };
}

function flushRaf(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('autoOrganize integration', () => {
  beforeEach(() => {
    useTimelineStore.getState().initTimeline(baseTimelineData());
    useTimelineStore.getState().clearHistory();
    // jsdom has rAF as a timer shim; stub with microtask for determinism.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0);
      return 0 as unknown as number;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useTimelineStore.getState().disposeDragActor();
  });

  it('pre-condition: fixture has a gap on video track (before any autoOrganize)', () => {
    const tracks = useTimelineStore.getState().tracks;
    const video = tracks.find(t => t.id === 'video-track-1')!;
    // gap between 3 and 10
    expect(video.items.map(i => i.startTime)).toEqual([0, 10]);
  });

  it('addItemAction packs video track flush from 0', async () => {
    const material: MaterialData = {
      id: 'm-add', name: 'NewMat', type: 'video', duration: 2,
    };
    addItemAction(() => useTimelineStore.getState(), 'video-track-1', material);

    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    // Original two items (durations 3,2) + new one (2) → flushed: 0,3,5 in some order
    expect(video.items.map(i => i.startTime).sort((x, y) => x - y)).toEqual([0, 3, 5]);
  });

  it('addItemAction leaves subtitle track untouched', async () => {
    const material: MaterialData = {
      id: 'm-add', name: 'NewMat', type: 'video', duration: 2,
    };
    addItemAction(() => useTimelineStore.getState(), 'video-track-1', material);

    const subtitle = useTimelineStore.getState().tracks.find(t => t.id === 'subtitle-track-1')!;
    expect(subtitle.items.map(i => i.startTime)).toEqual([1.5]);
  });

  it('removeItemAction closes the gap left behind', async () => {
    // Add a third video item then remove the middle one.
    const state = useTimelineStore.getState();
    state._aggregate.organizeVideoAudioTracks();
    state._syncDerivedState();
    // Now video is [0,3) [3,5). Remove v-a.
    removeItemAction(() => useTimelineStore.getState(), 'v-a');
    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    expect(video.items.map(i => i.startTime)).toEqual([0]);
    expect(video.items[0].id).toBe('v-b');
  });

  it('dropMaterial (dragSlice) triggers autoOrganize via orchestrated add', () => {
    const material: MaterialData = {
      id: 'm-drop', name: 'DroppedMat', type: 'video', duration: 1,
    };
    useTimelineStore.getState().dropMaterial('video-track-1', material);
    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    // 3 items: durations 3,2,1 packed flush
    expect(video.items.map(i => i.startTime).sort((x, y) => x - y)).toEqual([0, 3, 5]);
  });

  it('dropMaterial pushes an entry onto the undo stack (regression: no longer bypassed)', () => {
    const before = useTimelineStore.getState().canUndo;
    expect(before).toBe(false);
    const material: MaterialData = {
      id: 'm-drop2', name: 'DroppedMat', type: 'video', duration: 1,
    };
    useTimelineStore.getState().dropMaterial('video-track-1', material);
    expect(useTimelineStore.getState().canUndo).toBe(true);
  });

  it('addTrackAction keeps existing tracks packed', () => {
    addTrackAction(() => useTimelineStore.getState(), { type: 'video', baseTrackName: 'X' });
    // Existing video-track-1 items should now be packed (0, 3) — new track is empty.
    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    expect(video.items.map(i => i.startTime)).toEqual([0, 3]);
  });

  it('removeTrackAction leaves remaining video/audio tracks packed', () => {
    // Add a second video track first so removeTrackAction won't refuse
    // (can't remove the last track of a group).
    addTrackAction(() => useTimelineStore.getState(), { type: 'video', baseTrackName: 'X' });
    const state = useTimelineStore.getState();
    const newVideoTrack = state.tracks.find(t => t.id !== 'video-track-1' && t.type === 'video')!;
    const res = removeTrackAction(() => useTimelineStore.getState(), newVideoTrack.id);
    expect(res.ok).toBe(true);
    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    expect(video.items.map(i => i.startTime)).toEqual([0, 3]);
  });

  it('regression: full drag (preview + commit) Undo returns to pre-drag state, not drag-end state', async () => {
    // Pack the fixture once so the pre-drag baseline is well-defined and clear
    // any history. baseTimelineData puts v-a at 0 (dur 3) and v-b at 10 (dur 2);
    // after organize they become 0,3.
    useTimelineStore.getState()._aggregate.organizeVideoAudioTracks();
    useTimelineStore.getState()._syncDerivedState();
    useTimelineStore.getState().clearHistory();
    const beforeSnap = useTimelineStore.getState().exportToData();
    const store = useTimelineStore.getState();

    // Drive the real drag state machine through POINTER_DOWN → MOVE → UP.
    // zoomLevel = 1 → 50 px/sec; relativeX in the middle of a 150px item → move.
    store.startDrag({
      type: 'POINTER_DOWN',
      itemId: 'v-a',
      trackId: 'video-track-1',
      clientX: 0, clientY: 0,
      relativeX: 75,
      itemWidth: 150,
      originalStartTime: 0,
      originalDuration: 3,
      zoomLevel: 1,
      clipStart: 0,
      originalMediaDuration: 3,
    });
    // 1st POINTER_MOVE exits `detecting` → `dragging` via the exceedsThreshold
    // guard (moveThreshold=3). This transition has no actions so no preview
    // is computed yet. A second POINTER_MOVE in `dragging` runs
    // calculateMovePreview → `previewing` and triggers the updateDrag-side
    // aggregate mutation we need to regress.
    store.updateDrag({ type: 'POINTER_MOVE', clientX: 10, clientY: 0, deltaX: 10 });
    // deltaX=500 → +10s; preview.startTime = 10, autoOrganize later repacks v-b(0,2),v-a(2,3).
    store.updateDrag({ type: 'POINTER_MOVE', clientX: 500, clientY: 0, deltaX: 500 });
    store.endDrag({ type: 'POINTER_UP', clientX: 500, clientY: 0 });

    // Let the rAF-scheduled captureNextState fire.
    await flushRaf();

    // Drag committed: v-a and v-b swapped order via autoOrganize.
    const afterDrag = useTimelineStore.getState().exportToData();
    const videoAfter = afterDrag.tracks.find(t => t.id === 'video-track-1')!;
    expect(videoAfter.items.map(i => i.id)).toEqual(['v-b', 'v-a']);
    expect(videoAfter.items.map(i => i.startTime)).toEqual([0, 2]);

    // Undo: before the dragSlice rollback fix, the "before" snapshot captured
    // the already-preview-mutated aggregate, so undo produced the same state
    // as after the drag. With the fix in place, undo restores to beforeSnap.
    useTimelineStore.getState().undo();
    const afterUndo = useTimelineStore.getState().exportToData();
    expect(afterUndo.tracks).toEqual(beforeSnap.tracks);
  });

  it('drag-commit is now reversible with a single undo (regression for pre-existing history gap)', async () => {
    // Seed timeline with a packed video track so our move target is well-defined.
    useTimelineStore.getState()._aggregate.organizeVideoAudioTracks();
    useTimelineStore.getState()._syncDerivedState();
    // Snapshot the state we expect to return to after undo.
    const beforeSnap = useTimelineStore.getState().exportToData();

    // Simulate a drag commit by dispatching the same sequence ensureDragActor
    // produces: record → mutate → autoOrganize → rAF(capture).
    const state = useTimelineStore.getState();
    state.recordAction('MOVE_ITEM', { itemId: 'v-a', newStartTime: 50 });
    state.moveItem('v-a', 50, false);
    state.autoOrganize();
    await flushRaf();
    useTimelineStore.getState().captureNextState();

    // Undo should roll us back to beforeSnap, byte-for-byte for the tracks.
    useTimelineStore.getState().undo();
    const afterUndo = useTimelineStore.getState().exportToData();
    expect(afterUndo.tracks).toEqual(beforeSnap.tracks);
  });

  it('locked video track is not organized', () => {
    // Lock video-track-1
    useTimelineStore.getState().toggleTrackLock('video-track-1');
    // Add to audio track → autoOrganize runs but should skip the locked video
    const material: MaterialData = { id: 'm-a', name: 'Audio', type: 'audio', duration: 2 };
    addItemAction(() => useTimelineStore.getState(), 'audio-track-1', material);
    const video = useTimelineStore.getState().tracks.find(t => t.id === 'video-track-1')!;
    // Still has the gap from the fixture
    expect(video.items.map(i => i.startTime)).toEqual([0, 10]);
  });

  it('performance: 100 items on a track pack in under 50 ms (soft budget)', () => {
    // Build a fresh track with 100 items with random offsets.
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: `perf-item-${i}`, name: `p${i}`, type: 'video' as const,
      startTime: Math.random() * 1000, duration: 1 + Math.random() * 2,
      trackId: 'perf-track', color: '#4A90D9', volume: 1, opacity: 1,
    }));
    useTimelineStore.getState().initTimeline({
      ...baseTimelineData(),
      tracks: [{
        id: 'perf-track', name: 'Perf', type: 'video', height: 80,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items,
      }],
    });
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) {
      useTimelineStore.getState().autoOrganize();
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});
