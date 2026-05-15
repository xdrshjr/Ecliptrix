/**
 * Playback v2 — telemetry SDK.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/08-telemetry-feature-flag-rollout.md §六
 *       docs/plans/video-editor-playback-v2-phase4/spec.md §3.2.5 / §4.2 / INV10 / INV11
 *
 * Buffers `record` / `count` events in memory, batch-flushes them to the
 * backend every {@link PlaybackTelemetryOptions.flushIntervalMs} (default
 * 5s), and force-flushes on `beforeunload`. Failures during flush are
 * swallowed — we never throw into the playback hot path (INV10).
 *
 * Phase 4 additions:
 *   - PII hash: ``userId`` is hashed to a 12-hex-char prefix of
 *     ``sha256(userId + 'playback_v2')`` inside the constructor. The
 *     raw value never lives in {@link _opts.userId}.
 *   - Compile-time event-name union ({@link PLAYBACK_EVENT_NAMES}) replaces
 *     the runtime startsWith filter so a typo on a metric name is a
 *     compile error rather than a silent drop. The backend keeps
 *     accepting unknown names — it logs ``unknown_metric=true`` instead
 *     of discarding them, so the dashboard surfaces drift.
 */

import { hashUserIdForTelemetry } from './internal/sha256';

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
  /**
   * Optional logged-in user id. The SDK hashes it before queuing events
   * (Phase 4 §3.2.5 / INV11). Callers must not pre-hash.
   */
  userId?: string;
  /** Optional fetch impl, for testing. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_FLUSH_MS = 5000;
const DEFAULT_ENDPOINT = '/api/telemetry/playback';

/**
 * Compile-time event-name union (Phase 4 §3.2.1 / F4).
 *
 * `PLAYBACK_EVENTS` is the canonical list of metric names. Using a
 * non-listed name at a `record` / `count` call site is now a TypeScript
 * error rather than a silent runtime drop (R-P1-5). The backend
 * `telemetry_router` still accepts unknown names — it logs them with
 * `unknown_metric=true` so dashboards can flag drift without losing
 * data.
 *
 * Group A — spec 08 §3.1.
 * Group B — Phase 2 extensions still surfaced raw.
 * Group C — Phase 4 (preview-proxy / cache / swap latency) extensions.
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
  // Group C (Phase 4)
  SWAP_LATENCY_MS: 'playback.swap_latency_ms',
  PREVIEW_PROXY_REQUEST: 'playback.preview_proxy_request',
  PREVIEW_PROXY_CACHED_HIT_RATE: 'playback.preview_proxy_cached_hit_rate',
  CACHE_MEMORY_MB: 'playback.cache_memory_mb',
  PROXY_URL_USED: 'playback.proxy_url_used',
} as const;

export type PlaybackEventName = (typeof PLAYBACK_EVENTS)[keyof typeof PLAYBACK_EVENTS];

/** Frozen list of the known names for runtime introspection / tests. */
export const PLAYBACK_EVENT_NAMES: ReadonlyArray<PlaybackEventName> = Object.values(
  PLAYBACK_EVENTS,
) as ReadonlyArray<PlaybackEventName>;

export class PlaybackTelemetry {
  private readonly _opts: Required<
    Omit<PlaybackTelemetryOptions, 'userId' | 'fetchImpl'>
  > & {
    userId?: string;
    fetchImpl?: typeof fetch;
  };
  private _queue: TelemetryEvent[] = [];
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _beforeUnloadHandler: (() => void) | null = null;
  private _disposed = false;

  constructor(opts: PlaybackTelemetryOptions) {
    // Hash the userId synchronously so the raw value never lands in
    // _opts. The result is either a 12-hex string or undefined.
    const hashedUserId = opts.userId ? hashUserIdForTelemetry(opts.userId) : null;
    this._opts = {
      flushIntervalMs: opts.flushIntervalMs ?? DEFAULT_FLUSH_MS,
      endpoint: opts.endpoint ?? DEFAULT_ENDPOINT,
      sessionId: opts.sessionId,
      taskId: opts.taskId,
      flagVariant: opts.flagVariant,
      userId: hashedUserId ?? undefined,
      fetchImpl: opts.fetchImpl,
    };
    this._installTimer();
    this._installBeforeUnload();
  }

  /** Emit a metric with a numeric value (histogram / gauge). */
  record(name: PlaybackEventName | string, value: number | undefined, tags?: TelemetryTags): void {
    if (this._disposed) return;
    this._maybeWarnUnknown(name);
    this._queue.push({ name, value, tags, ts: Date.now() });
  }

  /** Emit a +1 counter event. */
  count(name: PlaybackEventName | string, tags?: TelemetryTags): void {
    if (this._disposed) return;
    this._maybeWarnUnknown(name);
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
      // SSR / Node without polyfill — drop events; INV10 says "never throw".
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

  /** Test helper — read the hashed userId actually held by the SDK. */
  _peekHashedUserId(): string | undefined {
    return this._opts.userId;
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

  private _maybeWarnUnknown(name: string): void {
    // In dev / test, surface a one-time console warning for metric names
    // that aren't part of PLAYBACK_EVENTS so authors notice missing
    // updates to the union. The backend still accepts the event.
    if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') return;
    if ((PLAYBACK_EVENT_NAMES as ReadonlyArray<string>).includes(name)) return;
    if (_warnedNames.has(name)) return;
    _warnedNames.add(name);
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        `[playback-telemetry] unknown metric "${name}" — add it to PLAYBACK_EVENTS to avoid the backend "unknown_metric" tag`,
      );
    }
  }
}

const _warnedNames = new Set<string>();
