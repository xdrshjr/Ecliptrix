/**
 * Playback v2 barrel.
 *
 * Spec 01 §3.1.7: a single import entry for the rest of the codebase. Keep
 * surface area minimal — internal helpers stay unexported.
 */

// local-video-editing-refactor S4 — the multi-track compositor is now the SOLE
// preview engine; the legacy single-sequence PlaybackEngine + the playback-v2
// flag/killswitch/variant machinery were removed with v1.
export { MultiTrackPlaybackEngine } from './MultiTrackPlaybackEngine';
export type {
  MultiTrackAttachDeps,
  MultiTrackTimelineFacade,
  MultiTrackPhase,
  TrackVideoElements,
} from './MultiTrackPlaybackEngine';
export { VideoSourcePool, computeSourcePlan } from './VideoSourcePool';
export type {
  VideoElementLike,
  SequenceSourceResolver,
  TrackSourcePlan,
  TrackElementState,
  TrackElements,
  TrackElementResolver,
} from './VideoSourcePool';
export { TrackScheduler, activeClipAt, prewarmNextAt } from './TrackScheduler';
export { TransitionLayer, alphaFor } from './TransitionLayer';
export { SubtitleLayer } from './SubtitleLayer';
export { ImageOverlayLayer, buildImageLayersAt } from './ImageOverlayLayer';
export { AudioSyncPool, computeAudioSyncActions } from './AudioSyncPool';
export type { AudioSyncGroup, AudioSyncAction } from './AudioSyncPool';
export {
  NEUTRAL_STATE,
  PERSPECTIVE_FOCAL_RATIO,
  BACKDROP_MIN_PAD,
  MOTION_SAMPLE_COUNT,
  easeProgress,
  progressAt,
  motionStateAt,
  ensureCoverage,
  cameraHomography,
  projectRect,
  applyHomographyToRect,
  affineFrom,
  isRenderable,
  isMotionRenderable,
  quadCoversCanvas,
  backdropMargin,
} from './CameraMotionLayer';
export type { MotionClipWindow, Rect, BackdropMargin } from './CameraMotionLayer';
export {
  CAMERA_MOTION_PRESETS,
  CAMERA_MOTION_PRESETS_2D,
  CAMERA_MOTION_PRESETS_3D,
  CUSTOM_PRESET_ID,
  DEFAULT_MOTION_WINDOW,
  presetById,
  motionFromPreset,
  reverseMotion,
} from './cameraMotionPresets';
export type { CameraMotionPreset } from './cameraMotionPresets';
export { PerspectiveQuadRenderer } from './PerspectiveQuadRenderer';
export { assembleLayers, buildVideoLayers, buildSubtitleLayers } from './internal/assembleLayers';
export type { ActiveVideoEntry, AssembleLayersInput } from './internal/assembleLayers';
export type {
  CompositorLayer,
  VideoTrackGroup,
  AudioTrackGroup,
  SequenceTransition,
  CameraMotion,
  CameraMotionState,
  CameraMotionSpace,
  CameraMotionEasing,
  CanvasSize,
  Mat3,
  DestQuad,
  ProjectedCorner,
  PerspectiveQuad,
} from './types';
export { PlaybackClock } from './PlaybackClock';
export type { PlaybackClockOptions } from './PlaybackClock';
export { PlayheadController, bindToTimelineStore } from './PlayheadController';
export type { PlayheadControllerOptions } from './PlayheadController';
export { AbBufferController, BufferError } from './AbBufferController';
export type { AbBufferElements, AbBufferOptions, LastSwapResult } from './AbBufferController';
export { CanvasCompositor } from './CanvasCompositor';
export type { DroppedFrameRateEmit, LayerDrawStat } from './CanvasCompositor';
export { PlaybackTelemetry, PLAYBACK_EVENTS, PLAYBACK_EVENT_NAMES } from './telemetry';
export type {
  PlaybackTelemetryOptions,
  TelemetryEvent,
  TelemetryTags,
  PlaybackEventName,
} from './telemetry';
export { ProxyHitMeter } from './internal/proxyHitMeter';
export type {
  IProxyHitMeter as IProxyHitMeterRuntime,
  ProxyHitSnapshot,
  ProxyTier as ProxyTierRuntime,
} from './internal/proxyHitMeter';
export type {
  IPlaybackClock,
  IAbBufferController,
  ICanvasCompositor,
  ICanvasViewport,
  IPlayheadController,
  PreviewFrame,
  OverlayPayload,
  SubtitleStyle,
  CompositorStats,
  PlaybackSequenceResolver,
} from './types';
