/**
 * CompositionAdapter — camera-motion passthrough + wire conversion (spec §9.1).
 */

import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import { applyPreset } from '../../../playback/camera/cameraPresets';
import type { TrackData, MaterialData } from '../../domain/types';

const adapter = new CompositionAdapter();

function track(itemOverrides: Record<string, unknown> = {}): TrackData {
  return {
    id: 'video-1',
    name: 'Video 1',
    type: 'video',
    height: 60,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 0,
    items: [
      {
        id: 'item-1',
        name: 'clip.mp4',
        type: 'video',
        startTime: 0,
        duration: 6,
        trackId: 'video-1',
        color: '#4A90D9',
        materialId: 'mat-1',
        clipStart: 0,
        clipEnd: 6,
        originalDuration: 6,
        ...itemOverrides,
      },
    ],
  } as TrackData;
}

const materials = [
  {
    id: 'mat-1',
    name: 'clip.mp4',
    type: 'video',
    url: '/api/storage/files/clip.mp4',
    serverUrl: '/api/storage/files/clip.mp4',
  } as unknown as MaterialData,
];

describe('extractVideoSequences — camera motion', () => {
  it('omits the field when the clip has no motion', () => {
    const [seq] = adapter.extractVideoSequences([track()], materials);
    expect(seq.cameraMotion).toBeUndefined();
  });

  it('forwards the motion verbatim', () => {
    const motion = applyPreset('orbit-left', '3d');
    const [seq] = adapter.extractVideoSequences([track({ cameraMotion: motion })], materials);
    expect(seq.cameraMotion).toEqual(motion);
  });
});

describe('buildCompositionRequest — camera_motion wire', () => {
  it('omits camera_motion for a clip without a motion', () => {
    const sequences = adapter.extractVideoSequences([track()], materials);
    const request = adapter.buildCompositionRequest(sequences, [], {});
    expect(request.video_sequences[0].camera_motion).toBeUndefined();
  });

  it('snake_cases every field, including the 3D components', () => {
    const motion = applyPreset('orbit-left', '3d');
    const sequences = adapter.extractVideoSequences([track({ cameraMotion: motion })], materials);
    const request = adapter.buildCompositionRequest(sequences, [], {});
    const wire = request.video_sequences[0].camera_motion!;

    expect(wire.version).toBe(1);
    expect(wire.mode).toBe('3d');
    expect(wire.preset_id).toBe('orbit-left');
    expect(wire.easing).toBe('easeInOut');
    expect(wire.start.rotate_y).toBeCloseTo(10, 6);
    expect(wire.end.rotate_y).toBeCloseTo(-10, 6);
    expect(wire.start).not.toHaveProperty('rotateY');
  });

  it('zeroes the 3D components on a 2D motion so export never sees a stale angle', () => {
    const motion = { ...applyPreset('push-in', '2d'), start: { ...applyPreset('push-in', '2d').start, rotateY: 30 } };
    const sequences = adapter.extractVideoSequences([track({ cameraMotion: motion })], materials);
    const wire = adapter.buildCompositionRequest(sequences, [], {}).video_sequences[0].camera_motion!;
    expect(wire.start.rotate_y).toBe(0);
    expect(wire.start.dolly).toBe(0);
  });

  it('clamps an out-of-range value before it reaches an FFmpeg expression', () => {
    const base = applyPreset('push-in', '2d');
    const motion = { ...base, intensity: 99, end: { ...base.end, scale: 99 } };
    const sequences = adapter.extractVideoSequences([track({ cameraMotion: motion })], materials);
    const wire = adapter.buildCompositionRequest(sequences, [], {}).video_sequences[0].camera_motion!;
    expect(wire.intensity).toBe(2);
    expect(wire.end.scale).toBe(4);
  });
});
