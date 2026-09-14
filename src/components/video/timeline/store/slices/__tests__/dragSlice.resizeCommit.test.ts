/**
 * @vitest-environment node
 *
 * TL2-02: a trim drag must commit through resizeItemAction so an explicit
 * camera-motion window travels with the trimmed in-point, exactly like the
 * toolbar / agent resize paths.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import type { CameraMotionData, PointerDownEvent, TimelineData } from '../../../domain';

const get = () => useTimelineStore.getState();

const KEYFRAME = { scale: 1.2, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 };

const MOTION: CameraMotionData = {
  version: 1,
  mode: '2d',
  presetId: 'custom',
  intensity: 1,
  easing: 'linear',
  startOffset: 0,
  duration: 2,
  start: KEYFRAME,
  end: { ...KEYFRAME, scale: 1.5 },
};

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80, isLocked: false,
      isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'clip-1', name: 'Clip', type: 'video', startTime: 0, duration: 4,
        trackId: 'video-track-1', color: '#3b82f6', materialId: 'material-1',
        clipStart: 1, clipEnd: 5, originalDuration: 10, cameraMotion: MOTION,
      }],
    }],
  };
}

/** Press on the left trim handle (relativeX 2 of a 200px clip). */
function pressLeftEdge(): void {
  const event: PointerDownEvent = {
    type: 'POINTER_DOWN', itemId: 'clip-1', trackId: 'video-track-1', clientX: 2, clientY: 10,
    relativeX: 2, itemWidth: 200, originalStartTime: 0, originalDuration: 4, zoomLevel: 1,
    clipStart: 1, clipEnd: 5, originalMediaDuration: 10,
  };
  get().startDrag(event);
}

function move(deltaX: number): void {
  get().updateDrag({ type: 'POINTER_MOVE', clientX: 2 + deltaX, clientY: 10, deltaX });
}

const theClip = () => get().tracks[0].items[0];

beforeEach(() => {
  get().disposeDragActor();
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => {
  get().disposeDragActor();
});

describe('trim drag commit', () => {
  it('a left-edge trim drag shifts an explicit camera-motion window by the trim delta', () => {
    pressLeftEdge();
    move(50); // 50px at zoom 1 = 1 s
    get().endDrag({ type: 'POINTER_UP', clientX: 52, clientY: 10 });
    expect({
      clipStart: theClip().clipStart,
      startOffset: theClip().cameraMotion?.startOffset,
    }).toEqual({ clipStart: 2, startOffset: -1 });
  });

  it('a zero-delta trim records no history', () => {
    pressLeftEdge();
    move(50);
    move(0);
    get().endDrag({ type: 'POINTER_UP', clientX: 2, clientY: 10 });
    expect({ canUndo: get().canUndo, interacting: get().isInteracting }).toEqual({
      canUndo: false,
      interacting: false,
    });
  });
});
