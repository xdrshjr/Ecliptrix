/**
 * MultiTrackPlaybackEngine — the unified local-preview orchestrator
 * (spec 02 §2.1 / §2.2 / §2.5). This is the generalized engine S3 mounts; it
 * has NO single-active-sequence assumption (the legacy {@link ./PlaybackEngine}
 * — kept for v1 coexistence, deleted with v1 in S4 — could only paint one
 * source at a time).
 *
 * Each composition tick (driven by the SOLE {@link PlaybackClock}):
 *   1. {@link VideoSourcePool}.sync — per visible video track, pick the active
 *      clip (TrackScheduler) → ensure its element holds the live-resolved src
 *      (RC-B "比对键==赋值") and is seeked within tolerance → prewarm next.
 *   2. {@link assembleLayers} — fold the live elements + their clips with the
 *      subtitle / image items into an ordered CompositorLayer[] (video opacity =
 *      item.opacity × transition alpha).
 *   3. {@link CanvasCompositor}.renderFrame — composite bottom→top.
 *   4. {@link AudioSyncPool}.tick — sync every non-muted audio track to the
 *      same composition time (consumes audioDetached).
 *   5. {@link PlayheadController}.reportCompositionTime — single writer to the
 *      timeline cursor.
 *
 * Orchestration ONLY — all clip/time/url decision logic lives in the injected
 * pure planners (TrackScheduler / VideoSourcePool / assembleLayers / Transition
 * Layer / AudioSyncPool), never re-implemented here. Time math flows through
 * spec 01 ClipTimeMapping inside those modules.
 */

import { CanvasCompositor } from './CanvasCompositor';
import { PlaybackClock } from './PlaybackClock';
import { PlayheadController } from './PlayheadController';
import { VideoSourcePool, type VideoElementLike } from './VideoSourcePool';
import { AudioSyncPool, type AudioSyncGroup, type AudioElementLike } from './AudioSyncPool';
import { assembleLayers, type ActiveVideoEntry } from './internal/assembleLayers';
import { activeClipAt } from './TrackScheduler';
import type { TextMeasurer } from './SubtitleLayer';
import type { ImageOverlayInput } from './ImageOverlayLayer';
import type {
  CompositorLayer,
  ICanvasViewport,
  VideoTrackGroup,
} from './types';
import type { SubtitleSequenceItem, VideoSequenceItem } from '../types';

/** Multi-track playback phase — coarser than the legacy single-seq machine. */
export type MultiTrackPhase = 'idle' | 'playing' | 'paused' | 'ended' | 'disposed';

/**
 * Timeline façade for the multi-track engine. Returns LIVE track groups + the
 * subtitle / image items + the total duration. Implementations memoize upstream;
 * the engine calls these once per tick (cheap).
 */
export interface MultiTrackTimelineFacade {
  getVideoTrackGroups: () => VideoTrackGroup[];
  getAudioSyncGroups: () => AudioSyncGroup[];
  getSubtitleItems: () => SubtitleSequenceItem[];
  getImageItems: () => ImageOverlayInput[];
  getTotalDuration: () => number;
  getCurrentTime: () => number;
  setCurrentTime: (t: number) => void;
}

/** Per-track A/B `<video>` pair, supplied by the S3 PreviewCanvas host. */
export interface TrackVideoElements {
  active: VideoElementLike;
  prewarm: VideoElementLike | null;
}

export interface MultiTrackAttachDeps {
  canvas: HTMLCanvasElement;
  /** Resolve the A/B `<video>` pair for a visible video track id. */
  resolveTrackElements: (trackId: string) => TrackVideoElements | null;
  /** Resolve the HTMLAudio-like element for an audio track id. */
  resolveAudioElement: (trackId: string) => VideoElementLike | null;
  /**
   * Resolve the playable URL for a sequence (RC-B authority). Caller wires
   * `(seq) => resolveSequencePlaybackUrl(seq, liveMaterials, lockedOpts)?.url`.
   * Used for BOTH the change-decision and the assignment (same key).
   */
  resolveSource: (seq: VideoSequenceItem) => string | null;
  timeline: MultiTrackTimelineFacade;
  viewport?: ICanvasViewport | null;
  /** Subtitle text measurer (real 2d-context measure injected by the host). */
  measureSubtitle?: TextMeasurer;
}

