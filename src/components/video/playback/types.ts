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
       * Camera-motion (2D/3D 运镜) sample for this frame — the TIME stage only.
       *
       * `assembleLayers` folds `t` into a scalar {@link CameraMotionState}; the
       * PIXEL stage (homography → affine / perspective quad) happens inside the
       * compositor where the canvas + intrinsic sizes are known. Keeping the two
       * apart is what lets the pure layer assembler stay DOM/canvas free
       * (timeline-camera-motion plan §3.1 / R-P0-1).
       */
      motion?: {
        space: CameraMotionSpace;
        state: CameraMotionState;
      };
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
    };

/**
 * Transition metadata carried on a sequence (preview + export share it).
 * `type` is the visual family; `duration` is seconds.
 */
export interface SequenceTransition {
  type: 'fade' | 'dissolve';
  duration: number;
}

// ---------------------------------------------------------------------------
// Camera motion (2D / 3D 运镜) — shared preview ⇄ export contract.
//
// Plan: docs/plans/timeline-camera-motion/experiment-plan.md §3 / §5.
// The Python mirror lives in
// backend-services/basic-service/app/services/composition/camera_motion.py and
// MUST stay numerically identical (locked by the D1 golden vectors).
// ---------------------------------------------------------------------------

/** `2d` = affine only (末行 [0,0,1]); `3d` = true perspective homography. */
export type CameraMotionSpace = '2d' | '3d';

/** Closed-form cubic easings — chosen so TS and Python agree bit-for-bit. */
export type CameraMotionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/**
 * One endpoint of a camera move. 2D presets only use the first four fields.
 *
 * The neutral state `N = { scale:1, offsetX:0, offsetY:0, roll:0, yaw:0,
 * pitch:0, dolly:1 }` is the identity transform; `intensity` scales the
 * *offset from N* (plan §3.3), so `intensity = 0` is a true identity even for
 * presets whose `from` differs from N (e.g. Zoom Out).
 */
export interface CameraMotionState {
  /** Uniform zoom. 1 = the frame exactly fills the canvas. Must be > 0. */
  scale: number;
  /** Horizontal pan, normalized to the CANVAS width (not the fit-rect). */
  offsetX: number;
  /** Vertical pan, normalized to the CANVAS height. */
  offsetY: number;
  /** In-plane rotation, degrees (screen space, applied after projection). */
  roll: number;
  /** Rotation about the vertical axis, degrees (3D only). */
  yaw: number;
  /** Rotation about the horizontal axis, degrees (3D only). */
  pitch: number;
  /** Camera distance multiplier; 1 = neutral, >1 pulls back (3D only). */
  dolly: number;
}

/** A camera move attached to one timeline clip. */
export interface CameraMotion {
  /** Preset id from `cameraMotionPresets`, or `'custom'` after manual tuning. */
  presetId: string;
  space: CameraMotionSpace;
  from: CameraMotionState;
  to: CameraMotionState;
  easing: CameraMotionEasing;
  /** Motion start as a fraction of the clip duration, [0,1). */
  startRatio: number;
  /** Motion end as a fraction of the clip duration, (startRatio,1]. */
  endRatio: number;
  /** Scales the offset from the neutral state. [0,2], default 1. */
  intensity: number;
}

/** 3×3 row-major homography. For 2D moves the last row is exactly [0,0,1]. */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** Destination quad, corner order frozen as [TL, TR, BR, BL] (clockwise). */
export type DestQuad = readonly [
  number, number,
  number, number,
  number, number,
  number, number,
];

/** One projected corner carrying its homogeneous divisor `w`. */
export interface ProjectedCorner {
  x: number;
  y: number;
  /** Homogeneous divisor before the perspective divide; > 0 when renderable. */
  w: number;
}

/**
 * Four projected corners in [TL, TR, BR, BL] order, `w` retained so the WebGL
 * renderer can hand the GPU perspective-correct interpolation.
 */
export type PerspectiveQuad = readonly [
  ProjectedCorner,
  ProjectedCorner,
  ProjectedCorner,
  ProjectedCorner,
];

/** Canvas (or any rect) size in device pixels. */
export interface CanvasSize {
  width: number;
  height: number;
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
