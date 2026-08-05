/**
 * assembleLayers — camera motion attachment (spec §9.1 "层装配").
 */

import { describe, it, expect } from 'vitest';
import { buildVideoLayers, type ActiveVideoEntry } from '../internal/assembleLayers';
import { applyPreset } from '../camera/cameraPresets';
import { _clearCameraConstantsCache } from '../camera/cameraGeometry';
import type { VideoSequenceItem } from '../../types';

function clip(overrides: Partial<VideoSequenceItem> = {}): VideoSequenceItem {
  return {
    id: 'clip-1',
    name: 'clip',
    url: '/api/storage/files/a.mp4',
    startTime: 4,
    duration: 6,
    trackId: 'video-1',
    ...overrides,
  };
}

function entry(overrides: Partial<ActiveVideoEntry> = {}): ActiveVideoEntry {
  return {
    trackId: 'video-1',
    z: 0,
    source: { readyState: 4, videoWidth: 1920, videoHeight: 1080 },
    clip: clip(),
    ...overrides,
  };
}

describe('buildVideoLayers — camera', () => {
  it('leaves `camera` undefined when the clip has no motion (fast path)', () => {
    const [layer] = buildVideoLayers([entry()], 5);
    expect(layer.camera).toBeUndefined();
  });

  it('resolves the motion at CLIP-LOCAL time, not composition time', () => {
    _clearCameraConstantsCache();
    // Clip starts at t=4 with a 2s window; at composition t=5 the clip-local
    // time is 1s → u = 0.5.
    const motion = { ...applyPreset('push-in', '2d'), easing: 'linear' as const, duration: 2 };
    const [layer] = buildVideoLayers([entry({ clip: clip({ cameraMotion: motion }) })], 5);
    expect(layer.camera).toBeDefined();
    // scale 1 → 1.25 linear at u=0.5 → 1.125 → crop width 1/1.125.
    expect(layer.camera!.crop.w).toBeCloseTo(1 / 1.125, 6);
  });

  it('skips the motion when the source has no intrinsic size yet (P1-1)', () => {
    _clearCameraConstantsCache();
    const motion = applyPreset('push-in', '2d');
    const [layer] = buildVideoLayers(
      [entry({
        source: { readyState: 1 },
        clip: clip({ cameraMotion: motion }),
      })],
      5,
    );
    // No aspect → no guessing → draw without motion for this frame.
    expect(layer.camera).toBeUndefined();
  });

  it('keeps opacity independent of the motion', () => {
    _clearCameraConstantsCache();
    const motion = applyPreset('push-in', '2d');
    const [layer] = buildVideoLayers(
      [entry({ clip: clip({ cameraMotion: motion, opacity: 0.4 }) })],
      5,
    );
    expect(layer.opacity).toBeCloseTo(0.4, 6);
    expect(layer.camera).toBeDefined();
  });

  it('holds at the start keyframe before the window opens', () => {
    _clearCameraConstantsCache();
    const motion = { ...applyPreset('push-in', '2d'), startOffset: 2, duration: 2 };
    const [layer] = buildVideoLayers([entry({ clip: clip({ cameraMotion: motion }) })], 4.5);
    expect(layer.camera!.crop.w).toBeCloseTo(1, 6);
  });
});
