/**
 * SSEStreamManager — standalone SSE stream connection manager with heartbeat
 * detection, total timeout, auto-retry with exponential backoff, and proper
 * SSE spec parsing.
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
  /** Total timeout in ms (default 1 800 000 = 30 min). */
  timeout?: number;
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
    Pick<SSEStreamManagerConfig, 'url' | 'body' | 'timeout' | 'heartbeatTimeout' | 'maxRetries'>
  > & SSEStreamManagerConfig;

  // -- Runtime state --
  private controller: AbortController | null = null;
  private heartbeatTimer: TimerId | null = null;
  private totalTimer: TimerId | null = null;
  private retryCount = 0;
  private buffer = '';
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
      timeout: config.timeout ?? 1_800_000,
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
    // Start the total timeout — covers the entire lifecycle including retries.
    this.startTotalTimeout();

    while (true) {
      // Reset per-attempt state
      this.buffer = '';
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
          console.log('[SSEStreamManager] event:', event.type, event);
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
   * - Lines starting with `data: ` carry payload.
   * - Lines starting with `id: ` set the last event ID.
   * - An empty line (`\n\n`) marks the end of an event.
   * - Lines starting with `:` are comments (ignored).
   * - Incomplete trailing data is kept in the buffer for the next chunk.
   */
  parseSSEBuffer(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];

    // Split on newlines — SSE uses \n as line delimiter
    const lines = this.buffer.split('\n');

    // The last element may be an incomplete line; keep it in the buffer
    this.buffer = lines.pop() ?? '';

    let currentData = '';
    let currentId: number | null = null;

    for (const line of lines) {
      // Comment line (SSE spec: lines starting with ':')
      if (line.startsWith(':')) {
        continue;
      }

      // id field
      if (line.startsWith('id: ')) {
        const idStr = line.slice(4).trim();
        const parsed = parseInt(idStr, 10);
        if (!isNaN(parsed)) {
          currentId = parsed;
        }
        continue;
      }

      // data field
      if (line.startsWith('data: ')) {
        currentData = line.slice(6);
        continue;
      }

      // Empty line = event boundary
      if (line.trim() === '' && currentData) {
        const event = this.parseEventData(currentData, currentId);
        if (event !== null) {
          events.push(event);
        }
        currentData = '';
        currentId = null;
      }
    }

    return events;
  }

  /**
   * Flush any remaining data in the buffer (called when stream ends).
   * This handles the edge case where the last event lacks a trailing newline.
   */
  private flushBuffer(): void {
    if (!this.buffer.trim()) return;

    // Try to extract a final event from the remaining buffer
    const lines = this.buffer.split('\n');
    let currentData = '';
    let currentId: number | null = null;

    for (const line of lines) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('id: ')) {
        const idStr = line.slice(4).trim();
        const parsed = parseInt(idStr, 10);
        if (!isNaN(parsed)) currentId = parsed;
        continue;
      }
      if (line.startsWith('data: ')) {
        currentData = line.slice(6);
        continue;
      }
    }

    if (currentData) {
      const event = this.parseEventData(currentData, currentId);
      if (event !== null) {
        this.trackEvent(event);
        // Always deliver the event (including stream-end); the caller
        // (connectAndRead) will invoke onComplete separately.
        this.config.onEvent(event);
      }
    }

    this.buffer = '';
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

    this.lastEvent = event;

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
      this.handleDisconnect('heartbeat_timeout');
    }, this.config.heartbeatTimeout);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Total timeout
  // ---------------------------------------------------------------------------

  private startTotalTimeout(): void {
    this.clearTotalTimeout();
    this.totalTimer = setTimeout(() => {
      console.warn('[SSEStreamManager] Total timeout — exceeded', this.config.timeout, 'ms');
      this.handleDisconnect('total_timeout');
    }, this.config.timeout);
  }

  private clearTotalTimeout(): void {
    if (this.totalTimer !== null) {
      clearTimeout(this.totalTimer);
      this.totalTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Disconnect handler
  // ---------------------------------------------------------------------------

  /**
   * Called when a heartbeat or total timeout fires. Aborts the current
   * fetch so the read loop throws and enters the retry path.
   */
  private handleDisconnect(reason: string): void {
    if (this._isCancelled) return;

    if (reason === 'total_timeout') {
      // Total timeout is not recoverable — cancel everything
      this._isCancelled = true;
      this.controller?.abort();
      this.cleanup();
      this.config.onError(
        classifyError({
          error: new Error('Total execution timeout'),
          disconnectReason: 'total_timeout',
          context: this.buildErrorContext(),
        }),
      );
      return;
    }

    // For heartbeat timeout, abort the current connection to trigger retry
    this.controller?.abort();
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private cleanup(): void {
    this.clearHeartbeat();
    this.clearTotalTimeout();
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
