/**
 * AgentStateManager — Centralized state management for a single Agent
 * execution session. Maintains an AgentExecutionState instance, provides
 * typed mutation methods, and batch-notifies subscribers via
 * requestAnimationFrame to avoid excessive React re-renders during
 * high-frequency SSE text_delta events.
 *
 * Also provides `toMessageUpdate()` to convert the current execution state
 * into a partial ChatMessage object for persistence into the conversation
 * history.
 *
 * @module AgentStateManager
 */

import type { ChatMessage, AgentToolCallRecord, AgentTimelineOperation } from '@/types';
import type { AgentOperation } from './types';
import type { SteerNote } from '@/types/agentSteering';
import { compactToolResult } from './compactToolResult';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Internal tool call record with richer data than the ToolCallRecord
 * from useAgentExecutionState. Includes params, result, and is
 * convertible to the persisted AgentToolCallRecord type.
 */
export interface InternalToolCallRecord {
  id: string;
  name: string;
  params: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error' | 'cancelled';
  result?: unknown;
  /** The client applied this step's operation to the timeline. */
  changedTimeline?: boolean;
}

export interface AgentStateManagerSnapshot {
  /** Accumulated text content from text_delta events. */
  accumulatedContent: string;
  /** All tool calls tracked during this execution. */
  toolCalls: InternalToolCallRecord[];
  /**
   * All operations applied during this execution. Includes timeline ops
   * (for backward compat) and new material/script/storyboard/async ops.
   */
  pendingOperations: AgentOperation[];
  /** Whether the execution has finalized (stream ended). */
  isFinalized: boolean;
  /** Error message, if any. */
  errorMessage: string | null;
  /** Accumulated thinking content from thinking_delta events. */
  thinkingContent: string;
  /** Whether the agent is currently in the thinking phase. */
  isThinking: boolean;
}

export type StateChangeListener = (snapshot: AgentStateManagerSnapshot) => void;

// ---------------------------------------------------------------------------
// AgentStateManager
// ---------------------------------------------------------------------------

export class AgentStateManager {
  // -- State fields --
  private accumulatedContent = '';
  private toolCalls: InternalToolCallRecord[] = [];
  private pendingOperations: AgentOperation[] = [];
  private steers: SteerNote[] = [];
  private isFinalized = false;
  private errorMessage: string | null = null;
  private thinkingContent = '';
  private isThinking = false;
  private isCancelled = false;
  /** Set by the first markCancelled, whoever asked for the stop. */
  private isSealed = false;

  // -- Subscription --
  private listeners = new Set<StateChangeListener>();
  private flushScheduled = false;

  // -- Message context --
  private readonly messageId: string;

  constructor(messageId: string) {
    this.messageId = messageId;
  }

  // -----------------------------------------------------------------------
  // State Mutation Methods
  // -----------------------------------------------------------------------

  /** Append text content from a text_delta event. */
  appendText(content: string): void {
    this.accumulatedContent += content;
    this.scheduleFlush();
  }

  /** Append thinking content from a thinking_delta event. */
  appendThinkingContent(content: string): void {
    this.thinkingContent += content;
    this.scheduleFlush();
  }

  /** Set the thinking phase state. */
  setThinkingPhase(phase: 'thinking' | 'executing'): void {
    this.isThinking = phase === 'thinking';
    this.scheduleFlush();
  }

  /** Register a new tool call (status: executing). */
  addToolCall(record: InternalToolCallRecord): void {
    this.toolCalls.push({ ...record });
    this.scheduleFlush();
  }

