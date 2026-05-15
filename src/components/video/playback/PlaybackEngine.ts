/**
 * Playback v2 — orchestration state machine.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2 / §5.1
 *       docs/plans/video-editor-playback-optimization/specs/02-playback-state-machine.md §3.2
 *
 * Round 2 implementation: real state machine, single-sequence rAF driving,
 * drift correction, kill-switch fallback, and telemetry hooks.
 */

import { AbBufferController } from './AbBufferController';
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
  TICK_FPS_REPORT_INTERVAL_MS,
  VISIBILITY_RESUME_MAX_MS,
} from './internal/constants';
import type {
  IPlaybackEngine,
  PlaybackEngineAttachDeps,
  PlaybackIntent,
  PlaybackPhase,
} from './types';

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
  private _activeVideo: HTMLVideoElement | null = null;
  private _clockUnsub: (() => void) | null = null;

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
  private _videoErrorHandler: (() => void) | null = null;

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
    this._activeVideo = deps.activeVideo;
    try {
      this.compositor.attach(deps.canvas, deps.viewport ?? undefined);
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

    if (this._activeVideo) {
      this._videoErrorHandler = () => {
        const code = this._activeVideo?.error?.code;
        if (code === 3 /* DECODE */ || code === 4 /* SRC_NOT_SUPPORTED */) {
          this._fatal(`video_error:${code}`);
        } else {
          this._telemetry?.count(PLAYBACK_EVENTS.STALLED_EVENT, {
            reason: 'media_event',
            code: code ?? 0,
          });
          this._setPhase('stalled');
        }
      };
      this._activeVideo.addEventListener('error', this._videoErrorHandler);
    }
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
    if (this._activeVideo && this._videoErrorHandler) {
      this._activeVideo.removeEventListener('error', this._videoErrorHandler);
      this._videoErrorHandler = null;
    }
    try {
      this._activeVideo?.pause();
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
    };
  }

  // ------------------------------------------------------------------
  // Intent handlers
  // ------------------------------------------------------------------

  private async _handlePlay(): Promise<void> {
    if (!this._deps || !this._activeVideo) return;
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

      await this._loadSequenceIfNeeded(seq, comp - seq.startTime);

      const video = this._activeVideo;
      video.playbackRate = this._rate;
      video.volume = this._volume;
      video.muted = this._volume <= 0;

      this._armPrepareWatchdog();
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

      this.clock.start(comp, this._now(), this._rate);
      this._setPhase('playing');
    } catch (err) {
      this._fatal(`play_setup:${(err as Error)?.message ?? 'unknown'}`);
    }
  }

  private _handlePause(): void {
    if (!this._deps) return;
    this.clock.stop();
    if (this._activeVideo) {
      try {
        this._activeVideo.pause();
      } catch {
        // ignore
      }
    }
    if (this._phase !== 'ended') this._setPhase('paused');
  }

  private async _handleSeek(t: number): Promise<void> {
    if (!this._deps || !this._activeVideo) return;
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
    try {
      await this._loadSequenceIfNeeded(seq, localOffset);
    } catch (err) {
      this._fatal(`seek_load:${(err as Error)?.message ?? 'unknown'}`);
      return;
    }
    if (token !== this._seekAbortToken) return;

    const mediaT = this._mapToMediaTime(seq.index, localOffset);
    try {
      this._activeVideo.currentTime = mediaT;
    } catch {
      // ignore
    }

    this.playhead.forceSet(t);
    this._intentStartWall = this._now();
    this._firstFrameAfterIntent = true;

    if (wasPlaying) {
      try {
        await this._activeVideo.play();
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
        source: this._activeVideo,
      });
      this._setPhase('paused');
    }
  }

  private _handleSetRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) return;
    const prev = this._rate;
    this._rate = rate;
    this.clock.setRate(rate);
    if (this._activeVideo) {
      this._activeVideo.playbackRate = rate;
    }
    this._telemetry?.record(PLAYBACK_EVENTS.RATE_CHANGE, undefined, { from: prev, to: rate });
  }

  private _handleSetVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const v = Math.max(0, Math.min(1, volume));
    this._volume = v;
    if (this._activeVideo) {
      this._activeVideo.volume = v;
      this._activeVideo.muted = v <= 0;
    }
  }

  private _handleEnterBackground(): void {
    this._wasRunningBeforeBg = this.clock.isRunning();
    this._bgPauseWallTime = this._now();
    this._bgPauseCompTime = this.clock.getCompositionTime();
    this.clock.stop();
    if (this._activeVideo) {
      try {
        this._activeVideo.pause();
      } catch {
        // ignore
      }
    }
  }

  private async _handleReturnToForeground(): Promise<void> {
    if (!this._deps || !this._activeVideo) return;
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
      try {
        this._activeVideo.currentTime = this._mapToMediaTime(seq.index, local);
        await this._activeVideo.play();
      } catch (err) {
        this._telemetry?.count(PLAYBACK_EVENTS.ERROR, {
          code: 'play_rejected_after_visibility',
          message: (err as Error)?.message ?? 'unknown',
        });
        this._setPhase('paused');
        return;
      }
      this.clock.start(this._bgPauseCompTime, this._now(), this._rate);
      this._setPhase('playing');
    } else {
      this._setPhase('paused');
    }
  }

  // ------------------------------------------------------------------
  // rAF tick
  // ------------------------------------------------------------------

  private _onTick(comp: number, deltaMs: number): void {
    if (this._disposed || this._killed || !this._deps || !this._activeVideo) return;
    try {
      const tl = this._deps.timeline;
      const total = tl.getTotalDuration();
      if (total > 0 && comp >= total) {
        this.clock.stop();
        if (this._activeVideo && !this._activeVideo.paused) {
          try {
            this._activeVideo.pause();
          } catch {
            // ignore
          }
        }
        this.playhead.forceSet(total);
        this._setPhase('ended');
        return;
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

      this.compositor.drawFrame({
        compositionTime: comp,
        sequenceIndex: seq.index,
        sequenceLocalTime: localTime,
        source: this._activeVideo,
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

  private async _loadSequenceIfNeeded(
    target: SequenceContext,
    localOffset: number,
  ): Promise<void> {
    if (!this._deps || !this._activeVideo) return;
    const desiredSrc = this._resolveSrc(target.index);
    if (!desiredSrc) {
      throw new Error('no playable src for sequence ' + target.index);
    }
    const video = this._activeVideo;
    const sameSrc =
      this._activeSeq?.index === target.index &&
      normalizeSrc(video.currentSrc) === normalizeSrc(desiredSrc);
    if (!sameSrc) {
      video.src = desiredSrc;
      video.load();
      await waitForReady(video, PREPARING_TIMEOUT_MS);
    }
    this._activeSeq = target;
    const mediaT = this._mapToMediaTime(target.index, localOffset);
    if (Math.abs(video.currentTime - mediaT) > 0.05) {
      try {
        video.currentTime = mediaT;
      } catch {
        // ignore
      }
    }
  }

  private _resolveSequenceAt(comp: number): SequenceContext | null {
    if (!this._deps) return null;
    const r = this._deps.timeline.findSequenceAtCompositionTime(comp);
    if (!r) return null;
    return {
      index: r.index,
      startTime: r.startTime,
      duration: r.sequence.duration,
    };
  }

  private _resolveSrc(index: number): string | null {
    if (!this._deps) return null;
    const seqs = this._deps.timeline.getSequences();
    const seq = seqs[index];
    if (!seq) return null;
    return this._deps.resolver.resolveSrc(seq);
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
    if (!this._activeVideo) return;
    const now = this._now();
    if (now - this._lastDriftSampleWall < DRIFT_SAMPLE_INTERVAL_MS) return;
    this._lastDriftSampleWall = now;

    const expectedMediaT = this._mapToMediaTime(seqIndex, localTime);
    const actualMediaT = this._activeVideo.currentTime;
    const drift = Math.abs(actualMediaT - expectedMediaT) * 1000; // ms

    if (drift < DRIFT_SOFT_MS) {
      this._hardResyncTrip = 0;
      return;
    }
    if (drift < DRIFT_HARD_MS) {
      // Soft correction.
      const direction = actualMediaT < expectedMediaT ? 1 : -1;
      try {
        this._activeVideo.playbackRate = this._rate * (1 + direction * DRIFT_SOFT_RATE_DELTA);
      } catch {
        // ignore
      }
      if (this._softCorrectionTimerId !== null) {
        clearTimeout(this._softCorrectionTimerId);
      }
      this._softCorrectionTimerId = setTimeout(() => {
        this._softCorrectionTimerId = null;
        if (this._activeVideo) {
          try {
            this._activeVideo.playbackRate = this._rate;
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
      this._activeVideo.currentTime = expectedMediaT;
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
      this._activeVideo?.pause();
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

function normalizeSrc(src: string | null | undefined): string {
  if (!src) return '';
  try {
    const u = new URL(src, typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
    return u.href;
  } catch {
    return src;
  }
}

async function waitForReady(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 3) return; // HAVE_FUTURE_DATA
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      if (timer) clearTimeout(timer);
    };
    const onReady = () => {
      if (settled) return;
      if (video.readyState >= 2) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('video load error'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('video load timeout'));
    }, timeoutMs);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
  });
}