const DEFAULT_SUBTITLE_MAX_WIDTH_FRACTION = 0.9;
/** Fallback measurer used in headless / pre-measure contexts. */
const fallbackMeasure: TextMeasurer = (text, style) => text.length * style.fontSize * 0.5;

export class MultiTrackPlaybackEngine {
  readonly clock: PlaybackClock;
  readonly compositor: CanvasCompositor;
  readonly playhead: PlayheadController;

  private _phase: MultiTrackPhase = 'idle';
  private readonly _listeners = new Set<(phase: MultiTrackPhase) => void>();
  private readonly _now: () => number;

  private _deps: MultiTrackAttachDeps | null = null;
  private _videoPool: VideoSourcePool | null = null;
  private _audioPool: AudioSyncPool | null = null;
  private _clockUnsub: (() => void) | null = null;
  private _disposed = false;
  private _measure: TextMeasurer = fallbackMeasure;

  constructor(deps: { clock?: PlaybackClock; compositor?: CanvasCompositor; playhead?: PlayheadController; now?: () => number } = {}) {
    this.clock = deps.clock ?? new PlaybackClock();
    this.compositor = deps.compositor ?? new CanvasCompositor();
    this.playhead = deps.playhead ?? new PlayheadController();
    this._now =
      deps.now ??
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now.bind(performance)
        : Date.now);
  }

  /** Wire render targets + timeline facade. Idempotent re-attach is supported. */
  attach(deps: MultiTrackAttachDeps): void {
    if (this._disposed) {
      throw new Error('MultiTrackPlaybackEngine.attach: instance has been disposed');
    }
    this._deps = deps;
    this._measure = deps.measureSubtitle ?? fallbackMeasure;
    this.compositor.attach(deps.canvas, deps.viewport ?? undefined);
    this._buildPools(deps);

    this.playhead.bindOnWrite((t) => {
      try {
        deps.timeline.setCurrentTime(t);
      } catch {
        // ignore — timeline failures surface elsewhere
      }
    });

    this._clockUnsub = this.clock.subscribeTick((comp) => this._onTick(comp));
    // Paint the first frame at the current position so a paused mount is not black.
    this._renderAt(deps.timeline.getCurrentTime(), false);
  }

  /** Construct the per-track video pool + audio pool from the attach deps. */
  private _buildPools(deps: MultiTrackAttachDeps): void {
    this._videoPool = new VideoSourcePool(
      (trackId) => {
        const els = deps.resolveTrackElements(trackId);
        return els ? { active: els.active, prewarm: els.prewarm } : null;
      },
      deps.resolveSource,
    );
    this._audioPool = new AudioSyncPool((trackId) => {
      const el = deps.resolveAudioElement(trackId);
      return el ? toAudioElement(el) : null;
    });
  }

  getPhase(): MultiTrackPhase {
    return this._phase;
  }

  subscribe(listener: (phase: MultiTrackPhase) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  play(): void {
    if (this._disposed || !this._deps) return;
    if (this._phase === 'playing') return;
    let comp = this._deps.timeline.getCurrentTime();
    const total = this._deps.timeline.getTotalDuration();
    if (total > 0 && comp >= total - TICK_END_EPSILON) {
      comp = 0;
      this.playhead.forceSet(0);
    }
    this.clock.start(comp, this._now(), 1);
    this._setPhase('playing');
  }

  pause(): void {
    if (this._disposed || !this._deps) return;
    this.clock.stop();
    this._renderAt(this.clock.getCompositionTime(), false);
    if (this._phase !== 'ended') this._setPhase('paused');
  }

  /** Seek to `t` and paint a single frame; resumes playing if it was playing. */
  seek(t: number): void {
    if (this._disposed || !this._deps) return;
    const wasPlaying = this._phase === 'playing';
    const target = Math.max(0, t);
    this.clock.stop();
    this.playhead.forceSet(target);
    if (wasPlaying) {
      this.clock.start(target, this._now(), 1);
      this._setPhase('playing');
      this._renderAt(target, true);
    } else {
      this._renderAt(target, false);
      this._setPhase('paused');
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.clock.stop();
    this._clockUnsub?.();
    this._clockUnsub = null;
    try {
      this.compositor.detach();
    } catch {
      // ignore
    }
    this.playhead.reset();
    this._videoPool = null;
    this._audioPool = null;
    this._setPhase('disposed');
  }

  /** Test introspection — current phase + pool wiring. */
  _peekInternal() {
    return {
      phase: this._phase,
      disposed: this._disposed,
      hasVideoPool: this._videoPool !== null,
      hasAudioPool: this._audioPool !== null,
    };
  }

  // ------------------------------------------------------------------
  // Tick
  // ------------------------------------------------------------------

  private _onTick(comp: number): void {
    if (this._disposed || !this._deps) return;
    const total = this._deps.timeline.getTotalDuration();
    if (total > 0 && comp >= total) {
      this.clock.stop();
      this._renderAt(total, false);
      this.playhead.forceSet(total);
      this._setPhase('ended');
      return;
    }
    this._renderAt(comp, true);
    this.playhead.reportCompositionTime(comp);
  }

  /**
   * The shared per-frame pipeline: sync sources, assemble layers, render, sync
   * audio. `isPlaying` controls whether elements are driven to play() or parked.
   */
  private _renderAt(comp: number, isPlaying: boolean): void {
    if (!this._deps || !this._videoPool || !this._audioPool) return;
    const tl = this._deps.timeline;
    const groups = tl.getVideoTrackGroups();

    const synced = this._videoPool.sync(groups, comp, isPlaying);
    const videoEntries = this._buildVideoEntries(groups, synced, comp);
    const layers = this._assemble(videoEntries, comp);
    this.compositor.renderFrame(layers);

    this._audioPool.tick(tl.getAudioSyncGroups(), comp, isPlaying);
  }

  /** Pair each track's synced element with its active clip for layer assembly. */
  private _buildVideoEntries(
    groups: readonly VideoTrackGroup[],
    synced: { plan: { trackId: string; z: number }; element: VideoElementLike | null }[],
    comp: number,
  ): ActiveVideoEntry[] {
    const groupById = new Map(groups.map((g) => [g.trackId, g]));
    return synced.map(({ plan, element }) => {
      const group = groupById.get(plan.trackId);
      const hit = group ? activeClipAt(group.items, comp) : null;
      return {
        trackId: plan.trackId,
        z: plan.z,
        // VideoElementLike is structurally compatible with the drawable surface
        // (readyState); cast through unknown keeps the pure module DOM-free.
        source: element as unknown as ActiveVideoEntry['source'],
        clip: hit ? hit.clip : null,
      };
    });
  }

  private _assemble(videoEntries: ActiveVideoEntry[], comp: number): CompositorLayer[] {
    if (!this._deps) return [];
    const tl = this._deps.timeline;
    const maxWidth = this._deps.canvas.width * DEFAULT_SUBTITLE_MAX_WIDTH_FRACTION;
    return assembleLayers({
      videoEntries,
      subtitleItems: tl.getSubtitleItems(),
      imageItems: tl.getImageItems(),
      t: comp,
      subtitleMaxWidthPx: maxWidth,
      measureSubtitle: this._measure,
    });
  }

  private _setPhase(next: MultiTrackPhase): void {
    if (this._phase === next) return;
    this._phase = next;
    this._listeners.forEach((l) => l(next));
  }
}

/** End-of-timeline snap epsilon (seconds) — replay-from-start guard. */
const TICK_END_EPSILON = 1e-3;

/**
 * Adapt a {@link VideoElementLike} (the host's audio `<audio>`/`<video>` handle)
 * into the {@link AudioElementLike} surface the AudioSyncPool writes. The pool
 * reads `currentTime` / `volume` / `paused` and calls `play` / `pause`; a real
 * HTMLAudioElement carries `volume`/`paused` already — the casts only satisfy the
 * structural minimum so a bare fake works in tests too.
 */
function toAudioElement(el: VideoElementLike): AudioElementLike {
  const withMedia = el as unknown as { volume?: number; paused?: boolean };
  return {
    get currentTime() {
      return el.currentTime;
    },
    set currentTime(v: number) {
      el.currentTime = v;
    },
    get volume() {
      return withMedia.volume ?? 1;
    },
    set volume(v: number) {
      withMedia.volume = v;
    },
    get paused() {
      return withMedia.paused ?? true;
    },
    play: () => el.play(),
    pause: () => el.pause(),
  };
}
