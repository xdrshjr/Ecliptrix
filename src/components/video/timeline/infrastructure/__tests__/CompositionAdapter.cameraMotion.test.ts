/**
 * CompositionAdapter — camera-motion passthrough (timeline-camera-motion §1.3).
 *
 * Both halves matter and they are separate code paths:
 *   - `extractVideoSequences` feeds the PREVIEW compositor;
 *   - `buildCompositionRequest` feeds the EXPORT backend.
 * Wiring only the first is the classic "preview has the effect, the exported
 * file does not" failure (L2), so each is asserted independently.
 *
 * The no-motion case is asserted field-by-field against the pre-feature payload
 * shape: M5 requires that a timeline without camera motion produces the exact
 * request it produced before this feature existed.
 */

import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import type { CompositionMaterialData } from '../CompositionAdapter';
import type { TrackData, CameraMotionData } from '../../domain/types';
import { motionFromPreset } from '../../../playback';

const MOTION = motionFromPreset('orbit-left') as unknown as CameraMotionData;

function videoTrack(cameraMotion?: CameraMotionData): TrackData {
  return {
    id: 't1', name: 'V1', type: 'video', isVisible: true, isLocked: false,
    isMuted: false, volume: 100, height: 60, order: 0,
    items: [
      {
        id: 'item-1', name: 'clip', type: 'video', startTime: 0, duration: 5,
        trackId: 't1', materialId: 'm1', color: '#4A90D9',
        clipStart: 0, clipEnd: 5, originalDuration: 5, volume: 1,
        cameraMotion,
      },
    ],
  };
}

const MAT: CompositionMaterialData = {
  id: 'm1', name: 'sample.mp4', type: 'video', duration: 5,
  url: '/api/storage/files/uploads/video/sample.mp4',
};

describe('CompositionAdapter camera-motion passthrough', () => {
  it('carries the motion onto the preview sequence verbatim', () => {
    const adapter = new CompositionAdapter();
    const [seq] = adapter.extractVideoSequences([videoTrack(MOTION)], [MAT as never]);
    expect(seq.cameraMotion).toEqual(MOTION);
  });

  it('maps the motion onto the export request in the wire shape', () => {
    const adapter = new CompositionAdapter();
    const seqs = adapter.extractVideoSequences([videoTrack(MOTION)], [MAT as never]);
    const request = adapter.buildCompositionRequest(seqs, [], { taskId: 'task-1' });
    const wire = request.video_sequences[0].camera_motion;

    expect(wire).toBeDefined();
    expect(wire?.preset_id).toBe('orbit-left');
    expect(wire?.space).toBe('3d');
    // `from` is a Python keyword, so the wire names differ from the frontend's.
    // Getting this mapping wrong yields a 422 rather than a silent miss, but the
    // per-field assertions keep the two models pinned together.
    expect(wire?.from_state.yaw).toBeCloseTo(MOTION.from.yaw, 9);
    expect(wire?.to_state.yaw).toBeCloseTo(MOTION.to.yaw, 9);
    expect(wire?.from_state.offset_x).toBeCloseTo(MOTION.from.offsetX, 9);
    expect(wire?.to_state.offset_y).toBeCloseTo(MOTION.to.offsetY, 9);
    expect(wire?.start_ratio).toBe(MOTION.startRatio);
    expect(wire?.end_ratio).toBe(MOTION.endRatio);
    expect(wire?.intensity).toBe(MOTION.intensity);
    expect(wire?.easing).toBe(MOTION.easing);
  });

  it('omits the field entirely without a motion (M5 payload parity)', () => {
    const adapter = new CompositionAdapter();
    const seqs = adapter.extractVideoSequences([videoTrack(undefined)], [MAT as never]);
    expect(seqs[0].cameraMotion).toBeUndefined();

    const request = adapter.buildCompositionRequest(seqs, [], { taskId: 'task-1' });
    const item = request.video_sequences[0];
    expect(item.camera_motion).toBeUndefined();
    expect(Object.keys(item).sort()).toEqual(
      [
        'camera_motion', 'clip_end', 'clip_start', 'duration', 'id', 'name',
        'opacity', 'original_duration', 'start_time', 'track_z',
        'transition_in', 'transition_out', 'url', 'volume', 'audio_detached',
      ].sort(),
    );
  });
});
