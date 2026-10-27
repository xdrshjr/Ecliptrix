/**
 * SSEStreamManager — standalone SSE stream connection manager with heartbeat
 * detection, idle and maximum-duration timeouts, auto-retry with exponential
 * backoff, and proper SSE spec parsing.
 *
 * Designed as a framework-agnostic class so it can be instantiated by any
 * consumer (React hook, test harness, etc.). Phase 2's `useAgentExecution`
 * hook (google-dev-04) will own one instance per request.
 *
 * ## Reconnect semantics
 *
 * The agent route cannot resume a turn: every connection runs the agent from
 * the start and numbers its events from 0 again. A reconnect is therefore a
 * clean restart of the turn (`onRestart` tells the consumer to drop what it
 * already showed), and it is only attempted while no tool call has been seen
 * — after that, a rerun could execute tools (some of them billed) twice.
 *
 * ## Usage
 *
 * ```ts
 * const manager = new SSEStreamManager({
 *   url: '/api/video-editing-agent/chat',
 *   body: { messages, timelineState, materials },
 *   onEvent: (event) => { ... },
 *   onError: (error) => { ... },
 *   onComplete: () => { ... },
 * });
 *
 * await manager.start();  // resolves when stream ends (or max retries exhausted)
 * manager.cancel();       // abort from outside at any time
 * ```
 *
 * @module SSEStreamManager
 */

