/**
 * useAgentExecutionState — React hook that manages the lifecycle of a single
 * Agent SSE execution, exposing start / cancel / retry actions and a
 * reactive `AgentExecutionState` object.
 *
 * This hook wraps `SSEStreamManager` and `errorRecovery` utilities, providing
 * a clean React-friendly interface for Phase 2 consumers (google-dev-04's
 * `useAgentExecution` hook).
 *
 * ## Design decisions
 *
 * - **One execution at a time**: calling `startExecution` while already
 *   executing is a no-op (returns early). Cancel first if you need to restart.
 * - **State is immutable snapshots**: every update produces a new object so
 *   React's identity comparison triggers re-renders.
 * - **No UI coupling**: this hook knows nothing about chat messages, timeline
 *   operations, or conversation IDs. It only manages stream lifecycle and
 *   exposes raw SSE events via the `onEvent` callback in params.
 *
 * @module useAgentExecutionState
 */

import { useCallback, useRef, useState } from 'react';
import { SSEStreamManager, type SSEStreamManagerConfig } from '@/lib/video-editing-agent/SSEStreamManager';
import type { StreamError } from '@/lib/video-editing-agent/errorRecovery';
import type { SSEEvent } from '@/lib/video-editing-agent/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentExecutionStatus =
  | 'idle'
  | 'executing'
  | 'retrying'
  | 'error'
  | 'cancelled'
  | 'completed';

export interface ToolCallRecord {
  id: string;
  name: string;
  status: 'executing' | 'completed' | 'error';
}

export interface AgentExecutionState {
  /** Current lifecycle phase. */
  status: AgentExecutionStatus;
  /** Timestamp (ms) when execution started, or null if idle. */
  startTime: number | null;
  /** Wall-clock elapsed time in ms (updated on state transitions, not a live ticker). */
  elapsedTime: number;
  /** How many automatic retries have occurred so far. */
  retryCount: number;
  /** Tool calls that finished (success or error). */
  completedTools: ToolCallRecord[];
  /** The tool call currently in flight, if any. */
  currentTool: ToolCallRecord | null;
  /** Accumulated text content from text_delta events. */
  pendingMessage: string;
  /** The error that ended execution, if status is 'error'. */
  error: StreamError | null;
}

const INITIAL_STATE: AgentExecutionState = {
  status: 'idle',
  startTime: null,
  elapsedTime: 0,
  retryCount: 0,
  completedTools: [],
  currentTool: null,
  pendingMessage: '',
  error: null,
};

// ---------------------------------------------------------------------------
// Params for startExecution
// ---------------------------------------------------------------------------

