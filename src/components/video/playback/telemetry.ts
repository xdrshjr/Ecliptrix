/**
 * Playback v2 — telemetry SDK.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/08-telemetry-feature-flag-rollout.md §六
 *
 * Buffers `record` / `count` events in memory, batch-flushes them to the
 * backend every {@link PlaybackTelemetryOptions.flushIntervalMs} (default
 * 5s), and force-flushes on `beforeunload`. Failures during flush are
 * swallowed — we never throw into the playback hot path.
 *
 * The SDK is intentionally framework-free: PlaybackEngine, Compositor,
 * PlayheadController, and AbBufferController each take an instance through
 * their constructor (spec 02–04). This keeps tests deterministic and avoids
 * coupling to React context.
 */

export type TelemetryTags = Record<string, string | number | boolean>;

export interface TelemetryEvent {
  /** Metric name, e.g. ``playback.click_to_first_frame_ms``. */
  name: string;
  /** Histogram / gauge value. Counters omit this. */
  value?: number;
  /** Free-form labels. Spec 08 §3.1 lists the conventional keys. */
  tags?: TelemetryTags;
  /** Epoch ms when the event was recorded. */
  ts: number;
}

export interface PlaybackTelemetryOptions {
  /** Default 5000ms — spec 08 §5.1. */
  flushIntervalMs?: number;
  /** Default ``/api/telemetry/playback``. */
  endpoint?: string;
  /** Required: shared with the editor session for correlation. */
  sessionId: string;
  /** Active editor task id. */
  taskId: string;
  /** Variant the user is rendering on. */
  flagVariant: 'v2' | 'legacy';
  /** Optional logged-in user id (already hashed if the caller cares about PII). */
  userId?: string;
  /** Optional fetch impl, for testing. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_FLUSH_MS = 5000;
const DEFAULT_ENDPOINT = '/api/telemetry/playback';

/**
 * Event-name constants for Phase 2.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §5.4
 *       docs/plans/video-editor-playback-optimization/specs/08-telemetry-feature-flag-rollout.md §3.1
 *
 * Group A — already defined in spec 08 §3.1, reused here as-is.
 * Group B — Phase 2 extensions that the dashboard renders as raw events
 *           until spec 08 v3 lands them officially.
 */
export const PLAYBACK_EVENTS = {
  // Group A (spec 08 §3.1)
  CLICK_TO_FIRST_FRAME_MS: 'playback.click_to_first_frame_ms',
  SEEK_TO_FIRST_FRAME_MS: 'playback.seek_to_first_frame_ms',
  STALLED_EVENT: 'playback.stalled_event',
  CANVAS_DROPPED_FRAME_RATE: 'playback.canvas_dropped_frame_rate',
  PLAYHEAD_REGRESSION: 'playback.playhead_regression',
  RATE_CHANGE: 'playback.rate_change',
  ERROR: 'playback.error',
  // Group B (Phase 2 extension; pending spec 08 v3)
  PHASE_CHANGED: 'playback.phase.changed',
  TICK_FPS: 'playback.tick.fps',
  PREPARING_TIMEOUT: 'playback.preparing.timeout',
  DRAW_DROPPED: 'playback.draw.dropped',
  SEEK: 'playback.seek',
} as const;

export type PlaybackEventName = (typeof PLAYBACK_EVENTS)[keyof typeof PLAYBACK_EVENTS];

export class PlaybackTelemetry {
  private readonly _opts: Required<Omit<PlaybackTelemetryOptions, 'userId' | 'fetchImpl'>> & {
    userId?: string;
    fetchImpl?: typeof fetch;
  };
  private _queue: TelemetryEvent[] = [];
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _beforeUnloadHandler: (() => void) | null = null;
  private _disposed = false;

  constructor(opts: PlaybackTelemetryOptions) {
    this._opts = {
      flushIntervalMs: opts.flushIntervalMs ?? DEFAULT_FLUSH_MS,
      endpoint: opts.endpoint ?? DEFAULT_ENDPOINT,
      sessionId: opts.sessionId,
      taskId: opts.taskId,
      flagVariant: opts.flagVariant,
      userId: opts.userId,
      fetchImpl: opts.fetchImpl,
    };
    this._installTimer();
    this._installBeforeUnload();
  }

  /** Emit a metric with a numeric value (histogram / gauge). */
  record(name: string, value: number | undefined, tags?: TelemetryTags): void {
    if (this._disposed) return;
    this._queue.push({ name, value, tags, ts: Date.now() });
  }

  /** Emit a +1 counter event. */
  count(name: string, tags?: TelemetryTags): void {
    if (this._disposed) return;
    this._queue.push({ name, value: 1, tags, ts: Date.now() });
  }

  /** Immediately flush the queue. Returns once the post completes (or fails). */
  async flushNow(): Promise<void> {
    if (this._queue.length === 0) return;
    const events = this._queue;
    this._queue = [];
    const payload = {
      sessionId: this._opts.sessionId,
      taskId: this._opts.taskId,
      flagVariant: this._opts.flagVariant,
      userId: this._opts.userId,
      events,
    };

    const fetchImpl = this._opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) {
      // SSR / Node without polyfill — drop events; matches spec 08's "never
      // throw" rule.
      return;
    }
    try {
      await fetchImpl(this._opts.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {
      // Swallow — telemetry must never break playback.
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (typeof window !== 'undefined' && this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    // One final attempt — fire-and-forget.
    void this.flushNow();
  }

  /** Read the in-flight queue (test helper). */
  _peekQueue(): TelemetryEvent[] {
    return [...this._queue];
  }

  private _installTimer(): void {
    if (this._opts.flushIntervalMs <= 0) return;
    if (typeof setInterval === 'undefined') return;
    this._timer = setInterval(() => {
      void this.flushNow();
    }, this._opts.flushIntervalMs);
  }

  private _installBeforeUnload(): void {
    if (typeof window === 'undefined') return;
    this._beforeUnloadHandler = () => {
      void this.flushNow();
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);
  }
}
