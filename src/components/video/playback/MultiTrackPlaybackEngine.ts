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
import { VideoSourcePool, type VideoElementLike, type TrackSourcePlan } from './VideoSourcePool';
import { AudioSyncPool, type AudioSyncGroup, type AudioElementLike } from './AudioSyncPool';
import { assembleLayers, type ActiveVideoEntry } from './internal/assembleLayers';
import {
  isPreviewDebugEnabled,
  formatTrackDiagnostics,
  PREVIEW_DEBUG_INTERVAL_MS,
  type TrackDiagnosticRow,
} from './internal/previewDebug';
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

  // §5.3 — readiness-repaint listeners bound to decode elements on first
  // resolution; unbound on dispose to avoid leaking listeners.
  private readonly _readinessBound: ReadinessListenerBinding[] = [];
  // Last composition time actually rendered. The readiness repaint re-paints
  // THIS frame; `clock.getCompositionTime()` is stale after a paused seek (the
  // clock base is only re-anchored on play / seek-while-playing), so we track
  // the real last-rendered time instead. See spec "实施过程发现的方案缺陷".
  private _lastRenderComp = 0;
  // timeline-preview-midclip-play-black-screen 方案 A — start-from-non-zero
  // readiness handshake. When play()/seek(while playing) starts, the wall-clock
  // composition time free-runs from the start position, but the lead decode
  // <video> may still be seeking/buffering to that position. Left alone the
  // clock races ahead of the decode and the compositor paints only the black
  // letterbox. We arm a one-shot listener on the lead element and, the moment it
  // confirms it reached the target (`seeked`) or began advancing (`playing`),
  // re-anchor the clock back to the start comp AND force a repaint so clock and
  // decode line up and the corrected frame is painted at once (Bug A / A1).
  //
  // The handshake is NOT dropped on a wall-clock budget (round-3 fix A3-a): a
  // real cold seek to an unbuffered mid-clip position routinely takes longer
  // than the old 500ms budget, and dropping the handshake before the element
  // settles let the free-running clock keep leading the decode, so the next
  // _ensureSeeked yanked the element forward into a fresh cold seek — the
  // death-spiral that kept the canvas black. Keeping it alive until the element
  // actually settles guarantees reanchor-on-settle, which breaks the spiral. A
  // still-armed handshake is harmless (the clock already free-runs); it is
  // released the moment a `seeked`/`playing` fires, or on the next
  // play/seek/pause/dispose. Null when no handshake is pending.
  private _startReanchor: StartReanchorHandshake | null = null;
  // §5.4 runtime diagnostics — resolved once at attach so a production preview
  // (flag off) pays nothing per frame.
  private _debugEnabled = false;
  private _lastDebugMs = 0;

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
    this._debugEnabled = isPreviewDebugEnabled();
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
        if (!els) return null;
        // §5.3: subscribe a readiness repaint on the FIRST resolution of each
        // decode element (the host creates them lazily). Idempotent + guarded +
        // unbound on dispose inside _bindReadinessRepaint.
        this._bindReadinessRepaint(els.active);
        this._bindReadinessRepaint(els.prewarm);
        return { active: els.active, prewarm: els.prewarm };
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

  /**
   * Composition time of the LAST rendered frame — i.e. what the canvas is
   * currently showing. The orchestration hook reads this to (a) flush the
   * precise stop position into React on pause and (b) distinguish engine echo
   * from a real user scrub while playing
   * (timeline-preview-playback-stutter A-c / D). Uses `_lastRenderComp` (not
   * `clock.getCompositionTime()`) because the clock base is stale after a
   * paused seek; the last-rendered comp is always the displayed truth.
   */
  getCompositionTime(): number {
    return this._lastRenderComp;
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
    this._armStartReanchor(comp);
  }

  pause(): void {
    if (this._disposed || !this._deps) return;
    this.clock.stop();
    this._disarmStartReanchor();
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
      this._armStartReanchor(target);
    } else {
      this._disarmStartReanchor();
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
    this._disarmStartReanchor();
    this._unbindReadinessRepaint();
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
    // Round-3 fix A3-a: the start-reanchor handshake is deliberately NOT dropped
    // on a wall-clock budget here. A slow cold seek must be able to outlive the
    // tick loop so its late `seeked`/`playing` still re-anchors the clock onto
    // the settled element (see _startReanchor field doc). The handshake releases
    // itself the moment it fires, or on the next play/seek/pause/dispose.
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
    this._lastRenderComp = comp;
    const tl = this._deps.timeline;
    const groups = tl.getVideoTrackGroups();

    const synced = this._videoPool.sync(groups, comp, isPlaying);
    const videoEntries = this._buildVideoEntries(groups, synced, comp);
    const layers = this._assemble(videoEntries, comp);
    this.compositor.renderFrame(layers);

    this._audioPool.tick(tl.getAudioSyncGroups(), comp, isPlaying);

    if (this._debugEnabled) this._emitDebug(synced);
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

  // ------------------------------------------------------------------
  // §5.3 — readiness-driven single repaint (paused first frame / scrub / late
  // metadata). Bound on first element resolution, unbound on dispose.
  // ------------------------------------------------------------------

  /**
   * Subscribe `loadeddata` / `seeked` / `canplay` on a decode element so a
   * non-playing preview repaints one frame the moment the source becomes
   * drawable. Hard constraints (R-5):
   *   - skip when the element is not a real EventTarget (the structural fake has
   *     no addEventListener) — never throw on a plain object stub;
   *   - de-dupe with `__ecliptrixReadinessBound` so a re-resolved element is not
   *     bound twice;
   *   - record every (element, type, handler) so {@link dispose} can unbind.
   * When NOT playing, the rAF loop is idle so this is the only thing that can
   * paint a freshly-drawable source — it always repaints. When playing, the rAF
   * loop owns the path, so we normally stand down; the ONE exception (Bug A /
   * A2 defensive补画) is when the last composed frame came up empty (every video
   * source was below readyState 2, e.g. during a cold mid-clip seek) — then we
   * paint a single corrected frame the instant a source becomes drawable instead
   * of waiting for the rAF loop to land on a ready source. This is a one-shot per
   * readiness event and re-uses the same per-frame pipeline (`_renderAt`), so it
   * does not break the "playing is owned by rAF" invariant.
   */
  private _bindReadinessRepaint(el: VideoElementLike | null): void {
    if (!el) return;
    const target = el as ReadinessBindable;
    if (typeof target.addEventListener !== 'function' || target.__ecliptrixReadinessBound) {
      return;
    }
    target.__ecliptrixReadinessBound = true;
    const handler = () => {
      if (this._disposed) return;
      if (this.getPhase() === 'playing') {
        // A2: only補画 when the rAF loop's last frame came up black AND no
        // start-reanchor handshake is pending. The handshake (A1) owns the
        // settle repaint and re-anchors the clock FIRST; repainting here before
        // it re-anchors would feed _ensureSeeked a still-leading clock target
        // and yank the just-settled element into a fresh cold seek — the very
        // spiral this fix closes. Once the handshake has fired/disarmed and the
        // clock tracks the element, this safely covers any residual black frame.
        if (!this._startReanchor && !this.compositor.lastFrameDrewAny()) {
          this._renderAt(this.clock.getCompositionTime(), true);
        }
        return;
      }
      this._renderAt(this._lastRenderComp, false);
    };
    for (const type of READINESS_EVENTS) {
      target.addEventListener(type, handler);
      this._readinessBound.push({ el: target, type, handler });
    }
  }

  private _unbindReadinessRepaint(): void {
    for (const { el, type, handler } of this._readinessBound) {
      try {
        el.removeEventListener?.(type, handler);
        el.__ecliptrixReadinessBound = false;
      } catch {
        // ignore — element may already be gone
      }
    }
    this._readinessBound.length = 0;
  }

  // ------------------------------------------------------------------
  // 方案 A — start-from-non-zero readiness handshake
  // (timeline-preview-midclip-play-black-screen).
  // ------------------------------------------------------------------

  /**
   * Arm a one-shot handshake so the free-running composition clock is re-anchored
   * to `targetComp` once the lead decode element confirms it reached that
   * position. Without this, starting playback from the middle of a clip lets the
   * clock race ahead of a still-seeking <video>; {@link VideoSourcePool}'s
   * in-flight seek guard keeps the seek from being interrupted, and this
   * re-anchor pulls the clock back onto the element the instant it is drawable —
   * together they remove the play-from-middle black screen.
   *
   * Listens for `seeked` (the element reached the seek target — the cold-seek
   * path) and `playing` (the element began advancing — the already-buffered
   * startup window). On the first such event while playing we re-anchor the clock
   * to `targetComp` AND immediately repaint that frame (Bug A / A1): the lead
   * element is now drawable at the target, so painting at once avoids the
   * "wait for the next rAF to land on a ready source" window that left the canvas
   * black. Skips silently when the lead element is a plain structural stub (no
   * `addEventListener`, as in tests) or when there is no lead video to wait on
   * (pure-audio timeline / no active clip).
   */
  private _armStartReanchor(targetComp: number): void {
    this._disarmStartReanchor();
    if (this._disposed || !this._deps) return;
    const lead = this._findLeadVideoElement(targetComp) as StartReanchorBindable | null;
    if (!lead || typeof lead.addEventListener !== 'function') return;
    const handler = () => {
      if (this._disposed) return;
      // Only meaningful while playing; a stray late event just disarms.
      if (this.getPhase() === 'playing') {
        this.clock.reanchor(targetComp);
        // A1: paint the corrected frame now — the lead element just became
        // drawable at the target. Without this the running rAF loop might paint
        // one more black frame before its next tick.
        this._renderAt(targetComp, true);
      }
      this._disarmStartReanchor();
    };
    for (const type of START_REANCHOR_EVENTS) {
      lead.addEventListener(type, handler);
    }
    this._startReanchor = { el: lead, handler };
  }

  private _disarmStartReanchor(): void {
    const hs = this._startReanchor;
    if (!hs) return;
    this._startReanchor = null;
    for (const type of START_REANCHOR_EVENTS) {
      try {
        hs.el.removeEventListener?.(type, hs.handler);
      } catch {
        // ignore — element may already be gone
      }
    }
  }

  /**
   * The lead (top-most drawable) active video element at composition time
   * `comp`, or null when no visible video track has an active clip with a
   * resolvable source. Highest z wins so the handshake waits on the element the
   * viewer actually sees first.
   */
  private _findLeadVideoElement(comp: number): VideoElementLike | null {
    if (!this._deps) return null;
    let lead: { z: number; el: VideoElementLike } | null = null;
    for (const group of this._deps.timeline.getVideoTrackGroups()) {
      const hit = activeClipAt(group.items, comp);
      if (!hit || !this._deps.resolveSource(hit.clip)) continue;
      const els = this._deps.resolveTrackElements(group.trackId);
      if (!els || !els.active) continue;
      if (!lead || group.z >= lead.z) lead = { z: group.z, el: els.active };
    }
    return lead ? lead.el : null;
  }

  // ------------------------------------------------------------------
  // §5.4 — runtime diagnostics (default OFF). Throttled ~1/s per-track dump.
  // ------------------------------------------------------------------

  private _emitDebug(
    synced: { plan: TrackSourcePlan; element: VideoElementLike | null }[],
  ): void {
    const now = this._now();
    if (this._lastDebugMs !== 0 && now - this._lastDebugMs < PREVIEW_DEBUG_INTERVAL_MS) {
      return;
    }
    this._lastDebugMs = now;
    const layerStats =
      typeof this.compositor.getLayerStats === 'function'
        ? this.compositor.getLayerStats()
        : {};
    const rows: TrackDiagnosticRow[] = synced.map(({ plan, element }) => {
      const media = element as
        | (VideoElementLike & { networkState?: number; error?: { code?: number } | null })
        | null;
      const stat = layerStats[plan.trackId];
      return {
        trackId: plan.trackId,
        resolvedSrc: plan.desiredUrl,
        readyState: element?.readyState ?? 0,
        networkState: media?.networkState,
        paused: element?.paused,
        muted: element?.muted,
        errorCode: media?.error?.code ?? null,
        currentTime: element?.currentTime,
        desiredSourceTime: plan.desiredSourceTime,
        drawn: stat?.drawn,
        dropped: stat?.dropped,
      };
    });
    try {
      // eslint-disable-next-line no-console
      console.debug(formatTrackDiagnostics(rows));
    } catch {
      // diagnostics must never break the render loop
    }
  }
}

