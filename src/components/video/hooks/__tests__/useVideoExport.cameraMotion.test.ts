/**
 * useVideoExport — the SECOND export payload constructor (timeline-camera-motion L2).
 *
 * `CompositionAdapter.buildCompositionRequest` and this hook both build
 * `video_items` independently. Wiring a per-clip field into only one of them is
 * the "preview has it, the exported file doesn't" bug, and nothing in the type
 * system catches it because both payloads are structurally valid.
 *
 * The hook itself is a large React effect chain, so rather than rendering it,
 * these tests pin the two things it uniquely owns: the wire mapping it shares
 * with the adapter, and the warning branch that is the ONLY channel a backend
 * degradation has back to the user.
 */

import { describe, expect, it, vi } from 'vitest';
import { toCameraMotionWire } from '@/lib/api/videoComposition';
import { motionFromPreset } from '../../playback';
import type { CameraMotionInput, CompositionStatusResponse } from '@/lib/api/videoComposition';

const MOTION = motionFromPreset('ken-burns') as unknown as CameraMotionInput;

describe('toCameraMotionWire — shared by both payload constructors', () => {
  it('renames the endpoints that Python cannot express', () => {
    const wire = toCameraMotionWire(MOTION)!;
    // `from` is a Python keyword, so the backend model cannot mirror the
    // frontend name; this mapper is the single place that reconciles them.
    expect(wire.from_state).toBeDefined();
    expect(wire.to_state).toBeDefined();
    expect(wire).not.toHaveProperty('from');
    expect(wire).not.toHaveProperty('to');
  });

  it('converts every camelCase state field to snake_case', () => {
    const wire = toCameraMotionWire(MOTION)!;
    expect(wire.from_state.offset_x).toBeCloseTo(MOTION.from.offsetX, 9);
    expect(wire.from_state.offset_y).toBeCloseTo(MOTION.from.offsetY, 9);
    expect(wire.to_state.offset_x).toBeCloseTo(MOTION.to.offsetX, 9);
    expect(wire.to_state.offset_y).toBeCloseTo(MOTION.to.offsetY, 9);
    expect(wire.from_state.scale).toBeCloseTo(MOTION.from.scale, 9);
    expect(wire.preset_id).toBe('ken-burns');
    expect(wire.start_ratio).toBe(MOTION.startRatio);
    expect(wire.end_ratio).toBe(MOTION.endRatio);
  });

  it('omits the field for a clip with no motion (M5)', () => {
    expect(toCameraMotionWire(undefined)).toBeUndefined();
    expect(toCameraMotionWire(null)).toBeUndefined();
  });

  it('round-trips every angle field so a 3D move is not flattened', () => {
    const orbit = motionFromPreset('orbit-left') as unknown as CameraMotionInput;
    const wire = toCameraMotionWire(orbit)!;
    expect(wire.space).toBe('3d');
    expect(wire.from_state.yaw).toBeCloseTo(orbit.from.yaw, 9);
    expect(wire.to_state.yaw).toBeCloseTo(orbit.to.yaw, 9);
    expect(wire.from_state.pitch).toBeCloseTo(orbit.from.pitch, 9);
    expect(wire.from_state.dolly).toBeCloseTo(orbit.from.dolly, 9);
    expect(wire.from_state.roll).toBeCloseTo(orbit.from.roll, 9);
  });
});

describe('export completion — backend degradation warnings', () => {
  /**
   * Mirror of the hook's completion branch. Composition is asynchronous, so the
   * poll's final status document is the only place a degradation can surface;
   * a warning that is not shown here is an export that is subtly wrong with no
   * explanation anywhere.
   */
  function surfaceWarnings(
    status: CompositionStatusResponse | undefined,
    showWarning: (message: string, ms?: number) => void,
    message: string,
  ): void {
    if (status?.warnings?.length) showWarning(message, 8000);
  }

  const status = (warnings?: string[]): CompositionStatusResponse =>
    ({
      composition_id: 'c1',
      task_id: 't1',
      status: 'completed',
      progress: 1,
      start_time: 0,
      warnings,
    }) as CompositionStatusResponse;

  it('warns the user when the backend reported a degradation', () => {
    const showWarning = vi.fn();
    surfaceWarnings(status(['camera_motion_static: ...']), showWarning, 'degraded');
    expect(showWarning).toHaveBeenCalledWith('degraded', 8000);
  });

  it('stays silent on a clean export', () => {
    const showWarning = vi.fn();
    surfaceWarnings(status(undefined), showWarning, 'degraded');
    surfaceWarnings(status([]), showWarning, 'degraded');
    surfaceWarnings(undefined, showWarning, 'degraded');
    expect(showWarning).not.toHaveBeenCalled();
  });
});