  /**
   * Update a tool call's status and result. The result is stored without
   * inline media: it is persisted with the conversation and replayed to the
   * model on every later turn.
   *
   * One narrow exception: the vision card's `details.ui.thumbs` are kept
   * (bounded, see `STORED_THUMBNAIL_CHARS`) so the user can still see what
   * the agent looked at. Replay (`messageConverter`) and history compaction
   * re-run the same function without that option, so the model never
   * receives base64.
   */
  updateToolStatus(
    toolCallId: string,
    status: 'completed' | 'error' | 'cancelled',
    result: unknown,
  ): void {
    const idx = this.toolCalls.findIndex(tc => tc.id === toolCallId);
    if (idx !== -1) {
      this.toolCalls[idx] = {
        ...this.toolCalls[idx],
        status,
        result: compactToolResult(result, 0, { keepThumbnails: true }),
      };
    } else {
      // Tool result arrived before tool_call event (unlikely but defensive)
      console.warn(
        `[AgentStateManager] updateToolStatus called for unknown tool call: ${toolCallId}`,
      );
    }
    this.scheduleFlush();
  }

  /**
   * Flag a tool call whose operation the client applied to the timeline, so
   * single-step undo lists it (noop / skipped / rejected steps stay unflagged).
   */
  markTimelineChanged(toolCallId: string): void {
    const idx = this.toolCalls.findIndex(tc => tc.id === toolCallId);
    if (idx === -1) {
      console.warn('[AgentStateManager] markTimelineChanged for unknown tool call', { toolCallId });
      return;
    }
    this.toolCalls[idx] = { ...this.toolCalls[idx], changedTimeline: true };
    this.scheduleFlush();
  }

  /**
   * Replace the notes the user added while this turn ran. Only delivered
   * (`applied`) ones belong here: they are persisted with the message and
   * replayed to the model on later turns.
   */
  setSteers(notes: readonly SteerNote[]): void {
    this.steers = notes.filter(note => note.status === 'applied');
    this.scheduleFlush();
  }

  /** Record an agent operation (timeline, material, script, storyboard, or async task). */
  addOperation(operation: AgentOperation): void {
    this.pendingOperations.push(operation);
    this.scheduleFlush();
  }

  /** Set an error and append it to accumulated content. */
  setError(message: string): void {
    this.errorMessage = message;
    this.isThinking = false;
    this.accumulatedContent += `\n\nError: ${message}`;
    this.scheduleFlush();
  }

  /** Mark the execution as finalized (stream ended normally). */
  finalize(): void {
    this.isFinalized = true;
    this.isThinking = false;
    // Flush immediately on finalize — don't defer since the stream is done
    this.flushNow();
  }

  /**
   * Seal the in-flight execution as cancelled. Any tool call still in
   * `executing` is demoted to `cancelled`. Only a stop by the user flags the
   * assistant message `isCancelled`, which makes the next-turn
   * `messageConverter` inject the "previous turn was stopped" system note.
   *
   * Idempotent — calling twice is a no-op after the first call.
   *
   * @param appendMarker — when true, append `\n\n_[Stopped by user]_` to
   *   accumulated content (only if non-empty). Set to false for the
   *   conversation-switch / unmount path which should not pollute the
   *   resume system note (spec §2.6.2).
   * @param byUser — false for a stop the user did not ask for (server
   *   timeout): the turn is sealed but not recorded as stopped by the user.
   */
  markCancelled(options: { appendMarker?: boolean; byUser?: boolean } = {}): void {
    if (this.isSealed) return;
    this.isSealed = true;
    const { appendMarker = true, byUser = true } = options;
    this.isCancelled = byUser;
    for (let i = 0; i < this.toolCalls.length; i++) {
      if (this.toolCalls[i].status === 'executing') {
        this.toolCalls[i] = { ...this.toolCalls[i], status: 'cancelled' };
      }
    }
    if (appendMarker && this.accumulatedContent.trim().length > 0) {
      this.accumulatedContent += '\n\n_[Stopped by user]_';
    }
    this.isFinalized = true;
    this.isThinking = false;
    this.flushNow();
  }

  /** Whether the execution has been sealed as user-cancelled. */
  getIsCancelled(): boolean {
    return this.isCancelled;
  }

