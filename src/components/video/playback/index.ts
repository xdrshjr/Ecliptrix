/**
 * Playback v2 barrel.
 *
 * Spec 01 §3.1.7: a single import entry for the rest of the codebase. Keep
 * surface area minimal — internal helpers stay unexported.
 */

export { PlaybackEngine } from './PlaybackEngine';
export type { PlaybackEngineDeps } from './PlaybackEngine';
export { PlaybackClock } from './PlaybackClock';
export { PlayheadController } from './PlayheadController';
export type { PlayheadControllerOptions } from './PlayheadController';
export { AbBufferController } from './AbBufferController';
export type { AbBufferElements } from './AbBufferController';
export { CanvasCompositor } from './CanvasCompositor';
export type { CompositorStats } from './CanvasCompositor';
export type {
  IPlaybackEngine,
  IPlaybackClock,
  IAbBufferController,
  ICanvasCompositor,
  ICanvasViewport,
  IPlayheadController,
  PlaybackIntent,
  PlaybackPhase,
  PreviewFrame,
  SequenceTarget,
} from './types';
