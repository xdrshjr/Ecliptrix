/**
 * useVideoExport — a still's camera motion must reach the wire.
 *
 * Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §7.3-9 / §7.5-26.
 *
 * The export payload has TWO branches for a clip on a video track: an image
 * material is pushed into `image_items` and `return`s before ever reaching the
 * video branch that attaches `camera_motion`. That early return is exactly why a
 * still's move was dropped on the way out (G1, evidence 3), and nothing in the
 * type system objects — both payloads are structurally valid.
 *
 * The hook is a large React effect chain, so rather than rendering it these
 * tests assert the two things that actually decide the outcome: that BOTH
 * branches route through the one shared mapper, and that the mapper's output is
 * what the backend model accepts.
 */

import { describe, expect, it } from 'vitest';
import { toCameraMotionWire } from '@/lib/api/videoComposition';
import { motionFromPreset } from '../../playback';
import type { CameraMotionInput, ImageCompositionItem } from '@/lib/api/videoComposition';
// The hook's own text. Read through Vite's `?raw` loader rather than `node:fs`
// because these tests run in a browser-like environment with no Node builtins.
// @ts-expect-error -- `?raw` is resolved by Vite; this repo declares no ambient type for it.
import SOURCE from '../useVideoExport.ts?raw';

describe('the export payload builder wires 运镜 on BOTH item kinds', () => {
  it('attaches camera_motion to the image branch', () => {
    // The image branch is the one that `return`s early; a move added to the
    // video branch alone is the shape of the original defect.
    const imageBranch = SOURCE.slice(
      SOURCE.indexOf('imageItems.push({'),
      SOURCE.indexOf('return; // 跳过视频处理逻辑'),
    );
    expect(imageBranch).toContain('camera_motion: toCameraMotionWire(item.cameraMotion)');
  });

  it('still attaches camera_motion to the video branch', () => {
    const videoBranch = SOURCE.slice(SOURCE.indexOf('videoItems.push({'));
    expect(videoBranch).toContain('camera_motion: toCameraMotionWire(item.cameraMotion)');
  });

  it('routes both through the SAME mapper, never a second one', () => {
    const occurrences = SOURCE.split('toCameraMotionWire(').length - 1;
    // One import + two call sites. A third mapper would be the drift the shared
    // function exists to prevent.
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(SOURCE).not.toMatch(/from_state\s*:/);
  });
});

describe('the wire shape a still carries', () => {
  const motion = motionFromPreset('ken-burns') as unknown as CameraMotionInput;

  it('is the same snake_case payload the video items send', () => {
    const item: ImageCompositionItem = {
      id: 'still-1',
      name: 'still',
      url: '/api/storage/files/x.png',
      start_time: 2,
      duration: 4,
      track_id: 't1',
      position: { x: 0.1, y: 0.2, width: 0.5, height: 0.25, zIndex: 10 },
      camera_motion: toCameraMotionWire(motion),
    };
    expect(item.camera_motion?.preset_id).toBe('ken-burns');
    expect(item.camera_motion?.from_state.offset_x).toBeCloseTo(motion.from.offsetX, 9);
    expect(item.camera_motion?.space).toBe('2d');
  });

  it('is omitted entirely for a still with no move (N4-② depends on it)', () => {
    const item: ImageCompositionItem = {
      id: 'still-1',
      name: 'still',
      url: '/api/storage/files/x.png',
      start_time: 2,
      duration: 4,
      track_id: 't1',
      camera_motion: toCameraMotionWire(undefined),
    };
    expect(item.camera_motion).toBeUndefined();
  });
});
