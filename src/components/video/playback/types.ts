/**
 * Playback v2 — shared types.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §4.1
 *       docs/plans/video-editor-playback-v2-phase2/spec.md §5
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
 * Spec 02 §4.2 defines the full transition table.
 */
export type PlaybackPhase =
  | 'idle'
  | 'preparing'
  | 'playing'
  | 'seeking'
  | 'paused'
  | 'stalled'
  | 'ended'
  | 'disposed';

/**
 * Intent submitted to {@link IPlaybackEngine.dispatch}.
 *
 * Why a discriminated union: spec 02 §4.3 requires the engine to fan-out on
 * `kind` inside its reducer.
 */
export type PlaybackIntent =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'seek'; compositionTime: number; source?: 'ruler' | 'controls' | 'video_end' }
  | { kind: 'setRate'; rate: number }
  | { kind: 'setVolume'; volume: number }
  | { kind: 'enterBackground' }
  | { kind: 'returnToForeground' };

/**
 * One composited preview frame emitted by {@link IPlaybackClock} on each tick.
 *
 * `compositionTime` is the single source of truth for the timeline cursor
 * (D2 in master-plan §5).
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

/**
 * Overlay payload — the compositor renders these on top of the active video
 * frame. Spec §5.3.
 */
export type OverlayPayload =
  | {
      kind: 'image';
      id: string;
      src: string;
      /** Normalized [0,1] bounds against the fit-rect of the video frame. */
      bounds: { x: number; y: number; w: number; h: number };
      opacity: number;
      startMs: number;
      endMs: number;
    }
  | {
      kind: 'subtitle';
      id: string;
      text: string;
      style: SubtitleStyle;
      startMs: number;
      endMs: number;
    }
  | {
      kind: 'watermark';
      id: string;
      src: string;
      anchor: 'tl' | 'tr' | 'bl' | 'br';
      opacity: number;
    };

export interface SubtitleStyle {
  fontSize: number;
  color: string;
  background?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Vertical anchor as fraction of canvas height (0=top, 1=bottom). Default 0.9. */
  vAnchor?: number;
}

export interface SubtitlePayload {
  text: string;
  style: SubtitleStyle;
  startMs: number;
  endMs: number;
}

export interface CompositorStats {
  drawnFrames: number;
  droppedFrames: number;
  lastDrawMs: number;
  /** Current effective target fps (60 or 30 in adaptive mode). */
  targetFps: number;
}

export interface IPlaybackEngine {
  /** Wire to render targets + timeline facade. Spec §5.1. */
  attach(deps: PlaybackEngineAttachDeps): void;
  dispatch(intent: PlaybackIntent): void;
  getPhase(): PlaybackPhase;
  subscribe(listener: (phase: PlaybackPhase) => void): () => void;
  /** Release rAF + listeners; subsequent dispatches are no-ops. Spec §5.1. */
  dispose(): void;
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
  setActiveSource(source: HTMLVideoElement | null): void;
  setLetterbox(viewport: ICanvasViewport | null): void;
  setOverlays(overlays: OverlayPayload[]): void;
  captureFrame(): string | null;
  getStats(): CompositorStats;
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

/**
 * Timeline-store façade injected into PlaybackEngine.attach.
 * Spec §5.1.
 */
export interface PlaybackTimelineFacade {
  getCurrentTime: () => number;
  setCurrentTime: (t: number) => void;
  getTotalDuration: () => number;
  findSequenceAtCompositionTime: (
    t: number,
  ) => { sequence: VideoSequenceItem; index: number; offset: number; startTime: number } | null;
  getSequences: () => VideoSequenceItem[];
}

/** Resolves the playable URL + media-time for a given sequence + offset. */
export interface PlaybackSequenceResolver {
  resolveSrc: (sequence: VideoSequenceItem) => string | null;
  /** Map a sequence-local timeline offset to the underlying media time. */
  mapToMediaTime: (sequence: VideoSequenceItem, sequenceOffset: number) => number;
}

export interface PlaybackEngineAttachDeps {
  canvas: HTMLCanvasElement;
  activeVideo: HTMLVideoElement;
  timeline: PlaybackTimelineFacade;
  resolver: PlaybackSequenceResolver;
  overlaysProvider: () => OverlayPayload[];
  viewport?: ICanvasViewport | null;
  /**
   * Optional kill-switch sink. Engine calls this with a reason string when it
   * has decided v2 cannot continue; PreviewSurface uses it to write the
   * killswitch flag and remount.
   */
  onKillSwitch?: (reason: string) => void;
}
