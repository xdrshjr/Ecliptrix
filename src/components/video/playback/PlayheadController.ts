/**
 * Playback v2 — playhead controller.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.1 / §5.5
 *       docs/plans/video-editor-playback-optimization/specs/02-playback-state-machine.md §4.4
 *
 * Single writer to `timeline.currentTime` (D2). Filters out non-monotonic
 * reports and throttles writes to one rAF tick. `forceSet` bypasses the
 * filter for ruler drags / ended-replay.
 */

import { PLAYHEAD_THROTTLE_MS } from './internal/constants';
import type { IPlayheadController } from './types';

export interface PlayheadControllerOptions {
  /** Throttle window in ms. Default: one rAF tick. */
  throttleMs?: number;
  /** Callback invoked after the monotonic + throttle filter passes. */
  onWrite?: (compositionTime: number) => void;
  /** Optional: telemetry hook for D2 regression rejection. Spec 08 §3.1. */
  onRegression?: (lastT: number, attempted: number) => void;
  /** Test seam — defaults to {@link performance.now}. */
  now?: () => number;
}

export class PlayheadController implements IPlayheadController {
  private _last = -Infinity;
  private _lastWriteMs = 0;
  private readonly _throttleMs: number;
  private _onWrite?: (t: number) => void;
  private _onRegression?: (lastT: number, attempted: number) => void;
  private readonly _now: () => number;

  constructor(opts: PlayheadControllerOptions = {}) {
    this._throttleMs = opts.throttleMs ?? PLAYHEAD_THROTTLE_MS;
    this._onWrite = opts.onWrite;
    this._onRegression = opts.onRegression;
    this._now =
      opts.now ??
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now.bind(performance)
        : Date.now);
  }

  reportCompositionTime(t: number): void {
    if (!Number.isFinite(t)) return;
    if (t < this._last) {
      this._onRegression?.(this._last, t);
      return;
    }
    if (t === this._last) return;
    const now = this._now();
    const neverWritten = this._last === -Infinity;
    if (!neverWritten && now - this._lastWriteMs < this._throttleMs) return;
    this._last = t;
    this._lastWriteMs = now;
    this._onWrite?.(t);
  }

  /** Bypass the monotonic filter (used by ruler drag / user seek / replay). */
  forceSet(t: number): void {
    if (!Number.isFinite(t)) return;
    this._last = t;
    this._lastWriteMs = this._now();
    this._onWrite?.(t);
  }

  reset(): void {
    this._last = -Infinity;
    this._lastWriteMs = 0;
  }

  /** Replace the write sink. Used by Engine.attach to bind into timeline store. */
  bindOnWrite(fn: (t: number) => void): void {
    this._onWrite = fn;
  }

  /** Replace the regression sink. Used by Engine.attach to wire telemetry. */
  bindOnRegression(fn: (lastT: number, attempted: number) => void): void {
    this._onRegression = fn;
  }

  /** Last successfully written compositionTime; -Infinity before first write. */
  getLast(): number {
    return this._last;
  }
}

/**
 * Factory binding a PlayheadController to a timeline store's `setCurrentTime`.
 * Spec §3.1 / §5.5 — single writer.
 */
export function bindToTimelineStore(
  setCurrentTime: (t: number) => void,
  opts: Omit<PlayheadControllerOptions, 'onWrite'> = {},
): PlayheadController {
  return new PlayheadController({ ...opts, onWrite: setCurrentTime });
}
