/**
 * cameraMotionPresets — the authored 运镜 preset table.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §6.2.
 *
 * PURE DATA. Every preset is a `from`/`to` pair of {@link CameraMotionState}
 * plus a default easing; all behaviour lives in `CameraMotionLayer`. Adding a
 * preset here needs no logic change anywhere — but it DOES need the golden
 * vectors regenerated (`node scripts/gen-camera-motion-golden.mjs`) because the
 * TS ⇄ Python parity suite enumerates this table.
 *
 * Authoring notes:
 *   - 2D presets keep `yaw/pitch = 0` and `dolly = 1` so their homography is
 *     exactly affine; `ensureCoverage` then guarantees they never expose the
 *     canvas edge, so preview and export agree without any backdrop handling.
 *   - 3D presets carry a mild `scale` (1.02–1.14) so the intentional reveal
 *     stays a tasteful sliver rather than a wide black band, while still
 *     exercising the transparent pad/crop path on export.
 */

import type { CameraMotion, CameraMotionEasing, CameraMotionSpace, CameraMotionState } from './types';
import { NEUTRAL_STATE } from './CameraMotionLayer';

/** A selectable preset in the camera-motion panel. */
export interface CameraMotionPreset {
  /** Stable id — persisted on the clip and used as the i18n key suffix. */
  id: string;
  space: CameraMotionSpace;
  from: CameraMotionState;
  to: CameraMotionState;
  easing: CameraMotionEasing;
}

/** Preset id written when the user hand-tunes the advanced parameters. */
export const CUSTOM_PRESET_ID = 'custom';

/** Default motion window / intensity applied when a preset is first chosen. */
export const DEFAULT_MOTION_WINDOW = Object.freeze({
  startRatio: 0,
  endRatio: 1,
  intensity: 1,
});

function state(overrides: Partial<CameraMotionState>): CameraMotionState {
  return { ...NEUTRAL_STATE, ...overrides };
}

/**
 * The 16 shipped presets — 8 planar (2D) and 8 perspective (3D), in panel
 * display order.
 */
export const CAMERA_MOTION_PRESETS: readonly CameraMotionPreset[] = Object.freeze([
  // --- 2D · 平面运镜 ------------------------------------------------------
  {
    id: 'zoom-in',
    space: '2d',
    from: state({ scale: 1.0 }),
    to: state({ scale: 1.25 }),
    easing: 'ease-in-out',
  },
  {
    id: 'zoom-out',
    space: '2d',
    from: state({ scale: 1.25 }),
    to: state({ scale: 1.0 }),
    easing: 'ease-in-out',
  },
  {
    id: 'pan-left',
    space: '2d',
    from: state({ scale: 1.15, offsetX: -0.06 }),
    to: state({ scale: 1.15, offsetX: 0.06 }),
    easing: 'ease-in-out',
  },
  {
    id: 'pan-right',
    space: '2d',
    from: state({ scale: 1.15, offsetX: 0.06 }),
    to: state({ scale: 1.15, offsetX: -0.06 }),
    easing: 'ease-in-out',
  },
  {
    id: 'tilt-up',
    space: '2d',
    from: state({ scale: 1.15, offsetY: -0.06 }),
    to: state({ scale: 1.15, offsetY: 0.06 }),
    easing: 'ease-in-out',
  },
  {
    id: 'tilt-down',
    space: '2d',
    from: state({ scale: 1.15, offsetY: 0.06 }),
    to: state({ scale: 1.15, offsetY: -0.06 }),
    easing: 'ease-in-out',
  },
  {
    id: 'rotate-in',
    space: '2d',
    from: state({ scale: 1.0, roll: -3 }),
    to: state({ scale: 1.2, roll: 0 }),
    easing: 'ease-out',
  },
  {
    id: 'ken-burns',
    space: '2d',
    from: state({ scale: 1.05, offsetX: 0.03, offsetY: -0.02 }),
    to: state({ scale: 1.28, offsetX: -0.04, offsetY: 0.035 }),
    easing: 'linear',
  },

  // --- 3D · 透视运镜 ------------------------------------------------------
  {
    id: 'orbit-left',
    space: '3d',
    from: state({ scale: 1.1, yaw: -10 }),
    to: state({ scale: 1.1, yaw: 10 }),
    easing: 'ease-in-out',
  },
  {
    id: 'orbit-right',
    space: '3d',
    from: state({ scale: 1.1, yaw: 10 }),
    to: state({ scale: 1.1, yaw: -10 }),
    easing: 'ease-in-out',
  },
  {
    id: 'dive',
    space: '3d',
    from: state({ scale: 1.06, pitch: -12, dolly: 1.12 }),
    to: state({ scale: 1.06, pitch: 0, dolly: 1.0 }),
    easing: 'ease-out',
  },
  {
    id: 'crane-up',
    space: '3d',
    from: state({ scale: 1.1, pitch: 0, offsetY: 0 }),
    to: state({ scale: 1.1, pitch: 10, offsetY: -0.03 }),
    easing: 'ease-in-out',
  },
  {
    id: 'swing-in',
    space: '3d',
    from: state({ scale: 1.0, yaw: 22 }),
    to: state({ scale: 1.06, yaw: 0 }),
    easing: 'ease-out',
  },
  {
    id: 'dolly-in-3d',
    space: '3d',
    from: state({ scale: 1.02, pitch: 3, dolly: 1.25 }),
    to: state({ scale: 1.02, pitch: 0, dolly: 0.92 }),
    easing: 'ease-in-out',
  },
  {
    id: 'boom',
    space: '3d',
    from: state({ scale: 1.14, pitch: -8, offsetY: 0.04 }),
    to: state({ scale: 1.14, pitch: 8, offsetY: -0.04 }),
    easing: 'ease-in-out',
  },
  {
    id: 'spiral',
    space: '3d',
    from: state({ scale: 1.14, yaw: -12, pitch: 6, roll: -4 }),
    to: state({ scale: 1.14, yaw: 12, pitch: -6, roll: 4 }),
    easing: 'ease-in-out',
  },
]);

/** Presets grouped by space, in panel display order. */
export const CAMERA_MOTION_PRESETS_2D = CAMERA_MOTION_PRESETS.filter((p) => p.space === '2d');
export const CAMERA_MOTION_PRESETS_3D = CAMERA_MOTION_PRESETS.filter((p) => p.space === '3d');

/**
 * Look up a preset by id.
 *
 * @param presetId Preset identifier.
 * @returns The preset, or `null` for unknown / `'custom'` ids.
 */
export function presetById(presetId: string): CameraMotionPreset | null {
  return CAMERA_MOTION_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

/**
 * Materialise a full {@link CameraMotion} from a preset id.
 *
 * @param presetId Preset identifier.
 * @returns A ready-to-persist motion, or `null` when the id is unknown.
 */
export function motionFromPreset(presetId: string): CameraMotion | null {
  const preset = presetById(presetId);
  if (!preset) return null;
  return {
    presetId: preset.id,
    space: preset.space,
    from: { ...preset.from },
    to: { ...preset.to },
    easing: preset.easing,
    ...DEFAULT_MOTION_WINDOW,
  };
}

/**
 * Swap a motion's endpoints — the panel's "reverse direction" control.
 *
 * @param motion The motion to reverse.
 * @returns A new motion with `from`/`to` exchanged.
 */
export function reverseMotion(motion: CameraMotion): CameraMotion {
  return { ...motion, from: { ...motion.to }, to: { ...motion.from } };
}
