/**
 * Playback v2 barrel.
 *
 * Spec 01 §3.1.7: a single import entry for the rest of the codebase. Keep
 * surface area minimal — internal helpers stay unexported.
 */

export { PlaybackEngine } from './PlaybackEngine';
export type { PlaybackEngineDeps } from './PlaybackEngine';
export { PlaybackClock } from './PlaybackClock';
export type { PlaybackClockOptions } from './PlaybackClock';
export { PlayheadController, bindToTimelineStore } from './PlayheadController';
export type { PlayheadControllerOptions } from './PlayheadController';
export { AbBufferController, BufferError } from './AbBufferController';
export type { AbBufferElements, AbBufferOptions, LastSwapResult } from './AbBufferController';
export { CanvasCompositor } from './CanvasCompositor';
export type { DroppedFrameRateEmit } from './CanvasCompositor';
export { PlaybackTelemetry, PLAYBACK_EVENTS, PLAYBACK_EVENT_NAMES } from './telemetry';
export type {
  PlaybackTelemetryOptions,
  TelemetryEvent,
  TelemetryTags,
  PlaybackEventName,
} from './telemetry';
export { KillSwitchMonitor } from './internal/killswitchMonitor';
export type {
  IKillSwitchMonitor as IKillSwitchMonitorRuntime,
  KillSwitchMonitorOptions,
} from './internal/killswitchMonitor';
export { ProxyHitMeter } from './internal/proxyHitMeter';
export type {
  IProxyHitMeter as IProxyHitMeterRuntime,
  ProxyHitSnapshot,
  ProxyTier as ProxyTierRuntime,
} from './internal/proxyHitMeter';
export type {
  IPlaybackEngine,
  IPlaybackClock,
  IAbBufferController,
  ICanvasCompositor,
  ICanvasViewport,
  IPlayheadController,
  IKillSwitchMonitor,
  IProxyHitMeter,
  PlaybackIntent,
  PlaybackPhase,
  PreviewFrame,
  ProxyTier,
  SequenceTarget,
  OverlayPayload,
  SubtitlePayload,
  SubtitleStyle,
  CompositorStats,
  PlaybackTimelineFacade,
  PlaybackSequenceResolver,
  PlaybackEngineAttachDeps,
} from './types';