  /**
   * Discard everything shown for an abandoned stream attempt. A reconnect
   * re-runs the whole turn on the server (text, thinking and tool calls are
   * streamed again), so keeping the first attempt would duplicate the text
   * and leave its tool cards "executing" forever. The message id and the
   * subscribers are kept; subscribers are notified immediately.
   */
  resetForRestart(): void {
    this.accumulatedContent = '';
    this.thinkingContent = '';
    this.toolCalls = [];
    this.pendingOperations = [];
    this.steers = [];
    this.errorMessage = null;
    this.isThinking = false;
    this.flushNow();
  }

  // -----------------------------------------------------------------------
  // State Query Methods
  // -----------------------------------------------------------------------

  /** Get a snapshot of the current state. */
  getSnapshot(): AgentStateManagerSnapshot {
    return {
      accumulatedContent: this.accumulatedContent,
      toolCalls: this.toolCalls.map(tc => ({ ...tc })),
      pendingOperations: [...this.pendingOperations],
      isFinalized: this.isFinalized,
      errorMessage: this.errorMessage,
      thinkingContent: this.thinkingContent,
      isThinking: this.isThinking,
    };
  }

  /** Get the message ID associated with this execution. */
  getMessageId(): string {
    return this.messageId;
  }

  /** Get accumulated text content. */
  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }

  /** Get current tool calls. */
  getToolCalls(): readonly InternalToolCallRecord[] {
    return this.toolCalls;
  }

  /** Get pending operations. */
  getPendingOperations(): readonly AgentOperation[] {
    return this.pendingOperations;
  }

  // -----------------------------------------------------------------------
  // Subscription (batch-notified via requestAnimationFrame)
  // -----------------------------------------------------------------------

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Schedule a flush that will notify all subscribers on the next animation
   * frame. Multiple rapid mutations (e.g., a burst of text_delta events)
   * are coalesced into a single notification.
   */
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        this.flushNow();
      });
    } else {
      // SSR or test environment — flush synchronously
      // Use queueMicrotask for minimal batching
      queueMicrotask(() => {
        this.flushNow();
      });
    }
  }

  /** Immediately notify all subscribers with the current state snapshot. */
  private flushNow(): void {
    this.flushScheduled = false;
    const snapshot = this.getSnapshot();
    this.listeners.forEach(listener => {
      try {
        listener(snapshot);
      } catch (e) {
        console.error('[AgentStateManager] Listener error:', e);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Conversion: State -> ChatMessage update
  // -----------------------------------------------------------------------

  /**
   * Convert the current execution state into a partial ChatMessage
   * suitable for merging into the conversation's message array.
   *
   * This produces the agent reply message with:
   *   - Accumulated text content
   *   - Tool call records (in the persisted format)
   *   - Pending operations list
   *   - isStreaming flag (false only when finalized or errored)
   *
   * It carries no timeline data: the caller attaches the turn's
   * `timelineTrackPatches` when the turn ends.
   */
  toMessageUpdate(): ChatMessage {
    const isStreaming = !this.isFinalized && this.errorMessage === null;

    const agentToolCalls: AgentToolCallRecord[] = this.toolCalls.map(tc => ({
      id: tc.id,
      name: tc.name,
      params: tc.params,
      status: tc.status,
      result: tc.result,
      ...(tc.changedTimeline ? { changedTimeline: true } : {}),
    }));

    return {
      id: this.messageId,
      role: 'assistant',
      content: this.accumulatedContent,
      timestamp: new Date(),
      isStreaming,
      isAgentMessage: true,
      agentToolCalls,
      pendingOperations: [...this.pendingOperations],
      thinkingContent: this.thinkingContent || undefined,
      isThinking: this.isThinking,
      isCancelled: this.isCancelled || undefined,
      ...(this.steers.length ? { steers: [...this.steers] } : {}),
    };
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /** Remove all listeners and reset internal state. */
  destroy(): void {
    this.listeners.clear();
    this.flushScheduled = false;
  }
}