import type { SSEEvent } from './types';
import { AGENT_IDLE_TIMEOUT_MS, AGENT_MAX_DURATION_MS, CLIENT_IDLE_GRACE_MS } from './timeouts';
import {
  type StreamError,
  type StreamErrorContext,
  StreamErrorType,
  classifyError,
  getRetryDelay,
  shouldRetry,
  toNonRetryableAfterSideEffects,
} from './errorRecovery';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SSEStreamManagerConfig {
  /** The URL to POST to. */
  url: string;
  /** JSON-serialisable request body. */
  body: unknown;
  /** Additional request headers (Content-Type is set automatically). */
  headers?: Record<string, string>;
  /**
   * End the run after this many ms without agent activity (tool calls, tool
   * results, text or thinking deltas; keepalive comments do not count).
   * Default: the server's idle timeout plus a grace period, so the server's
   * own timeout error arrives first.
   */
  idleTimeoutMs?: number;
  /** @deprecated Alias of `idleTimeoutMs`, kept for existing callers. */
  timeout?: number;
  /** Hard cap on the whole run in ms, however active (default 2 h). */
  maxDurationMs?: number;
  /** Heartbeat timeout — max ms between data chunks (default 90 000). */
  heartbeatTimeout?: number;
  /** Maximum automatic retries (default 2). */
  maxRetries?: number;

  // -- Callbacks --

  /** Called for every parsed SSE event. */
  onEvent: (event: SSEEvent) => void;
  /** Called when a non-recoverable error occurs or retries are exhausted. */
  onError: (error: StreamError) => void;
  /** Called when the stream completes normally ([DONE] or agent_end). */
  onComplete: () => void;
  /** Called before each automatic retry. Return `false` to abort retry. */
  onRetry?: (attempt: number, reason: string) => boolean | void;
  /**
   * Called right before a reconnect. A reconnect restarts the turn from
   * scratch on the server, so the caller must discard the text, thinking
   * content and tool cards accumulated for this turn so far.
   */
  onRestart?: (attempt: number) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Type-safe wrapper for timer IDs that works in both Node and browser. */
type TimerId = ReturnType<typeof setTimeout>;

/** `StreamError.message` when the run saw no agent activity for too long. */
export const IDLE_TIMEOUT_ERROR_MESSAGE = 'Agent run stopped: no activity within the idle timeout';

/** `StreamError.message` when the run reached its maximum duration. */
export const MAX_DURATION_ERROR_MESSAGE = 'Agent run stopped: maximum run duration exceeded';

/** Events that show the agent is making progress; comments never count. */
const ACTIVITY_EVENT_TYPES: ReadonlySet<SSEEvent['type']> = new Set<SSEEvent['type']>([
  'tool_call',
  'tool_result',
  'text_delta',
  'thinking_delta',
]);

/**
 * Throttled readings (`context_usage`, batch and crew progress). They never
 * count as the run's "last event" — that is the error context of a failure —
 * and are not logged one by one: a crew emits a few per second.
 */
const TRANSIENT_PROGRESS_TYPES: ReadonlySet<SSEEvent['type']> = new Set<SSEEvent['type']>([
  'context_usage',
  'tool_progress',
  'crew_member',
]);

/** Value of an SSE field line: text after the `name:` prefix, minus one leading space. */
function fieldValue(line: string, prefixLength: number): string {
  const value = line.slice(prefixLength);
  return value.startsWith(' ') ? value.slice(1) : value;
}

/** Delay helper that respects AbortSignal. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// ---------------------------------------------------------------------------
// SSEStreamManager
// ---------------------------------------------------------------------------

export class SSEStreamManager {
  // -- Config (immutable after construction) --
  private readonly config: Required<
    Pick<SSEStreamManagerConfig, 'url' | 'body' | 'idleTimeoutMs' | 'maxDurationMs' | 'heartbeatTimeout' | 'maxRetries'>
  > & SSEStreamManagerConfig;

  // -- Runtime state --
  private controller: AbortController | null = null;
  private heartbeatTimer: TimerId | null = null;
  private idleTimer: TimerId | null = null;
  private maxDurationTimer: TimerId | null = null;
  private retryCount = 0;
  private buffer = '';
  /** `data:` lines of the event still being received (see parseSSEBuffer). */
  private pendingDataLines: string[] = [];
  /** `id:` of the event still being received. */
  private pendingId: number | null = null;
  private lastReceivedEventId = -1;
  private completedToolCallIds: string[] = [];
  private pendingToolCallIds: string[] = [];
  private lastEvent: SSEEvent | null = null;
  /** Set once any tool_call / tool_result arrived; never reset by a restart. */
  private hasObservedToolCall = false;
  private _isRunning = false;
  private _isCancelled = false;

  constructor(config: SSEStreamManagerConfig) {
    this.config = {
      ...config,
      idleTimeoutMs: config.idleTimeoutMs ?? config.timeout ?? AGENT_IDLE_TIMEOUT_MS + CLIENT_IDLE_GRACE_MS,
      maxDurationMs: config.maxDurationMs ?? AGENT_MAX_DURATION_MS,
      heartbeatTimeout: config.heartbeatTimeout ?? 90_000,
      maxRetries: config.maxRetries ?? 2,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Whether the manager is currently connected / reading. */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Whether `cancel()` has been called. */
  get isCancelled(): boolean {
    return this._isCancelled;
  }

  /** Current retry attempt count. */
  get currentRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Initiate the SSE connection. Resolves when the stream completes normally,
   * the user cancels, or all retries are exhausted.
   *
   * Safe to call only once per instance. For a fresh request, create a new
   * `SSEStreamManager`.
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      console.warn('[SSEStreamManager] start() called while already running — ignoring.');
      return;
    }
    this._isRunning = true;
    this._isCancelled = false;
    this.retryCount = 0;

    try {
      await this.connectAndRead();
    } finally {
      this._isRunning = false;
      this.cleanup();
    }
  }

  /**
   * Abort the current connection and prevent retries.
   * Safe to call at any time, including before `start()`.
   */
  cancel(): void {
    this._isCancelled = true;
    this.controller?.abort();
    this.cleanup();
  }

  // ---------------------------------------------------------------------------
  // Connection loop (handles retries)
  // ---------------------------------------------------------------------------

  private async connectAndRead(): Promise<void> {
    // Run timeouts cover the entire lifecycle including retries.
    this.startIdleTimeout();
    this.startMaxDuration();

    while (true) {
      // Reset per-attempt state
      this.buffer = '';
      this.pendingDataLines = [];
      this.pendingId = null;
      this.controller = new AbortController();

      try {
        await this.doFetchAndRead();
        // If doFetchAndRead resolved without throwing, the stream ended normally.
        this.config.onComplete();
        return;
      } catch (rawError: unknown) {
        // If cancelled by user, don't classify / retry.
        if (this._isCancelled) {
          console.log('[SSEStreamManager] cancelled, exiting');
          return;
        }

        console.error('[SSEStreamManager] connectAndRead caught error:', rawError);

        const httpStatus = (rawError as Error & { httpStatus?: number })?.httpStatus;
        const streamError = classifyError({
          error: rawError,
          httpStatus,
          disconnectReason: this.inferDisconnectReason(rawError),
          context: this.buildErrorContext(),
        });

        // A reconnect re-runs the whole turn on the server. Once a tool call
        // was seen it may already have executed (including billed generation
        // tools), so a rerun would execute it twice: stop instead.
        if (this.hasObservedToolCall && streamError.recoverable) {
          this.config.onError(toNonRetryableAfterSideEffects(streamError));
          return;
        }

        // Attempt retry if appropriate
        if (shouldRetry(streamError, this.retryCount, this.config.maxRetries)) {
          if (await this.retryAfterBackoff(streamError)) continue;
          return;
        }

        // Not recoverable or retries exhausted
        this.config.onError(streamError);
        return;
      }
    }
  }

  /**
   * Wait out the backoff before the next attempt. Resolves true when the
   * loop should reconnect, false when it must stop (the caller vetoed the
   * retry, which is reported here, or the user cancelled during the wait).
   */
  private async retryAfterBackoff(streamError: StreamError): Promise<boolean> {
    const shouldProceed = this.config.onRetry?.(
      this.retryCount + 1,
      streamError.userMessage,
    );
    if (shouldProceed === false) {
      // Caller vetoed the retry
      this.config.onError(streamError);
      return false;
    }

    this.retryCount++;
    const delayMs = getRetryDelay(this.retryCount - 1);

    console.log(
      `[SSEStreamManager] Retry ${this.retryCount}/${this.config.maxRetries} ` +
      `in ${delayMs}ms (reason: ${streamError.type})`,
    );

    // Create a fresh controller for the delay so the backoff actually
    // waits — the previous controller's signal is already aborted (that
    // is why we are in the catch block).
    const delayController = new AbortController();
    this.controller = delayController;
    try {
      await delay(delayMs, delayController.signal);
    } catch {
      // Aborted during delay (e.g. user cancel) — exit
      if (this._isCancelled) return false;
    }

    this.resetForRestart();
    return true;
  }

  /**
   * Forget everything received from the abandoned attempt and tell the
   * caller. The rerun numbers its events from 0 and the LLM output differs,
   * so nothing from the first attempt may be used to skip or match events.
   */
  private resetForRestart(): void {
    this.lastReceivedEventId = -1;
    this.completedToolCallIds = [];
    this.pendingToolCallIds = [];
    this.lastEvent = null;
    this.buffer = '';
    this.pendingDataLines = [];
    this.pendingId = null;
    this.config.onRestart?.(this.retryCount);
  }

  // ---------------------------------------------------------------------------
  // Single fetch + read cycle
  // ---------------------------------------------------------------------------

  private async doFetchAndRead(): Promise<void> {
    const { url, body, headers } = this.config;
    console.log('[SSEStreamManager] doFetchAndRead starting:', url);

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: this.controller!.signal,
    });

    console.log('[SSEStreamManager] fetch response:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const err = new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      // Attach status for classifyError
      (err as Error & { httpStatus?: number }).httpStatus = response.status;
      throw err;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable (no ReadableStream)');
    }

    // Start heartbeat monitoring
    this.resetHeartbeat();

    const decoder = new TextDecoder('utf-8');

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[SSEStreamManager] reader done (stream ended normally)');
          // Flush anything remaining in the buffer
          this.flushBuffer();
          return; // normal end
        }

        // Reset heartbeat on every data receipt
        this.resetHeartbeat();

        const chunk = decoder.decode(value, { stream: true });
        console.log('[SSEStreamManager] chunk received, length:', chunk.length, 'preview:', chunk.slice(0, 120));
        const events = this.parseSSEBuffer(chunk);

        for (const event of events) {
          // Every event of this attempt is delivered: a restart re-runs the
          // turn, so ids and tool-call ids of an earlier attempt mean nothing.
          this.trackEvent(event);

          // Check for stream-end signals
          if (!TRANSIENT_PROGRESS_TYPES.has(event.type)) {
            console.log('[SSEStreamManager] event:', event.type, event);
          }
          if (this.isStreamEndEvent(event)) {
            console.log('[SSEStreamManager] stream-end event detected, completing');
            // Deliver the event, then signal normal completion
            this.config.onEvent(event);
            return;
          }

          this.config.onEvent(event);
        }
      }
    } finally {
      // Release the reader lock so the connection can be cleaned up
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }

  // ---------------------------------------------------------------------------
  // SSE Buffer Parsing (SSE spec compliant)
  // ---------------------------------------------------------------------------

  /**
   * Parse incoming chunk data according to the SSE specification.
   *
   * SSE format:
   * ```
   * id: 42
   * data: {"type":"text_delta","content":"hello"}
   *
   * id: 43
   * data: [DONE]
   *
   * ```
   *
   * - Lines starting with `data:` carry payload; several data lines of one
   *   event are joined with `\n`.
   * - Lines starting with `id:` set the event ID (the space is optional).
   * - An empty line marks the end of an event.
   * - Lines starting with `:` are comments (ignored).
   * - A trailing `\r` is stripped (CRLF streams).
   *
   * The fields of an unfinished event live on the instance, not in this call:
   * a network chunk can end between an event's `data:` line and its blank
   * line, and the old per-call state dropped that whole event — a tool
   * result the server had applied never reached the client timeline.
   */
  parseSSEBuffer(chunk: string): SSEEvent[] {
    this.buffer += chunk;

    // Split on newlines — SSE uses \n as line delimiter
    const lines = this.buffer.split('\n');

    // The last element may be an incomplete line; keep it in the buffer
    this.buffer = lines.pop() ?? '';

    const events: SSEEvent[] = [];
    for (const line of lines) {
      const event = this.consumeLine(line);
      if (event !== null) events.push(event);
    }
    return events;
  }

  /** Apply one complete line; returns the event a blank line completes. */
  private consumeLine(rawLine: string): SSEEvent | null {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line === '') return this.dispatchPendingEvent();
    if (line.startsWith(':')) return null;

    if (line.startsWith('id:')) {
      const parsed = parseInt(fieldValue(line, 3), 10);
      if (!isNaN(parsed)) this.pendingId = parsed;
      return null;
    }
    if (line.startsWith('data:')) {
      this.pendingDataLines.push(fieldValue(line, 5));
    }
    return null;
  }

  /** Complete the pending event, if it has data, and reset the pending fields. */
  private dispatchPendingEvent(): SSEEvent | null {
    if (this.pendingDataLines.length === 0) {
      this.pendingId = null;
      return null;
    }
    const event = this.parseEventData(this.pendingDataLines.join('\n'), this.pendingId);
    this.pendingDataLines = [];
    this.pendingId = null;
    return event;
  }

  /**
   * Flush any remaining data in the buffer (called when stream ends).
   * Handles a last event whose trailing newline or blank line never came.
   */
  private flushBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = '';

    const events: SSEEvent[] = [];
    for (const line of lines) {
      const event = this.consumeLine(line);
      if (event !== null) events.push(event);
    }
    const last = this.dispatchPendingEvent();
    if (last !== null) events.push(last);

    for (const event of events) {
      this.trackEvent(event);
      // Always deliver the event (including stream-end); the caller
      // (connectAndRead) will invoke onComplete separately.
      this.config.onEvent(event);
    }
  }

  /**
   * Parse a single SSE `data:` value into an SSEEvent.
   * Returns `null` for unparseable data (logs a warning).
   */
  private parseEventData(data: string, eventId: number | null): (SSEEvent & { _eventId?: number }) | null {
    // [DONE] signal — treated as stream_end
    if (data === '[DONE]') {
      return { type: 'agent_end', _eventId: eventId ?? undefined } as SSEEvent & { _eventId?: number };
    }

    try {
      const parsed = JSON.parse(data) as SSEEvent;
      // Attach the event ID if the server sent one
      if (eventId !== null) {
        (parsed as SSEEvent & { _eventId?: number })._eventId = eventId;
      }
      return parsed;
    } catch (e) {
      console.warn('[SSEStreamManager] Failed to parse SSE data:', data, e);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Event tracking (retry decision and error context)
  // ---------------------------------------------------------------------------

  private trackEvent(event: SSEEvent & { _eventId?: number }): void {
    // Update last received event ID
    if (event._eventId !== undefined && event._eventId > this.lastReceivedEventId) {
      this.lastReceivedEventId = event._eventId;
    }

    if (!TRANSIENT_PROGRESS_TYPES.has(event.type)) this.lastEvent = event;
    // Progress restarts the idle window; keepalive comments never get here.
    if (ACTIVITY_EVENT_TYPES.has(event.type)) this.startIdleTimeout();

    // Track tool call lifecycle for retry context
    if (event.type === 'tool_call') {
      this.hasObservedToolCall = true;
      const id = event.toolCallId;
      if (!this.pendingToolCallIds.includes(id)) {
        this.pendingToolCallIds.push(id);
      }
    } else if (event.type === 'tool_result') {
      this.hasObservedToolCall = true;
      const id = event.toolCallId;
      // Move from pending to completed
      this.pendingToolCallIds = this.pendingToolCallIds.filter(tid => tid !== id);
      if (!this.completedToolCallIds.includes(id)) {
        this.completedToolCallIds.push(id);
      }
    }
  }

  private isStreamEndEvent(event: SSEEvent): boolean {
    // `cancelled` is a terminal event (server-side abort propagated as SSE).
    // Treating it as stream-end here lets the consumer's `onEvent` see it
    // before the manager moves to onComplete; the AgentEventRouter routes
    // it through `markCancelled` rather than the normal finalize path.
    return event.type === 'agent_end' || event.type === 'cancelled';
  }

  // ---------------------------------------------------------------------------
  // Heartbeat detection
  // ---------------------------------------------------------------------------

  private resetHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
    }
    this.heartbeatTimer = setTimeout(() => {
      console.warn('[SSEStreamManager] Heartbeat timeout — no data for', this.config.heartbeatTimeout, 'ms');
      this.handleHeartbeatTimeout();
    }, this.config.heartbeatTimeout);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Run timeouts
  // ---------------------------------------------------------------------------

  /**
   * (Re)start the idle window. Every activity event restarts it, so a run
   * whose tools stay busy for hours is not cut off at a fixed 30 minutes.
   */
  private startIdleTimeout(): void {
    this.clearIdleTimeout();
    this.idleTimer = setTimeout(() => {
      console.warn('[SSEStreamManager] Idle timeout — no agent activity for', this.config.idleTimeoutMs, 'ms');
      this.endRun(IDLE_TIMEOUT_ERROR_MESSAGE);
    }, this.config.idleTimeoutMs);
  }

  private clearIdleTimeout(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private startMaxDuration(): void {
    this.clearMaxDuration();
    this.maxDurationTimer = setTimeout(() => {
      console.warn('[SSEStreamManager] Maximum run duration exceeded:', this.config.maxDurationMs, 'ms');
      this.endRun(MAX_DURATION_ERROR_MESSAGE);
    }, this.config.maxDurationMs);
  }

  private clearMaxDuration(): void {
    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Disconnect handlers
  // ---------------------------------------------------------------------------

  /**
   * An idle or maximum-duration timeout is not recoverable: cancel
   * everything and report a TOTAL_TIMEOUT whose message tells the two apart.
   */
  private endRun(message: string): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    this.controller?.abort();
    this.cleanup();
    this.config.onError(
      classifyError({
        error: new Error(message),
        disconnectReason: 'total_timeout',
        context: this.buildErrorContext(),
      }),
    );
  }

  /**
   * Called when no data arrived within the heartbeat window. Aborts the
   * current fetch so the read loop throws and enters the retry path.
   */
  private handleHeartbeatTimeout(): void {
    if (this._isCancelled) return;
    this.controller?.abort();
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private cleanup(): void {
    this.clearHeartbeat();
    this.clearIdleTimeout();
    this.clearMaxDuration();
  }

  // ---------------------------------------------------------------------------
  // Context builders
  // ---------------------------------------------------------------------------

  private buildErrorContext(): StreamErrorContext {
    return {
      lastEventId: this.lastReceivedEventId >= 0 ? this.lastReceivedEventId : undefined,
      lastEvent: this.lastEvent ?? undefined,
      completedToolCallIds: [...this.completedToolCallIds],
      pendingToolCallIds: [...this.pendingToolCallIds],
      retryCount: this.retryCount,
    };
  }

  private inferDisconnectReason(error: unknown): string | undefined {
    if (error instanceof DOMException && error.name === 'AbortError') {
      // Could be heartbeat or cancel; if we're not cancelled, it was heartbeat
      if (!this._isCancelled) {
        return 'heartbeat_timeout';
      }
      return 'cancelled';
    }
    return undefined;
  }
}
