/**
 * @vitest-environment node
 *
 * TL3-06: the camera-motion action re-checks eligibility in the store, so a
 * track locked while the panel was open still refuses the write.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { setCameraMotionAction } from '../setCameraMotion';
import type { CameraMotionData, TimelineData, TrackData } from '../../../domain';

const get = () => useTimelineStore.getState();

const KEYFRAME = { scale: 1.2, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 };
const MOTION: CameraMotionData = {
  version: 1, mode: '2d', presetId: 'custom', intensity: 1, easing: 'linear',
  start: KEYFRAME, end: { ...KEYFRAME, scale: 1.5 },
};

function videoTrack(id: string, order: number, clipId: string, isLocked: boolean): TrackData {
  return {
    id, name: id, type: 'video', height: 80, isLocked, isMuted: false, isVisible: true,
    volume: 100, order,
    items: [{
      id: clipId, name: clipId, type: 'video', startTime: 0, duration: 4, trackId: id,
      color: '#3b82f6', materialId: `m-${clipId}`, clipStart: 0, clipEnd: 4, originalDuration: 4,
    }],
  };
}

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [videoTrack('video-track-1', 0, 'v1', true), videoTrack('video-track-2', 1, 'v2', false)],
  };
}

const motionOf = (clipId: string) =>
  get().tracks.flatMap((track) => track.items).find((item) => item.id === clipId)?.cameraMotion ?? null;

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

describe('setCameraMotionAction on locked tracks', () => {
  it('camera motion is not written to a clip on a locked track', () => {
    const applied = setCameraMotionAction(get, ['v1'], MOTION);
    expect({ applied, motion: motionOf('v1'), canUndo: get().canUndo }).toEqual({
      applied: false, motion: null, canUndo: false,
    });
  });

  it('an eligible clip in the same batch still receives the motion', () => {
    setCameraMotionAction(get, ['v1', 'v2'], MOTION);
    expect({ locked: motionOf('v1'), eligible: motionOf('v2') }).toEqual({ locked: null, eligible: MOTION });
  });
});
