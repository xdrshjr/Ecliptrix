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
  status: 'executing' | 'completed' | 'error';
  result?: unknown;
}

export interface AgentStateManagerSnapshot {
  /** Accumulated text content from text_delta events. */
  accumulatedContent: string;
  /** All tool calls tracked during this execution. */
  toolCalls: InternalToolCallRecord[];
  /** All timeline operations applied during this execution. */
  pendingOperations: AgentTimelineOperation[];
  /** Whether the execution has finalized (stream ended). */
  isFinalized: boolean;
  /** Error message, if any. */
  errorMessage: string | null;
}

export type StateChangeListener = (snapshot: AgentStateManagerSnapshot) => void;

// ---------------------------------------------------------------------------
// AgentStateManager
// ---------------------------------------------------------------------------

export class AgentStateManager {
  // -- State fields --
  private accumulatedContent = '';
  private toolCalls: InternalToolCallRecord[] = [];
  private pendingOperations: AgentTimelineOperation[] = [];
  private isFinalized = false;
  private errorMessage: string | null = null;

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

  /** Register a new tool call (status: executing). */
  addToolCall(record: InternalToolCallRecord): void {
    this.toolCalls.push({ ...record });
    this.scheduleFlush();
  }

  /** Update a tool call's status and result. */
  updateToolStatus(
    toolCallId: string,
    status: 'completed' | 'error',
    result: unknown,
  ): void {
    const idx = this.toolCalls.findIndex(tc => tc.id === toolCallId);
    if (idx !== -1) {
      this.toolCalls[idx] = {
        ...this.toolCalls[idx],
        status,
        result,
      };
    } else {
      // Tool result arrived before tool_call event (unlikely but defensive)
      console.warn(
        `[AgentStateManager] updateToolStatus called for unknown tool call: ${toolCallId}`,
      );
    }
    this.scheduleFlush();
  }

  /** Record a timeline operation (tracked separately for undo). */
  addOperation(operation: AgentTimelineOperation): void {
    this.pendingOperations.push(operation);
    this.scheduleFlush();
  }

  /** Set an error and append it to accumulated content. */
  setError(message: string): void {
    this.errorMessage = message;
    this.accumulatedContent += `\n\nError: ${message}`;
    this.scheduleFlush();
  }

  /** Mark the execution as finalized (stream ended normally). */
  finalize(): void {
    this.isFinalized = true;
    // Flush immediately on finalize — don't defer since the stream is done
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
  getPendingOperations(): readonly AgentTimelineOperation[] {
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
   */
  toMessageUpdate(
    timelineSnapshot?: import('@/types').TimelineState,
  ): ChatMessage {
    const isStreaming = !this.isFinalized && this.errorMessage === null;

    const agentToolCalls: AgentToolCallRecord[] = this.toolCalls.map(tc => ({
      id: tc.id,
      name: tc.name,
      params: tc.params,
      status: tc.status,
      result: tc.result,
    }));

    return {
      id: this.messageId,
      role: 'assistant',
      content: this.accumulatedContent,
      timestamp: new Date(),
      isStreaming,
      isAgentMessage: true,
      agentToolCalls,
      timelineSnapshot,
      pendingOperations: [...this.pendingOperations],
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
