/**
 * Playback v2 — orchestration state machine.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2 / §5.1
 *       docs/plans/video-editor-playback-v2-phase3/spec.md §3.2.2 / §3.2.3 / §3.4
 *       docs/plans/video-editor-playback-optimization/specs/02-playback-state-machine.md §3.2
 *
 * Phase 3 refactor: removes the direct `<video>` reference (`_activeVideo`)
 * and routes all element access through the {@link AbBufferController}. The
 * tick loop now also handles boundary prewarm + same-tick swap.
 */

import { AbBufferController, BufferError } from './AbBufferController';
import { CanvasCompositor } from './CanvasCompositor';
import { PlaybackClock } from './PlaybackClock';
import { PlayheadController } from './PlayheadController';
import { PLAYBACK_EVENTS, PlaybackTelemetry } from './telemetry';
import {
  DRIFT_HARD_MS,
  DRIFT_HARD_TRIP_COUNT,
  DRIFT_SAMPLE_INTERVAL_MS,
  DRIFT_SOFT_MS,
  DRIFT_SOFT_RATE_DELTA,
  PREPARING_TIMEOUT_MS,
  PREWARM_LEAD_SEC,
  SHORT_CLIP_THRESHOLD_SEC,
  TICK_FPS_REPORT_INTERVAL_MS,
  VISIBILITY_RESUME_MAX_MS,
} from './internal/constants';
import type {
  IPlaybackEngine,
  PlaybackEngineAttachDeps,
  PlaybackIntent,
  PlaybackPhase,
} from './types';
import type { VideoSequenceItem } from '../types';

export interface PlaybackEngineDeps {
  clock?: PlaybackClock;
  buffer?: AbBufferController;
  compositor?: CanvasCompositor;
  playhead?: PlayheadController;
  telemetry?: PlaybackTelemetry | null;
  /** Test seam — defaults to {@link performance.now}. */
  now?: () => number;
}

interface SequenceContext {
  index: number;
  id: string;
  startTime: number;
  duration: number;
}

export class PlaybackEngine implements IPlaybackEngine {
  private _phase: PlaybackPhase = 'idle';
  private readonly _listeners = new Set<(phase: PlaybackPhase) => void>();
  readonly clock: PlaybackClock;
  readonly buffer: AbBufferController;
  readonly compositor: CanvasCompositor;
  readonly playhead: PlayheadController;
  private readonly _telemetry: PlaybackTelemetry | null;
  private readonly _now: () => number;

  // Attached deps
  private _deps: PlaybackEngineAttachDeps | null = null;
  private _clockUnsub: (() => void) | null = null;
  private _bufferErrorUnsub: (() => void) | null = null;

  // Runtime state
  private _rate = 1;
  private _volume = 0.8;
  private _activeSeq: SequenceContext | null = null;
  private _wasRunningBeforeBg = false;
  private _bgPauseWallTime: number | null = null;
  private _bgPauseCompTime = 0;
  private _seekAbortToken = 0;
  private _killed = false;
  private _disposed = false;
  private _prewarmTriggered = false;

  // Watchdog / sample / fps reporting
  private _prepareTimerId: ReturnType<typeof setTimeout> | null = null;
  private _lastFpsReportWall = 0;
  private _lastDrawnAtReport = 0;
  private _lastDroppedAtReport = 0;

  // Drift state
  private _lastDriftSampleWall = 0;
  private _hardResyncTrip = 0;
  private _softCorrectionTimerId: ReturnType<typeof setTimeout> | null = null;

  // First-frame timing
  private _intentStartWall: number | null = null;
  private _firstFrameAfterIntent = false;
  private _lastSeekSource: 'ruler' | 'controls' | 'video_end' = 'controls';

  // Visibility
  private _visibilityHandler: (() => void) | null = null;

