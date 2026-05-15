/**
 * Playback v2 — shared types.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §4.1
 *
 * These types form the contract between the playback engine, A/B buffer
 * controller, canvas compositor, playhead controller, and the timeline
 * store. Keep them lean and language-neutral; implementation details belong
 * in their owning module.
 */

import type { VideoSequenceItem } from '../types';

/**
 * Phase of the playback state machine.
 *
 * Spec 02 §4.2 defines the full transition table; spec 01 only requires that
 * the enum is shared so downstream modules can compile against stubs.
 */
export type PlaybackPhase =
  | 'idle'
  | 'preparing'
  | 'playing'
  | 'seeking'
  | 'paused'
  | 'stalled'
  | 'ended';

/**
 * Intent submitted to {@link IPlaybackEngine.dispatch}.
 *
 * Why a discriminated union: spec 02 §4.3 requires the engine to fan-out on
 * `kind` inside its reducer. Adding a new intent here is a load-bearing
 * change — coordinate with spec 02.
 */
export type PlaybackIntent =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'seek'; compositionTime: number }
  | { kind: 'setRate'; rate: number }
  | { kind: 'setVolume'; volume: number }
  | { kind: 'enterBackground' }
  | { kind: 'returnToForeground' };

/**
 * One composited preview frame emitted by {@link IPlaybackClock} on each tick.
 *
 * `compositionTime` is the single source of truth for the timeline cursor
 * (D2 in master-plan §5). `source` may be null on the very first tick before
 * an active video element has been bound; the compositor must handle that
 * via `keepLastFrame()`.
 */
export interface PreviewFrame {
  compositionTime: number;
  sequenceIndex: number;
  sequenceLocalTime: number;
  source: HTMLVideoElement | null;
}

export interface ICanvasViewport {
  aspectRatio: number;
  letterboxColor?: string;
}

export interface IPlaybackEngine {
  dispatch(intent: PlaybackIntent): void;
  getPhase(): PlaybackPhase;
  subscribe(listener: (phase: PlaybackPhase) => void): () => void;
}

export interface IPlaybackClock {
  start(baseCompositionTime: number, baseWallTime: number, rate?: number): void;
  stop(): void;
  isRunning(): boolean;
  subscribe(handler: (compositionTime: number, deltaMs: number) => void): () => void;
}

export interface IAbBufferController {
  bindActive(sequenceId: string, localTime: number): Promise<HTMLVideoElement>;
  prewarmNext(sequenceId: string): Promise<void>;
  getActiveElement(): HTMLVideoElement | null;
  releaseAll(): void;
}

export interface ICanvasCompositor {
  attach(canvas: HTMLCanvasElement, viewport?: ICanvasViewport): void;
  detach(): void;
  drawFrame(frame: PreviewFrame): void;
}

export interface IPlayheadController {
  reportCompositionTime(t: number): void;
  reset(): void;
}

/** Sequence descriptor passed to {@link IAbBufferController.bindActive}. */
export interface SequenceTarget {
  sequence: VideoSequenceItem;
  localTime: number;
}
