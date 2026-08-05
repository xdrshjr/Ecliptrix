/**
 * CompositionAdapter — camera-motion passthrough + wire conversion (spec §9.1).
 */

import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import { applyPreset } from '../../../playback/camera/cameraPresets';
import { insertKeyframeAt, setKeyframeComponent } from '../../../playback/camera/keyframes';
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

  // ── D38 at the assembly seam (review P2-7) ────────────────────────────────

  function wireFor(motion: unknown) {
    const sequences = adapter.extractVideoSequences(
      [track({ cameraMotion: motion })], materials,
    );
    return adapter.buildCompositionRequest(sequences, [], {}).video_sequences[0].camera_motion!;
  }

  it('emits NO keyframes key for a two-keyframe motion', () => {
    expect('keyframes' in wireFor(applyPreset('push-in', '2d'))).toBe(false);
  });

  it('emits an ascending snake_case curve when there is one', () => {
    const curved = setKeyframeComponent(
      insertKeyframeAt(applyPreset('orbit-left', '3d'), 0.4), 1, 'rotateY', 4,
    );
    const wire = wireFor(curved) as unknown as {
      keyframes: Array<Record<string, number | string | undefined>>;
      start: Record<string, number>;
      end: Record<string, number>;
    };
    expect(wire.keyframes).toHaveLength(3);
    expect(wire.keyframes.map((stop) => stop.at)).toEqual([0, 0.4, 1]);
    wire.keyframes.forEach((stop) => {
      expect(stop).toHaveProperty('rotate_y');
      expect(stop).not.toHaveProperty('rotateY');
    });
    expect(wire.keyframes[0].rotate_y).toBeCloseTo(wire.start.rotate_y, 9);
    expect(wire.keyframes[2].rotate_y).toBeCloseTo(wire.end.rotate_y, 9);
  });

  it('zeroes the 3D components inside a 2D curve as well', () => {
    const curved = insertKeyframeAt(applyPreset('push-in', '2d'), 0.5);
    const poisoned = {
      ...curved,
      keyframes: curved.keyframes!.map((stop, index) => (
        index === 1 ? { ...stop, rotateY: 30, dolly: 0.4 } : stop
      )),
    };
    const wire = wireFor(poisoned) as unknown as {
      keyframes: Array<Record<string, number>>;
    };
    expect(wire.keyframes[1].rotate_y).toBe(0);
    expect(wire.keyframes[1].dolly).toBe(0);
  });
});
