/**
 * Playback v2 — playhead controller.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §4.6
 *       docs/plans/video-editor-playback-optimization/specs/02-playback-state-machine.md §4.4
 *
 * Round 1 ships the stub. Throttling + monotonic write filter land in spec 02.
 */

import type { IPlayheadController } from './types';

export interface PlayheadControllerOptions {
  /** Throttle window in ms. Spec 02 default: 16ms (one rAF tick). */
  throttleMs?: number;
  /** Callback invoked after the monotonic filter passes. */
  onWrite?: (compositionTime: number) => void;
}

export class PlayheadController implements IPlayheadController {
  private _last = -Infinity;
  private _lastWriteMs = 0;
  private readonly _throttleMs: number;
  private readonly _onWrite?: (t: number) => void;

  constructor(opts: PlayheadControllerOptions = {}) {
    this._throttleMs = opts.throttleMs ?? 16;
    this._onWrite = opts.onWrite;
  }

  reportCompositionTime(t: number): void {
    if (!Number.isFinite(t)) return;
    if (t < this._last) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this._lastWriteMs < this._throttleMs && t === this._last) return;
    this._last = t;
    this._lastWriteMs = now;
    this._onWrite?.(t);
  }

  /** Bypass the monotonic filter (used by ruler drag / user seek). */
  forceSet(t: number): void {
    if (!Number.isFinite(t)) return;
    this._last = t;
    this._lastWriteMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this._onWrite?.(t);
  }

  reset(): void {
    this._last = -Infinity;
    this._lastWriteMs = 0;
  }
}