/** Readiness events that drive a single non-playing repaint (§5.3). */
const READINESS_EVENTS = ['loadeddata', 'seeked', 'canplay'] as const;

/**
 * Minimal EventTarget surface for readiness binding (R-5 guards). The structural
 * {@link VideoElementLike} has no `addEventListener`; a real HTMLVideoElement
 * does. `__ecliptrixReadinessBound` de-dupes per element across re-resolution.
 */
type ReadinessBindable = VideoElementLike & {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  __ecliptrixReadinessBound?: boolean;
};

/** One bound readiness listener, tracked for unbind on dispose. */
interface ReadinessListenerBinding {
  el: ReadinessBindable;
  type: string;
  handler: () => void;
}

/**
 * Events that resolve the start-from-non-zero re-anchor handshake (方案 A):
 * `seeked` = the element reached the seek target (cold mid-clip start);
 * `playing` = the element began advancing (already-buffered startup window).
 */
const START_REANCHOR_EVENTS = ['seeked', 'playing'] as const;

/** EventTarget surface the start-reanchor handshake binds to. */
type StartReanchorBindable = VideoElementLike & {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

/** Pending start-reanchor handshake, tracked so it can be disarmed exactly once. */
interface StartReanchorHandshake {
  el: StartReanchorBindable;
  handler: () => void;
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
