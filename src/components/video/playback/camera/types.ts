/**
 * Camera motion — shared types, value ranges and the resolved draw contract.
 *
 * Spec: docs/plans/camera-motion-2d-3d/spec.md §4.2 / §6.2 / §7
 *
 * The data model itself lives in `@/types` (it is persisted on TimelineItem);
 * this module re-exports it next to the range constants and the preview-side
 * `ResolvedCameraDraw` so the whole math kernel has a single import surface.
 *
 * PURE: no DOM, no React — jsdom-testable, and mirrored verbatim by
 * `backend-services/basic-service/app/services/composition/camera_motion.py`.
 */

import type {
  CameraEasing,
  CameraKeyframe,
  CameraMotion,
  CameraMotionMode,
} from '@/types';

export type { CameraEasing, CameraKeyframe, CameraMotion, CameraMotionMode };

// ---------------------------------------------------------------------------
// Value ranges (§4.2.2 / §7.1) — interpolate first, clamp after.
// ---------------------------------------------------------------------------

export interface CameraRange {
  min: number;
  max: number;
}

export const CAMERA_RANGES: Record<keyof CameraKeyframe, CameraRange> = {
  scale: { min: 1, max: 4 },
  x: { min: 0, max: 1 },
  y: { min: 0, max: 1 },
  roll: { min: -45, max: 45 },
  rotateX: { min: -45, max: 45 },
  rotateY: { min: -45, max: 45 },
  dolly: { min: -0.6, max: 0.6 },
};

/** Intensity multiplier applied to the (end − start) delta. */
export const CAMERA_INTENSITY_RANGE: CameraRange = { min: 0, max: 2 };

/** Shortest meaningful motion window, seconds (§4.2.1). */
export const MIN_WINDOW = 0.05;

/** Effective source zoom `S` is clamped here after folding in `rollPad`. */
export const EFFECTIVE_SCALE_RANGE: CameraRange = { min: 1, max: 8 };

/** `rollPad` (D13) upper bound — keeps a pathological roll from over-cropping. */
export const ROLL_PAD_RANGE: CameraRange = { min: 1, max: 4 };

/** Vertical field of view used by the 3D projection (§4.2.4), degrees. */
export const CAMERA_FOV_DEG = 25;

/** Camera distance for a unit-height plane at {@link CAMERA_FOV_DEG}. */
export const CAMERA_D = 0.5 / Math.tan((CAMERA_FOV_DEG * Math.PI) / 180 / 2);

/** Corners closer than this to the camera are degenerate → fall back to 2D. */
export const CAMERA_Z_MIN = 0.05 * CAMERA_D;

/** Sample count used by the motion-level `coverScale` / `rollPad` maxima. */
export const CAMERA_COVER_SAMPLES = 100;

/** The identity keyframe — every preset omits fields that equal these. */
export const DEFAULT_KEYFRAME: CameraKeyframe = {
  scale: 1,
  x: 0.5,
  y: 0.5,
  roll: 0,
  rotateX: 0,
  rotateY: 0,
  dolly: 0,
};

/** Tolerance used by the identity comparison (§7.2). */
export const KEYFRAME_EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Resolved draw contract (§4.3.1)
// ---------------------------------------------------------------------------

/** Normalized (0..1) rectangle against the source content rect. */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One projected corner: normalized position + perspective weight. */
export interface CameraQuadPoint {
  x: number;
  y: number;
  q: number;
}

/** The four projected corners, in TL, TR, BL, BR order (FFmpeg perspective). */
export interface CameraQuad {
  pts: [CameraQuadPoint, CameraQuadPoint, CameraQuadPoint, CameraQuadPoint];
}

/**
 * The per-frame draw instruction shared by preview and export. Every field is
 * resolution-independent (normalized) so the two ends can never drift because
 * of a pixel-size mismatch (§4.2 preamble / R16).
 */
export interface ResolvedCameraDraw {
  mode: CameraMotionMode;
  /** Normalized source crop rect (0..1). Present in both 2D and 3D. */
  crop: NormalizedRect;
  /** In-frame rotation (degrees, clockwise). 3D folds roll into the homography → 0. */
  roll: number;
  /**
   * Destination-rect magnification relative to the content rect (D13's `RP`,
   * a motion-level constant, ≥ 1). 2D with roll ≠ 0 is > 1: draw into
   * `RP·fit.width × RP·fit.height` centred on the fit-rect, THEN rotate, so the
   * rotated corners are never empty. `roll ≡ 0` and 3D are always 1.
   */
  rollPad: number;
  /** 3D projected corners (normalized) + perspective weights. */
  quad?: CameraQuad;
  /** 3D degenerated this frame (corner behind the camera / no ray hit) → draw as 2D. */
  degraded?: boolean;
}
