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
import type { ResolvedCameraDraw, StillCameraInput } from './camera/types';

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

// ---------------------------------------------------------------------------
// Stage 2a — multi-track compositor Layer contract (spec 02 §4).
//
// The compositor's per-frame entry point composites an ordered list of layers
// bottom→top. Spec 05 (ffmpeg export) mirrors this z-order / opacity / fade
// semantics, so keep the contract stable.
// ---------------------------------------------------------------------------

/**
 * One renderable layer the multi-track compositor draws per frame.
 *
 * - `video`   — a decoded `<video>` source drawn fit-contain with `opacity`.
 * - `subtitle`— pre-laid-out subtitle (lines + style) drawn over the video.
 * - `image`   — an image item rasterised at normalized `bounds` with `opacity`.
 *
 * `z` orders layers within their kind family and across kinds (lower draws
 * first). Layers are sorted by `z` ascending before drawing.
 */
export type CompositorLayer =
  | {
      kind: 'video';
      /** Stable id (track id) so the compositor can skip un-ready repaints. */
      id: string;
      source: HTMLVideoElement | null;
      /** Effective opacity = item.opacity * transition alpha, in [0,1]. */
      opacity: number;
      z: number;
      /**
       * Resolved 2D / 3D camera motion for this frame (camera-motion-2d-3d
       * §4.3.1). `undefined` — the overwhelmingly common case — means the
       * compositor takes its existing 5-arg `drawImage` path unchanged.
       */
      camera?: ResolvedCameraDraw;
    }
  | {
      kind: 'subtitle';
      id: string;
      /** Pre-wrapped lines (SubtitleLayer owns layout). */
      lines: string[];
      style: SubtitleStyle;
      opacity: number;
      z: number;
    }
  | {
      kind: 'image';
      id: string;
      src: string;
      /** Normalized [0,1] bounds against the canvas fit-rect. */
      bounds: { x: number; y: number; w: number; h: number };
      opacity: number;
      z: number;
      /**
       * This still's camera motion, UNRESOLVED (camera-motion-stills §4.3.1).
       * Unlike the video branch it is not a `ResolvedCameraDraw`: resolving
       * needs the image's aspect, which only exists once the compositor has
       * decoded it. `undefined` keeps the existing contain-draw path untouched.
       */
      cameraInput?: StillCameraInput;
    };

/**
 * Transition metadata carried on a sequence (preview + export share it).
 * `type` is the visual family; `duration` is seconds.
 */
export interface SequenceTransition {
  type: 'fade' | 'dissolve';
  duration: number;
}

/**
 * Track-grouped video sequences for the multi-track compositor. Each entry is
 * one visible video track with its clip items (already carrying trackZ /
 * opacity / transition / audioDetached transferred from the timeline item).
 */
export interface VideoTrackGroup {
  trackId: string;
  /** Z-order index — lower draws first (bottom). */
  z: number;
  items: import('../types').VideoSequenceItem[];
}

/** Track-grouped audio sequences for the audio sync pool. */
export interface AudioTrackGroup {
  trackId: string;
  muted: boolean;
  /** Track-level volume scalar (0..2), already normalized from 0..200. */
  volume: number;
  items: import('../types').AudioSequenceItem[];
}

export interface CompositorStats {
  drawnFrames: number;
  droppedFrames: number;
  lastDrawMs: number;
  /** Current effective target fps (60 or 30 in adaptive mode). */
  targetFps: number;
}

export interface IPlaybackClock {
  start(baseCompositionTime: number, baseWallTime: number, rate?: number): void;
  stop(): void;
  isRunning(): boolean;
  subscribe(handler: (compositionTime: number, deltaMs: number) => void): () => void;
}

