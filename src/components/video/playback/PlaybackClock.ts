/**
 * Playback v2 — rAF master clock.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §4.3
 *       docs/plans/video-editor-playback-optimization/specs/02-playback-state-machine.md §4.3
 *
 * Round 1 (spec 01) ships only the interface and a minimal stub. Real
 * `requestAnimationFrame` loop, rate switching, and background pause/resume
 * land in spec 02.
 */

import type { IPlaybackClock } from './types';

type TickHandler = (compositionTime: number, deltaMs: number) => void;

export class PlaybackClock implements IPlaybackClock {
  private _running = false;
  private _baseCompositionTime = 0;
  private _baseWallTime = 0;
  private _rate = 1;
  private readonly _handlers = new Set<TickHandler>();

  start(baseCompositionTime: number, baseWallTime: number, rate: number = 1): void {
    this._baseCompositionTime = baseCompositionTime;
    this._baseWallTime = baseWallTime;
    this._rate = rate;
    this._running = true;
  }

  stop(): void {
    this._running = false;
  }

  isRunning(): boolean {
    return this._running;
  }

  subscribe(handler: TickHandler): () => void {
    this._handlers.add(handler);
    return () => {
      this._handlers.delete(handler);
    };
  }

  /** Internal: spec 02 fills the rAF loop. Exposed for unit tests. */
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
    };
  }
}
