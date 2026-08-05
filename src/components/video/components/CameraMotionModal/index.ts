export { default as CameraMotionModal } from './CameraMotionModal';
export type { CameraMotionModalProps } from './CameraMotionModal';
export { presetLabel } from './presetLabels';
export { default as KeyframeStrip } from './KeyframeStrip';
export { default as StageOverlay } from './StageOverlay';
export {
  STAGE_VIEW_H,
  STAGE_VIEW_W,
  atToScrub,
  clampComponent,
  cropToStageRect,
  orbitDelta,
  panDelta,
  quadToStagePoints,
  rollDelta,
  scrubToAt,
  tiltDelta,
  windowBand,
  zoomDelta,
  zoomStep,
  STAGE_ANGLE_STEP,
  STAGE_PAN_STEP,
  STAGE_ZOOM_STEP,
  type StagePoint,
  type StageRect,
} from './stageInteraction';
export {
  canRemoveStop,
  decideInsertAt,
  pointerToAt,
  retimeBounds,
  stopOffset,
  type InsertBlockedReason,
  type InsertDecision,
} from './keyframeStripGeometry';