export interface StartExecutionParams {
  /** The URL to POST to (defaults to '/api/video-editing-agent/chat'). */
  url?: string;
  /** JSON request body (messages, timelineState, materials). */
  body: unknown;
  /**
   * Extra request headers merged into the SSE fetch. The Agent SSE flow does
   * NOT use the central `http-client.ts` wrapper (which auto-injects auth)
   * because it needs streaming responses, so the caller must pass the
   * `Authorization: Bearer <token>` header explicitly. Without it the
   * server-side `readIncomingAuth()` returns undefined, every internal tool
   * fetch goes unauthenticated, and the backend rejects each tool call with
   * 401 — exactly the 2026-04-07 production incident.
   */
  headers?: Record<string, string>;
  /** Total timeout override (ms). */
  timeout?: number;
  /** Heartbeat timeout override (ms). */
  heartbeatTimeout?: number;
  /** Max retries override. */
  maxRetries?: number;
  /**
   * Called for every SSE event. The consumer is responsible for routing
   * events to message state, timeline operations, etc.
   */
  onEvent?: (event: SSEEvent) => void;
  /** Called when the stream completes normally. */
  onComplete?: () => void;
  /** Called when the stream fails terminally. */
  onError?: (error: StreamError) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentExecutionState() {
  const [state, setState] = useState<AgentExecutionState>(INITIAL_STATE);
  const managerRef = useRef<SSEStreamManager | null>(null);
  // Ref to track accumulated text so we don't depend on stale closures
  const accumulatedTextRef = useRef('');

  // ---- helpers ----

  const updateState = useCallback((patch: Partial<AgentExecutionState>) => {
    setState(prev => {
      const next = { ...prev, ...patch };
      // Compute elapsed time whenever we have a start time
      if (next.startTime !== null) {
        next.elapsedTime = Date.now() - next.startTime;
      }
      return next;
    });
  }, []);

  // ---- handleEvent: update execution state from SSE events ----

  const handleEvent = useCallback(
    (event: SSEEvent, externalOnEvent?: (event: SSEEvent) => void) => {
      switch (event.type) {
        case 'tool_call':
          updateState({
            currentTool: {
              id: event.toolCallId,
              name: event.toolName,
              status: 'executing',
            },
          });
          break;

        case 'tool_result': {
          const isError =
            event.result &&
            typeof event.result === 'object' &&
            (event.result as Record<string, unknown>).success === false;

          setState(prev => {
            const completed: ToolCallRecord = {
              id: event.toolCallId,
              name: event.toolName,
              status: isError ? 'error' : 'completed',
            };
            return {
              ...prev,
              completedTools: [...prev.completedTools, completed],
              currentTool:
                prev.currentTool?.id === event.toolCallId ? null : prev.currentTool,
              elapsedTime: prev.startTime ? Date.now() - prev.startTime : prev.elapsedTime,
            };
          });
          break;
        }

        case 'text_delta':
          accumulatedTextRef.current += event.content;
          updateState({ pendingMessage: accumulatedTextRef.current });
          break;

        // agent_start, turn_start, message_start, message_end, turn_end —
        // no execution-state changes needed; forward to consumer.
        default:
          break;
      }

      // Always forward to external handler
      externalOnEvent?.(event);
    },
    [updateState],
  );

  // ---- startExecution ----

  const startExecution = useCallback(
    (params: StartExecutionParams) => {
      // Guard: only one execution at a time
      if (managerRef.current?.isRunning) {
        console.warn('[useAgentExecutionState] Execution already in progress — ignoring start.');
        return;
      }

      // Reset accumulated text
      accumulatedTextRef.current = '';

      // Reset state
      const now = Date.now();
      setState({
        ...INITIAL_STATE,
        status: 'executing',
        startTime: now,
      });

      const manager = new SSEStreamManager({
        url: params.url ?? '/api/video-editing-agent/chat',
        body: params.body,
        headers: params.headers,
        timeout: params.timeout,
        heartbeatTimeout: params.heartbeatTimeout,
        maxRetries: params.maxRetries,

        onEvent: (event) => handleEvent(event, params.onEvent),

        onComplete: () => {
          updateState({ status: 'completed' });
          params.onComplete?.();
        },

        onError: (error) => {
          updateState({ status: 'error', error });
          params.onError?.(error);
        },

        onRetry: (attempt, reason) => {
          updateState({ status: 'retrying', retryCount: attempt });
          console.log(`[useAgentExecutionState] Retrying (${attempt}): ${reason}`);
          // Allow retry to proceed
          return true;
        },
      });

      managerRef.current = manager;

      // Fire and forget — the manager's callbacks drive state updates.
      // We catch here only to prevent unhandled rejection warnings.
      manager.start().catch((err) => {
        console.error('[useAgentExecutionState] Unexpected manager error:', err);
      });
    },
    [handleEvent, updateState],
  );

  // ---- cancelExecution ----

  const cancelExecution = useCallback(() => {
    if (!managerRef.current?.isRunning) {
      return;
    }
    managerRef.current.cancel();
    managerRef.current = null;
    accumulatedTextRef.current = '';
    updateState({ status: 'cancelled', error: null });
  }, [updateState]);

  // ---- retryExecution ----

  /**
   * Manual retry after a terminal error. Requires `params` because the
   * original request body is not stored (it may contain large timeline
   * state that should come fresh from the caller).
   */
  const retryExecution = useCallback(
    (params: StartExecutionParams) => {
      // Clean up previous manager if lingering
      if (managerRef.current) {
        managerRef.current.cancel();
        managerRef.current = null;
      }
      startExecution(params);
    },
    [startExecution],
  );

  // ---- resetState ----

  const resetState = useCallback(() => {
    if (managerRef.current?.isRunning) {
      managerRef.current.cancel();
    }
    managerRef.current = null;
    accumulatedTextRef.current = '';
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    startExecution,
    cancelExecution,
    retryExecution,
    resetState,
  } as const;
}