export interface IAbBufferController {
  /** Hot-swap the underlying `<video>` ref pair (PreviewSurface owns DOM). */
  setElements(els: { a: HTMLVideoElement | null; b: HTMLVideoElement | null }): void;
  /** Wire the compositor so swap fast-paths can flip the active source synchronously. */
  setCompositor(c: ICanvasCompositor): void;
  /** Wire the resolver used to derive a playable URL for a sequence. */
  setResolver(r: PlaybackSequenceResolver): void;
  /**
   * Bind the active buffer to ``sequenceId`` at ``localTime``. Loads metadata,
   * seeks, waits for ``seeked`` (or times out → hard rebind once). Returns
   * the active `<video>` element.
   */
  bindActive(sequenceId: string, localTime: number): Promise<HTMLVideoElement>;
  /** Pre-load the next sequence into the prewarm buffer (no-op when idle). */
  prewarmNext(sequenceId: string): Promise<void>;
  /**
   * Same-tick boundary swap (phase-3 spec §5.1 / INV2).
   *
   * Always synchronous and always returns an `HTMLVideoElement`:
   * - Fast path: prewarm is HAVE_FUTURE_DATA(3) and src matches → flip
   *   role + return the new active. Old active is paused inside.
   * - Fallback: prewarm not ready → return the old active and asynchronously
   *   trigger ``bindActive(nextSeq.id, 0)``; report via ``subscribeError``
   *   with ``{ code: 'short_clip_handover', el: 'active' }`` so the engine
   *   parks in 'preparing' until the rebind completes.
   *
   * Returning a Promise here is forbidden — Engine `_onTick` does not await.
   */
  swapActive(): HTMLVideoElement;
  getActiveElement(): HTMLVideoElement | null;
  getPrewarmElement(): HTMLVideoElement | null;
  releaseAll(): void;
  /**
   * Subscribe to errors surfaced by either buffer (active or prewarm).
   * Returns an unsubscribe function. Phase-3 spec §3.4 — replaces the
   * Round 2 direct `<video>` error binding inside the engine.
   */
  subscribeError(
    handler: (err: { code: number | string; el: 'active' | 'prewarm' }) => void,
  ): () => void;
}

export interface ICanvasCompositor {
  attach(canvas: HTMLCanvasElement, viewport?: ICanvasViewport): void;
  detach(): void;
  drawFrame(frame: PreviewFrame): void;
  /**
   * Multi-track per-frame compositing (spec 02 §2.2 / §4). Draws an ordered
   * list of layers bottom→top (sorted by `z`). Coexists with the single-source
   * {@link drawFrame}; the multi-track engine uses this entry.
   */
  renderFrame(layers: CompositorLayer[]): void;
  setActiveSource(source: HTMLVideoElement | null): void;
  setLetterbox(viewport: ICanvasViewport | null): void;
  setOverlays(overlays: OverlayPayload[]): void;
  captureFrame(): string | null;
  getStats(): CompositorStats;
  /** Phase 4 §3.2.1: 1s throttled dropped-frame-rate sampler. */
  setDroppedFrameRateListener?(
    listener: ((sample: { rate: number; drawn: number; dropped: number; windowMs: number }) => void) | null,
  ): void;
}

export interface IPlayheadController {
  reportCompositionTime(t: number): void;
  reset(): void;
}

/** Resolves the playable URL + media-time for a given sequence + offset. */
export interface PlaybackSequenceResolver {
  resolveSrc: (sequence: VideoSequenceItem) => string | null;
  /** Map a sequence-local timeline offset to the underlying media time. */
  mapToMediaTime: (sequence: VideoSequenceItem, sequenceOffset: number) => number;
  /**
   * Look up a sequence by id. Phase-3 addition (recorded in spec §10 F1):
   * the spec'd ``IAbBufferController.bindActive`` takes ``sequenceId``
   * but the buffer needs the full sequence to call ``resolveSrc``. The
   * engine wires this from ``timeline.getSequences()``.
   */
  getSequenceById?: (sequenceId: string) => VideoSequenceItem | null;
}
