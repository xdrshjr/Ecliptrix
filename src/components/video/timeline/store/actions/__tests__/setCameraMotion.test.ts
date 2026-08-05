/**
 * Integration tests for the camera-motion orchestrated action.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §7.5.
 *
 * Drives the real Zustand store: applying a motion must be exactly ONE undo
 * step, removal must round-trip, and the ineligible cases (locked track,
 * non-video item, unchanged value) must not litter the history with entries
 * that undo to an identical state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimelineStore } from '../../useTimelineStore';
import { setCameraMotionAction } from '../setCameraMotion';
import { motionFromPreset } from '../../../../playback';
import type { CameraMotionData, TimelineData } from '../../../domain';

function baseData(locked = false): TimelineData {
  return {
    currentTime: 0, totalDuration: 6, zoomLevel: 1, playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1', name: 'V1', type: 'video', height: 80,
        isLocked: locked, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          {
            id: 'v-a', name: 'A', type: 'video', startTime: 0, duration: 4,
            trackId: 'video-track-1', color: '#4A90D9', materialId: 'mat-1',
            clipStart: 0, clipEnd: 4, originalDuration: 10, volume: 1, opacity: 1,
          },
        ],
      },
      {
        id: 'audio-track-1', name: 'A1', type: 'audio', height: 60,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [
          {
            id: 'a-a', name: 'Aud', type: 'audio', startTime: 0, duration: 4,
            trackId: 'audio-track-1', color: '#27AE60', materialId: 'mat-2',
            volume: 1, opacity: 1,
          },
        ],
      },
    ],
  };
}

const zoomIn = () => motionFromPreset('zoom-in') as unknown as CameraMotionData;

function findItem(id: string) {
  for (const track of useTimelineStore.getState().tracks) {
    const hit = track.items.find((item) => item.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Let the rAF-deferred `captureNextState` land before asserting on history. */
async function flushCapture(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('setCameraMotionAction', () => {
  beforeEach(() => {
    useTimelineStore.getState().initTimeline(baseData());
    useTimelineStore.getState().clearHistory();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0 as unknown as number;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the motion to the item', () => {
    expect(setCameraMotionAction(() => useTimelineStore.getState(), 'v-a', zoomIn())).toBe(true);
    expect(findItem('v-a')?.cameraMotion?.presetId).toBe('zoom-in');
  });

  it('collapses one apply into one undo step', async () => {
    setCameraMotionAction(() => useTimelineStore.getState(), 'v-a', zoomIn());
    await flushCapture();

    expect(useTimelineStore.getState().canUndo).toBe(true);
    useTimelineStore.getState().undo();
    expect(findItem('v-a')?.cameraMotion).toBeUndefined();

    useTimelineStore.getState().redo();
    expect(findItem('v-a')?.cameraMotion?.presetId).toBe('zoom-in');
  });

  it('removes a motion with null and undoes back to the previous one', async () => {
    setCameraMotionAction(() => useTimelineStore.getState(), 'v-a', zoomIn());
    await flushCapture();
    expect(setCameraMotionAction(() => useTimelineStore.getState(), 'v-a', null)).toBe(true);
    await flushCapture();
    expect(findItem('v-a')?.cameraMotion).toBeUndefined();

    useTimelineStore.getState().undo();
    expect(findItem('v-a')?.cameraMotion?.presetId).toBe('zoom-in');
  });

  it('records no history when the value is unchanged', async () => {
    setCameraMotionAction(() => useTimelineStore.getState(), 'v-a', zoomIn());
    await flushCapture();
    const historyLength = useTimelineStore.getState()._historyService.getHistory().length;

    // Re-applying the identical motion must be inert: otherwise a user who
    // reopens the panel and clicks Apply burns an undo step that changes
    // nothing, and Ctrl+Z appears not to work.
    expect(setCameraMotionAction(() => useTimelineStore.getState(), 'v-a', zoomIn())).toBe(false);
    await flushCapture();
    expect(useTimelineStore.getState()._historyService.getHistory().length).toBe(historyLength);
  });

  it('rejects a locked track', async () => {
    useTimelineStore.getState().initTimeline(baseData(true));
    useTimelineStore.getState().clearHistory();

    expect(setCameraMotionAction(() => useTimelineStore.getState(), 'v-a', zoomIn())).toBe(false);
    expect(findItem('v-a')?.cameraMotion).toBeUndefined();
    await flushCapture();
    expect(useTimelineStore.getState()._historyService.getHistory().length).toBe(0);
  });

  it('rejects a non-video item — audio has no frame to move', () => {
    expect(setCameraMotionAction(() => useTimelineStore.getState(), 'a-a', zoomIn())).toBe(false);
    expect(findItem('a-a')?.cameraMotion).toBeUndefined();
  });

  it('rejects an unknown item id without throwing', () => {
    expect(setCameraMotionAction(() => useTimelineStore.getState(), 'nope', zoomIn())).toBe(false);
  });

  it('survives a snapshot round-trip through the aggregate', () => {
    // The entity — not just the DTO — has to carry the field, or the motion is
    // lost the first time the store re-serializes (which the composition
    // adapter triggers on every preview refresh).
    setCameraMotionAction(() => useTimelineStore.getState(), 'v-a', zoomIn());
    const snapshot = JSON.parse(JSON.stringify(useTimelineStore.getState().tracks));
    useTimelineStore.getState().initTimeline({ ...baseData(), tracks: snapshot });
    expect(findItem('v-a')?.cameraMotion?.presetId).toBe('zoom-in');
  });
});
