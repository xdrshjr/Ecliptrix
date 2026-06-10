/**
 * Playback v2 — rAF master clock.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2.2
 *       docs/plans/video-editor-playback-optimization/specs/02-playback-state-machine.md §4.3
 *
 * Round 2: real `requestAnimationFrame` loop. `start` schedules the first
 * frame immediately; `stop` cancels any pending rAF in the same tick to
 * satisfy INV3 (no rAF survives a transition out of `playing`). Subscribers
 * receive `(compositionTime, deltaMs)` on every tick.
 *
 * local-video-editing-refactor (spec 02 §2.1 / §3): this is the SOLE
 * composition clock — `compositionTime` is the single time truth. One tick
 * drives BOTH the multi-track video render AND the audio tick
 * ({@link ../AudioSyncPool}); the multi-track engine subscribes once and fans
 * out to compositor + audio inside that handler so the two never drift on
 * separate clocks. `subscribeTick` is a named alias of `subscribe` documenting
 * that intent for the new engine path.
 */

import type { IPlaybackClock } from './types';

type TickHandler = (compositionTime: number, deltaMs: number) => void;

export interface PlaybackClockOptions {
  /** Test seam — defaults to {@link globalThis.requestAnimationFrame}. */
  raf?: (cb: FrameRequestCallback) => number;
  /** Test seam — defaults to {@link globalThis.cancelAnimationFrame}. */
  caf?: (handle: number) => void;
  /** Test seam — defaults to {@link performance.now}. */
  now?: () => number;
}

export class PlaybackClock implements IPlaybackClock {
  private _running = false;
  private _baseCompositionTime = 0;
  private _baseWallTime = 0;
  private _rate = 1;
  private _rafId: number | null = null;
  private _lastTickWall = 0;
  private readonly _handlers = new Set<TickHandler>();
  private readonly _raf: (cb: FrameRequestCallback) => number;
  private readonly _caf: (handle: number) => void;
  private readonly _now: () => number;

  constructor(opts: PlaybackClockOptions = {}) {
    const safeRaf =
      typeof requestAnimationFrame !== 'undefined'
        ? requestAnimationFrame.bind(globalThis)
        : ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
    const safeCaf =
      typeof cancelAnimationFrame !== 'undefined'
        ? cancelAnimationFrame.bind(globalThis)
        : ((id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
    const safeNow =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now.bind(performance)
        : Date.now;
    this._raf = opts.raf ?? safeRaf;
    this._caf = opts.caf ?? safeCaf;
    this._now = opts.now ?? safeNow;
  }

  start(baseCompositionTime: number, baseWallTime: number, rate = 1): void {
    this._baseCompositionTime = Math.max(0, baseCompositionTime);
    this._baseWallTime = baseWallTime;
    this._rate = rate;
    this._lastTickWall = baseWallTime;
    this._running = true;
    this._scheduleTick();
  }

  stop(): void {
    this._running = false;
    if (this._rafId !== null) {
      this._caf(this._rafId);
      this._rafId = null;
    }
  }

  isRunning(): boolean {
    return this._running;
  }

  /** Live-change rate without restarting (re-anchors base). Spec 02 §6. */
  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) return;
    if (this._running) {
      const wall = this._now();
      this._baseCompositionTime = this._currentComp(wall);
      this._baseWallTime = wall;
    }
    this._rate = rate;
  }

  getRate(): number {
    return this._rate;
  }

  /** Move the cursor anchor to a new compositionTime (used after seek). */
  reanchor(compositionTime: number): void {
    this._baseCompositionTime = Math.max(0, compositionTime);
    this._baseWallTime = this._now();
    this._lastTickWall = this._baseWallTime;
  }

  /** Current compositionTime derived from wall clock. */
  getCompositionTime(): number {
    if (!this._running) return this._baseCompositionTime;
    return this._currentComp(this._now());
  }

  subscribe(handler: TickHandler): () => void {
    this._handlers.add(handler);
    return () => {
      this._handlers.delete(handler);
    };
  }

  /**
   * Subscribe to the single composition tick (spec 02 §2.1). Named alias of
   * {@link subscribe} used by the multi-track engine; the handler receives
   * `(compositionTime, deltaMs)` and is expected to drive BOTH the video render
   * and the audio tick so they share one time truth. Returns an unsubscribe fn.
   */
  subscribeTick(handler: TickHandler): () => void {
    return this.subscribe(handler);
  }

  /** Internal: emit a tick to subscribers. Exposed for unit tests. */
  _emitTick(compositionTime: number, deltaMs: number): void {
    this._handlers.forEach((h) => h(compositionTime, deltaMs));
  }

  /** Read-only state introspection used by tests / debug overlays. */
  _getState() {
    return {
      running: this._running,
      baseCompositionTime: this._baseCompositionTime,
      baseWallTime: this._baseWallTime,
      rate: this._rate,
      rafId: this._rafId,
    };
  }

  private _currentComp(wall: number): number {
    return this._baseCompositionTime + ((wall - this._baseWallTime) * this._rate) / 1000;
  }

  private _scheduleTick(): void {
    if (!this._running) return;
    this._rafId = this._raf(() => this._onFrame());
  }

  private _onFrame(): void {
    this._rafId = null;
    if (!this._running) return;
    const wall = this._now();
    const comp = this._currentComp(wall);
    const deltaMs = wall - this._lastTickWall;
    this._lastTickWall = wall;
    this._emitTick(comp, deltaMs);
    // Re-check after handlers may have called stop().
    if (this._running) this._scheduleTick();
  }
}