  constructor(deps: PlaybackEngineDeps = {}) {
    this.clock = deps.clock ?? new PlaybackClock();
    this.buffer = deps.buffer ?? new AbBufferController();
    this.compositor = deps.compositor ?? new CanvasCompositor();
    this.playhead = deps.playhead ?? new PlayheadController();
    this._telemetry = deps.telemetry ?? null;
    this._now =
      deps.now ??
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now.bind(performance)
        : Date.now);
  }

  /** Wire engine to its render targets and timeline facade. Spec §5.1. */
  attach(deps: PlaybackEngineAttachDeps): void {
    if (this._disposed) {
      throw new Error('PlaybackEngine.attach: instance has been disposed');
    }
    this._deps = deps;
    try {
      this.compositor.attach(deps.canvas, deps.viewport ?? undefined);
      // Bridge resolver + timeline lookup into the buffer so it can find
      // sequences by id (phase-3 spec §3.4 / spec §10 F1).
      const enhancedResolver = {
        ...deps.resolver,
        getSequenceById: (sequenceId: string): VideoSequenceItem | null => {
          if (deps.resolver.getSequenceById) {
            return deps.resolver.getSequenceById(sequenceId);
          }
          try {
            const all = deps.timeline.getSequences();
            return all.find((s) => s.id === sequenceId) ?? null;
          } catch {
            return null;
          }
        },
      };
      this.buffer.setElements({
        a: deps.activeVideo,
        b: deps.prewarmVideo ?? null,
      });
      this.buffer.setCompositor(this.compositor);
      this.buffer.setResolver(enhancedResolver);
      this.compositor.setActiveSource(deps.activeVideo);
    } catch (err) {
      this._fatal(`compositor_attach_failed:${(err as Error)?.message ?? 'unknown'}`);
      return;
    }

    this.playhead.bindOnWrite((t) => {
      try {
        deps.timeline.setCurrentTime(t);
      } catch {
        // ignore — timeline failures are user-visible elsewhere
      }
    });
    this.playhead.bindOnRegression((lastT, attempted) => {
      this._telemetry?.count(PLAYBACK_EVENTS.PLAYHEAD_REGRESSION, {
        lastT: Number(lastT.toFixed(3)),
        attempted: Number(attempted.toFixed(3)),
      });
    });

    this._clockUnsub = this.clock.subscribe((comp, deltaMs) => this._onTick(comp, deltaMs));

    if (typeof document !== 'undefined') {
      this._visibilityHandler = () => {
        if (document.visibilityState === 'hidden') {
          this.dispatch({ kind: 'enterBackground' });
        } else if (document.visibilityState === 'visible') {
          this.dispatch({ kind: 'returnToForeground' });
        }
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    this._bufferErrorUnsub = this.buffer.subscribeError((err) => {
      const code = err.code;
      if (typeof code === 'number' && (code === 3 /* DECODE */ || code === 4 /* SRC_NOT_SUPPORTED */)) {
        this._fatal(`video_error:${code}`);
        return;
      }
      if (code === 'short_clip_handover') {
        // swapActive fallback path — engine parks in 'preparing' until the
        // async bindActive completes (spec §3.2.3 (b) fallback branch).
        this._telemetry?.count(PLAYBACK_EVENTS.STALLED_EVENT, {
          reason: 'short_clip_handover',
        });
        this._setPhase('preparing');
        void this._handleSwapFallbackRebind();
        return;
      }
      this._telemetry?.count(PLAYBACK_EVENTS.STALLED_EVENT, {
        reason: 'media_event',
        code: typeof code === 'number' ? code : 0,
      });
      this._setPhase('stalled');
    });
  }

  dispatch(intent: PlaybackIntent): void {
    if (this._disposed || this._killed) return;
    switch (intent.kind) {
      case 'play':
        void this._handlePlay();
        break;
      case 'pause':
        this._handlePause();
        break;
      case 'seek':
        this._lastSeekSource = intent.source ?? 'controls';
        void this._handleSeek(intent.compositionTime);
        break;
      case 'setRate':
        this._handleSetRate(intent.rate);
        break;
      case 'setVolume':
        this._handleSetVolume(intent.volume);
        break;
      case 'enterBackground':
        this._handleEnterBackground();
        break;
      case 'returnToForeground':
        void this._handleReturnToForeground();
        break;
    }
  }

  getPhase(): PlaybackPhase {
    return this._phase;
  }

  subscribe(listener: (phase: PlaybackPhase) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Release rAF, listeners, telemetry, and detach the compositor. Calling
   * dispatch / attach after dispose is a no-op (or throws, respectively).
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.clock.stop();
    this._clockUnsub?.();
    this._clockUnsub = null;
    this._bufferErrorUnsub?.();
    this._bufferErrorUnsub = null;
    if (this._prepareTimerId !== null) {
      clearTimeout(this._prepareTimerId);
      this._prepareTimerId = null;
    }
    if (this._softCorrectionTimerId !== null) {
      clearTimeout(this._softCorrectionTimerId);
      this._softCorrectionTimerId = null;
    }
    if (typeof document !== 'undefined' && this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
    try {
      this._activeEl()?.pause();
    } catch {
      // ignore
    }
    try {
      this.compositor.detach();
    } catch {
      // ignore
    }
    this.playhead.reset();
    this._setPhase('disposed');
  }

  // ------------------------------------------------------------------
  // Test introspection
  // ------------------------------------------------------------------

  _peekInternal() {
    return {
      phase: this._phase,
      rate: this._rate,
      volume: this._volume,
      activeSeq: this._activeSeq,
      wasRunningBeforeBg: this._wasRunningBeforeBg,
      seekAbortToken: this._seekAbortToken,
      hardResyncTrip: this._hardResyncTrip,
      killed: this._killed,
      disposed: this._disposed,
      prewarmTriggered: this._prewarmTriggered,
    };
  }

  // ------------------------------------------------------------------
  // Intent handlers
  // ------------------------------------------------------------------

  private async _handlePlay(): Promise<void> {
    if (!this._deps) return;
    if (this._phase === 'playing' || this._phase === 'preparing') return;

    this._intentStartWall = this._now();
    this._firstFrameAfterIntent = true;
    this._setPhase('preparing');

    try {
      const tl = this._deps.timeline;
      let comp = tl.getCurrentTime();
      if (this._phase === 'ended' || comp >= Math.max(tl.getTotalDuration() - 1e-3, 0)) {
        comp = 0;
        this.playhead.forceSet(0);
      }
      const seq = this._resolveSequenceAt(comp);
      if (!seq) {
        this._setPhase('paused');
        return;
      }

      this._armPrepareWatchdog();
      let video: HTMLVideoElement;
      try {
        video = await this.buffer.bindActive(seq.id, comp - seq.startTime);
      } catch (err) {
        this._clearPrepareWatchdog();
        const reason = err instanceof BufferError ? err.reason : (err as Error)?.message;
        this._telemetry?.count(PLAYBACK_EVENTS.ERROR, {
          code: 'bind_active_failed',
          message: reason ?? 'unknown',
        });
        this._setPhase('stalled');
        return;
      }

      video.playbackRate = this._rate;
      video.volume = this._volume;
      video.muted = this._volume <= 0;

      try {
        await video.play();
      } catch (err) {
        this._clearPrepareWatchdog();
        this._telemetry?.count(PLAYBACK_EVENTS.ERROR, {
          code: 'play_rejected',
          message: (err as Error)?.message ?? 'unknown',
        });
        this._setPhase('stalled');
        return;
      }
      this._clearPrepareWatchdog();

      this._activeSeq = seq;
      this._prewarmTriggered = false;
      this.clock.start(comp, this._now(), this._rate);
      this._setPhase('playing');
    } catch (err) {
      this._fatal(`play_setup:${(err as Error)?.message ?? 'unknown'}`);
    }
  }

  private _handlePause(): void {
    if (!this._deps) return;
    this.clock.stop();
    const el = this._activeEl();
    if (el) {
      try {
        el.pause();
      } catch {
        // ignore
      }
    }
    if (this._phase !== 'ended') this._setPhase('paused');
  }

  private async _handleSeek(t: number): Promise<void> {
    if (!this._deps) return;
    const wasPlaying = this._phase === 'playing';
    const token = ++this._seekAbortToken;
    this.clock.stop();
    this._setPhase('seeking');

    const seq = this._resolveSequenceAt(Math.max(0, t));
    if (!seq) {
      this._setPhase('paused');
      return;
    }
    const localOffset = Math.max(0, t - seq.startTime);
    let video: HTMLVideoElement;
    try {
      video = await this.buffer.bindActive(seq.id, localOffset);
    } catch (err) {
      this._fatal(`seek_load:${(err as Error)?.message ?? 'unknown'}`);
      return;
    }
    if (token !== this._seekAbortToken) return;

    this._activeSeq = seq;
    this._prewarmTriggered = false;
    this.playhead.forceSet(t);
    this._intentStartWall = this._now();
    this._firstFrameAfterIntent = true;

    if (wasPlaying) {
      try {
        await video.play();
      } catch (err) {
        this._telemetry?.count(PLAYBACK_EVENTS.ERROR, {
          code: 'play_rejected_after_seek',
          message: (err as Error)?.message ?? 'unknown',
        });
        this._setPhase('paused');
        return;
      }
      if (token !== this._seekAbortToken) return;
      this.clock.start(t, this._now(), this._rate);
      this._setPhase('playing');
    } else {
      // Paint a single frame at the new position.
      this.compositor.drawFrame({
        compositionTime: t,
        sequenceIndex: seq.index,
        sequenceLocalTime: localOffset,
        source: video,
      });
      this._setPhase('paused');
    }
  }

  private _handleSetRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) return;
    const prev = this._rate;
    this._rate = rate;
    this.clock.setRate(rate);
    const el = this._activeEl();
    if (el) {
      el.playbackRate = rate;
    }
    this._telemetry?.record(PLAYBACK_EVENTS.RATE_CHANGE, undefined, { from: prev, to: rate });
  }

  private _handleSetVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const v = Math.max(0, Math.min(1, volume));
    this._volume = v;
    const el = this._activeEl();
    if (el) {
      el.volume = v;
      el.muted = v <= 0;
    }
  }

  private _handleEnterBackground(): void {
    this._wasRunningBeforeBg = this.clock.isRunning();
    this._bgPauseWallTime = this._now();
    this._bgPauseCompTime = this.clock.getCompositionTime();
    this.clock.stop();
    const el = this._activeEl();
    if (el) {
      try {
        el.pause();
      } catch {
        // ignore
      }
    }
  }

  private async _handleReturnToForeground(): Promise<void> {
    if (!this._deps) return;
    if (!this._wasRunningBeforeBg || this._bgPauseWallTime === null) return;
    const wallDelta = this._now() - this._bgPauseWallTime;
    this._bgPauseWallTime = null;
    if (wallDelta < VISIBILITY_RESUME_MAX_MS) {
      const seq = this._resolveSequenceAt(this._bgPauseCompTime);
      if (!seq) {
        this._setPhase('paused');
        return;
      }
      const local = Math.max(0, this._bgPauseCompTime - seq.startTime);
      let video: HTMLVideoElement;
      try {
        video = await this.buffer.bindActive(seq.id, local);
        await video.play();
      } catch (err) {
        this._telemetry?.count(PLAYBACK_EVENTS.ERROR, {
          code: 'play_rejected_after_visibility',
          message: (err as Error)?.message ?? 'unknown',
        });
        this._setPhase('paused');
        return;
      }
      this._activeSeq = seq;
      this.clock.start(this._bgPauseCompTime, this._now(), this._rate);
      this._setPhase('playing');
    } else {
      this._setPhase('paused');
    }
  }

  // ------------------------------------------------------------------
  // rAF tick — phase-3 boundary detection
  // ------------------------------------------------------------------

  private _onTick(comp: number, deltaMs: number): void {
    if (this._disposed || this._killed || !this._deps) return;
    const activeEl = this._activeEl();
    if (!activeEl) return;
    try {
      const tl = this._deps.timeline;
      const total = tl.getTotalDuration();
      if (total > 0 && comp >= total) {
        this.clock.stop();
        if (activeEl && !activeEl.paused) {
          try {
            activeEl.pause();
          } catch {
            // ignore
          }
        }
        this.playhead.forceSet(total);
        this._setPhase('ended');
        return;
      }

      // (a) Prewarm next sequence ahead of boundary. Phase-3 §3.2.3 (a).
      const seqCtx = this._activeSeq;
      if (seqCtx && this._phase === 'playing') {
        const end = seqCtx.startTime + seqCtx.duration;
        if (!this._prewarmTriggered && comp >= end - PREWARM_LEAD_SEC) {
          const next = this._sequenceAtIndex(seqCtx.index + 1);
          if (next && (next.duration ?? 0) >= SHORT_CLIP_THRESHOLD_SEC) {
            void this.buffer.prewarmNext(next.id);
            this._prewarmTriggered = true;
          }
        }

        // (b) Boundary swap. Phase-3 §3.2.3 (b) / INV2.
        if (comp >= end) {
          const next = this._sequenceAtIndex(seqCtx.index + 1);
          if (!next) {
            this.dispatch({ kind: 'pause' });
            this._setPhase('ended');
            return;
          }
          let newActive: HTMLVideoElement;
          try {
            newActive = this.buffer.swapActive();
          } catch (err) {
            this._fatal(`swap_failed:${(err as Error)?.message ?? 'unknown'}`);
            return;
          }
          // swap returned old active (fallback) — engine already parked in
          // 'preparing' via subscribeError. Skip frame for this tick.
          if (this.buffer.getActiveElement() === newActive && newActive !== activeEl) {
            // fast path: roles flipped, newActive is the prewarmed buffer.
            this._activeSeq = {
              index: seqCtx.index + 1,
              id: next.id,
              startTime: next.startTime ?? end,
              duration: next.duration ?? 0,
            };
            this._prewarmTriggered = false;
            try {
              newActive.playbackRate = this._rate;
              newActive.muted = this._volume === 0;
              newActive.volume = this._volume;
            } catch {
              // ignore
            }
            try {
              void newActive.play();
            } catch {
              // ignore — error path covered via subscribeError
            }
            this.compositor.setActiveSource(newActive);
            // Reanchor clock without restarting rAF.
            this.clock.reanchor(comp);
          }
        }
      }

      const seq = this._resolveSequenceAt(comp);
      if (!seq) return;
      const localTime = Math.max(0, comp - seq.startTime);

      // Push overlays just before draw — provider is cheap (memoized upstream).
      try {
        this.compositor.setOverlays(this._deps.overlaysProvider());
      } catch {
        // ignore overlays errors (do not poison frame)
      }

      const draw = this._activeEl();
      this.compositor.drawFrame({
        compositionTime: comp,
        sequenceIndex: seq.index,
        sequenceLocalTime: localTime,
        source: draw,
      });

      this.playhead.reportCompositionTime(comp);

      this._maybeReportFirstFrame();
      this._maybeReportFps(deltaMs);
      this._maybeCorrectDrift(seq.index, localTime);
    } catch (err) {
      this._fatal(`tick_error:${(err as Error)?.message ?? 'unknown'}`);
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async _handleSwapFallbackRebind(): Promise<void> {
    if (!this._deps) return;
    const cur = this._activeSeq;
    if (!cur) return;
    const next = this._sequenceAtIndex(cur.index + 1);
    if (!next) return;
    try {
      const el = await this.buffer.bindActive(next.id, 0);
      el.playbackRate = this._rate;
      el.volume = this._volume;
      el.muted = this._volume <= 0;
      try {
        await el.play();
      } catch {
        // ignore
      }
      this._activeSeq = {
        index: cur.index + 1,
        id: next.id,
        startTime: next.startTime ?? cur.startTime + cur.duration,
        duration: next.duration ?? 0,
      };
      this._prewarmTriggered = false;
      this.clock.reanchor(cur.startTime + cur.duration);
      this._setPhase('playing');
    } catch (err) {
      this._fatal(`swap_fallback:${(err as Error)?.message ?? 'unknown'}`);
    }
  }

  private _activeEl(): HTMLVideoElement | null {
    return this.buffer.getActiveElement();
  }

  private _resolveSequenceAt(comp: number): SequenceContext | null {
    if (!this._deps) return null;
    const r = this._deps.timeline.findSequenceAtCompositionTime(comp);
    if (!r) return null;
    return {
      index: r.index,
      id: r.sequence.id,
      startTime: r.startTime,
      duration: r.sequence.duration,
    };
  }

  private _sequenceAtIndex(index: number): VideoSequenceItem | null {
    if (!this._deps) return null;
    const seqs = this._deps.timeline.getSequences();
    return seqs[index] ?? null;
  }

  private _mapToMediaTime(index: number, sequenceOffset: number): number {
    if (!this._deps) return sequenceOffset;
    const seqs = this._deps.timeline.getSequences();
    const seq = seqs[index];
    if (!seq) return sequenceOffset;
    return this._deps.resolver.mapToMediaTime(seq, sequenceOffset);
  }

  private _armPrepareWatchdog(): void {
    this._clearPrepareWatchdog();
    this._prepareTimerId = setTimeout(() => {
      this._prepareTimerId = null;
      if (this._phase !== 'preparing') return;
      this._telemetry?.count(PLAYBACK_EVENTS.STALLED_EVENT, {
        reason: 'preparing_timeout',
      });
      this._setPhase('stalled');
    }, PREPARING_TIMEOUT_MS);
  }

  private _clearPrepareWatchdog(): void {
    if (this._prepareTimerId !== null) {
      clearTimeout(this._prepareTimerId);
      this._prepareTimerId = null;
    }
  }

  private _maybeReportFirstFrame(): void {
    if (!this._firstFrameAfterIntent || this._intentStartWall === null) return;
    const dt = this._now() - this._intentStartWall;
    this._firstFrameAfterIntent = false;
    if (this._lastSeekSource && this._phase === 'playing' && this._intentStartWall != null) {
      this._telemetry?.record(PLAYBACK_EVENTS.SEEK_TO_FIRST_FRAME_MS, dt, {
        source: this._lastSeekSource,
      });
    }
    this._telemetry?.record(PLAYBACK_EVENTS.CLICK_TO_FIRST_FRAME_MS, dt);
    this._intentStartWall = null;
  }

  private _maybeReportFps(_deltaMs: number): void {
    const now = this._now();
    if (this._lastFpsReportWall === 0) {
      this._lastFpsReportWall = now;
      const stats0 = this.compositor.getStats();
      this._lastDrawnAtReport = stats0.drawnFrames;
      this._lastDroppedAtReport = stats0.droppedFrames;
      return;
    }
    const wnd = now - this._lastFpsReportWall;
    if (wnd < TICK_FPS_REPORT_INTERVAL_MS) return;
    const stats = this.compositor.getStats();
    const drawnDelta = stats.drawnFrames - this._lastDrawnAtReport;
    const droppedDelta = stats.droppedFrames - this._lastDroppedAtReport;
    const actualFps = wnd > 0 ? (drawnDelta * 1000) / wnd : 0;
    this._telemetry?.record(PLAYBACK_EVENTS.TICK_FPS, undefined, {
      targetFps: stats.targetFps,
      actualFps: Number(actualFps.toFixed(1)),
      drawnFrames: drawnDelta,
      droppedFrames: droppedDelta,
      windowMs: Math.round(wnd),
    });
    if (drawnDelta + droppedDelta > 0) {
      this._telemetry?.record(
        PLAYBACK_EVENTS.CANVAS_DROPPED_FRAME_RATE,
        droppedDelta / (drawnDelta + droppedDelta),
        { cause: 'rolling_window' },
      );
    }
    this._lastFpsReportWall = now;
    this._lastDrawnAtReport = stats.drawnFrames;
    this._lastDroppedAtReport = stats.droppedFrames;
  }

  private _maybeCorrectDrift(seqIndex: number, localTime: number): void {
    const el = this._activeEl();
    if (!el) return;
    const now = this._now();
    if (now - this._lastDriftSampleWall < DRIFT_SAMPLE_INTERVAL_MS) return;
    this._lastDriftSampleWall = now;

    const expectedMediaT = this._mapToMediaTime(seqIndex, localTime);
    const actualMediaT = el.currentTime;
    const drift = Math.abs(actualMediaT - expectedMediaT) * 1000; // ms

    if (drift < DRIFT_SOFT_MS) {
      this._hardResyncTrip = 0;
      return;
    }
    if (drift < DRIFT_HARD_MS) {
      // Soft correction.
      const direction = actualMediaT < expectedMediaT ? 1 : -1;
      try {
        el.playbackRate = this._rate * (1 + direction * DRIFT_SOFT_RATE_DELTA);
      } catch {
        // ignore
      }
      if (this._softCorrectionTimerId !== null) {
        clearTimeout(this._softCorrectionTimerId);
      }
      this._softCorrectionTimerId = setTimeout(() => {
        this._softCorrectionTimerId = null;
        const cur = this._activeEl();
        if (cur) {
          try {
            cur.playbackRate = this._rate;
          } catch {
            // ignore
          }
        }
      }, 1000);
      this._hardResyncTrip = 0;
      return;
    }
    // Hard resync.
    try {
      el.currentTime = expectedMediaT;
    } catch {
      // ignore
    }
    this._telemetry?.record(PLAYBACK_EVENTS.CANVAS_DROPPED_FRAME_RATE, 1, {
      cause: 'hard_resync',
    });
    this._hardResyncTrip += 1;
    if (this._hardResyncTrip >= DRIFT_HARD_TRIP_COUNT) {
      this._telemetry?.count(PLAYBACK_EVENTS.STALLED_EVENT, { reason: 'drift' });
      this._fatal('drift_trip');
    }
  }

  private _fatal(reason: string): void {
    if (this._killed) return;
    this._killed = true;
    this._telemetry?.count(PLAYBACK_EVENTS.ERROR, {
      code: reason,
      phase: this._phase,
    });
    try {
      this.clock.stop();
    } catch {
      // ignore
    }
    try {
      this._activeEl()?.pause();
    } catch {
      // ignore
    }
    this._setPhase('stalled');
    try {
      this._deps?.onKillSwitch?.(reason);
    } catch {
      // ignore
    }
  }

  private _setPhase(next: PlaybackPhase): void {
    if (this._phase === next) return;
    const prev = this._phase;
    this._phase = next;
    this._telemetry?.record(PLAYBACK_EVENTS.PHASE_CHANGED, undefined, {
      from: prev,
      to: next,
      ts: Math.round(this._now()),
    });
    this._listeners.forEach((l) => l(next));
  }
}
