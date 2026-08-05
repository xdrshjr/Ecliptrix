/**
 * Camera motion (2D / 3D) — public barrel.
 *
 * Spec: docs/plans/camera-motion-2d-3d/spec.md
 *
 * The whole module is DOM-free except {@link Camera3DRenderer}, which is the
 * only piece that touches WebGL. Everything else is pure math mirrored by
 * `app/services/composition/camera_motion.py` and pinned by the golden vectors.
 */

export * from './types';
export {
  clamp,
  ease,
  easedProgressAt,
  hasClampedComponent,
  keyframeAt,
  keyframeAtTrajectory,
  progressAt,
  resolveWindow,
  tauAtProgress,
  type CameraWindow,
} from './easing';
export {
  expandStops,
  hasKeyframeCurve,
  insertKeyframeAt,
  normalizeCameraKeyframes,
  pickKeyframe,
  removeKeyframeAt,
  retimeKeyframe,
  segmentIndexAt,
  setKeyframeComponent,
  setSegmentEasing,
  trajectoryAt,
  trajectorySamples,
} from './keyframes';
export {
  DEGENERATE,
  affineApproxFromQuad,
  cameraMotionConstants,
  computeCropRect,
  coverScaleForMotion,
  coverScaleForQuad,
  project3DCorners,
  rollCover,
  rollPadForMotion,
  scaleQuad,
  _clearCameraConstantsCache,
  type CameraMotionConstants,
} from './cameraGeometry';
export { cameraMotionFingerprint } from './fingerprint';
export { isIdentityCameraMotion, keyframeEqualsDefault } from './identity';
export { fallbackCropForDraw, resolveCameraDraw } from './resolveCameraDraw';
export {
  CAMERA_PRESETS,
  applyPreset,
  emptyCameraMotion,
  findPreset,
  presetsForMode,
  reverseCameraMotion,
  type CameraPreset,
} from './cameraPresets';
export {
  canApplyCameraMotion,
  cameraMotionIneligibleReason,
  type CameraIneligibleReason,
} from './eligibility';
export {
  rebaseCameraMotionForSplit,
  shiftCameraMotionWindow,
  type SplitRebaseResult,
} from './splitRebase';
export {
  sanitizeCameraMotion,
  toCameraMotionWire,
  type CameraKeyframeStopWire,
  type CameraKeyframeWire,
  type CameraMotionWire,
} from './wire';
export { Camera3DRenderer } from './Camera3DRenderer';
