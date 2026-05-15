/**
 * Playback v2 — client-side kill-switch monitor.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase4/spec.md §3.2.4 / §3.3
 *
 * Counts edge-triggered regression / stalled events per session and trips
 * the persistent kill-switch (via {@link tripPlaybackV2KillSwitch}) when
 * either counter exceeds its threshold. INV13: once tripped, the monitor
 * never resets within the same instance; the next page load reads the
 * persisted flag and short-circuits {@link isPlaybackV2Enabled}.
 *
 * Thresholds come from spec §3.2.4. Defaults are sized so a typical
 * single-session burst (≤ ~10 regressions) stays well below the trip
 * point but a runaway state machine flips within seconds.
 */

import { tripPlaybackV2KillSwitch } from '@/lib/playbackFlags';

const DEFAULT_REGRESSION_THRESHOLD = 50;
const DEFAULT_STALLED_THRESHOLD = 30;

export interface KillSwitchMonitorOptions {
  /** Trip after this many monotonic-regression events. Default 50. */
  regressionThreshold?: number;
  /**
   * Trip after this many entries into the `stalled` phase. Counts only
   * transitions (R-P2-5) — repeated reportStalled calls in the same
   * stalled state must be deduped by the caller.
   */
  stalledThreshold?: number;
  /** Test seam — defaults to {@link tripPlaybackV2KillSwitch}. */
  tripImpl?: (reason: string) => void;
}

export interface IKillSwitchMonitor {
  noteRegression(): void;
  noteStalled(): void;
  isTripped(): boolean;
  getCounts(): { regression: number; stalled: number };
  dispose(): void;
}

export class KillSwitchMonitor implements IKillSwitchMonitor {
  private _regressionCount = 0;
  private _stalledCount = 0;
  private _tripped = false;
  private _disposed = false;
  private readonly _regressionThreshold: number;
  private readonly _stalledThreshold: number;
  private readonly _trip: (reason: string) => void;

  constructor(opts: KillSwitchMonitorOptions = {}) {
    this._regressionThreshold = Math.max(
      1,
      opts.regressionThreshold ?? DEFAULT_REGRESSION_THRESHOLD,
    );
    this._stalledThreshold = Math.max(
      1,
      opts.stalledThreshold ?? DEFAULT_STALLED_THRESHOLD,
    );
    this._trip = opts.tripImpl ?? tripPlaybackV2KillSwitch;
  }

  noteRegression(): void {
    if (this._disposed || this._tripped) return;
    this._regressionCount += 1;
    if (this._regressionCount >= this._regressionThreshold) {
      this._tripOnce('regression-overflow');
    }
  }

  noteStalled(): void {
    if (this._disposed || this._tripped) return;
    this._stalledCount += 1;
    if (this._stalledCount >= this._stalledThreshold) {
      this._tripOnce('stalled-overflow');
    }
  }

  isTripped(): boolean {
    return this._tripped;
  }

  getCounts(): { regression: number; stalled: number } {
    return {
      regression: this._regressionCount,
      stalled: this._stalledCount,
    };
  }

  dispose(): void {
    this._disposed = true;
  }

  private _tripOnce(reason: string): void {
    if (this._tripped) return;
    this._tripped = true;
    try {
      this._trip(reason);
    } catch {
      // Persistence must never throw into the playback hot path.
    }
  }
}
