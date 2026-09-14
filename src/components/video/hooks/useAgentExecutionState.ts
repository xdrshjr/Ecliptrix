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
 * - **Finishing before terminal**: when the stream ends (complete, error or
 *   cancel) the status is `finishing` until the consumer's terminal callback
 *   settles — the consumer still applies queued operations then, so the edit
 *   lock and the send button must not be released yet. A watchdog bounds the
 *   wait so a stuck step can never lock the timeline forever.
 *
 * @module useAgentExecutionState
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SSEStreamManager } from '@/lib/video-editing-agent/SSEStreamManager';
import type { StreamError } from '@/lib/video-editing-agent/errorRecovery';
import type { SSEEvent } from '@/lib/video-editing-agent/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentExecutionStatus =
  | 'idle'
  | 'executing'
  | 'retrying'
  /** The stream ended; queued operations are still being applied. */
  | 'finishing'
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
  /** Whether the agent is in the thinking phase. */
  isThinking: boolean;
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
  isThinking: false,
};

/**
 * Longest the `finishing` phase may wait for the consumer's terminal
 * callback. Past it the execution ends anyway (and the consumer is told),
 * because an event chain that never settles would otherwise keep the
 * timeline locked until reload.
 */
export const FINISHING_WATCHDOG_MS = 15_000;

type SettleResult = 'settled' | 'timed-out';

interface BoundedWait {
  /** 'settled' once `work` settles (fulfilled or rejected), 'timed-out' after `ms`. */
  result: Promise<SettleResult>;
  /** Clears the watchdog timer; `result` then resolves only if `work` settles. */
  cancel: () => void;
}

/** Wait for `work`, but no longer than `ms`. */
function settleWithin(work: Promise<unknown>, ms: number): BoundedWait {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SettleResult>(resolve => {
    timer = setTimeout(() => resolve('timed-out'), ms);
  });
  const settled = work.then(
    (): SettleResult => 'settled',
    (error: unknown): SettleResult => {
      console.error('[useAgentExecutionState] terminal callback failed', { error });
      return 'settled';
    },
  );
  const cancel = (): void => clearTimeout(timer);
  const result = Promise.race([settled, timeout]).then(outcome => {
    cancel();
    return outcome;
  });
  return { result, cancel };
}

// ---------------------------------------------------------------------------
// Params for startExecution
// ---------------------------------------------------------------------------

/** A terminal callback; a returned promise keeps the status at `finishing` until it settles. */
type TerminalCallback = () => void | Promise<void>;

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
  /** Called when the stream completes normally; the status stays `finishing` until it settles. */
  onComplete?: TerminalCallback;
  /** Called when the stream fails terminally; the status stays `finishing` until it settles. */
  onError?: (error: StreamError) => void | Promise<void>;
  /** Called after the user cancelled; the status stays `finishing` until it settles. */
  onCancel?: TerminalCallback;
  /** Called when a terminal callback did not settle within FINISHING_WATCHDOG_MS. */
  onFinishingTimeout?: () => void;
  /**
   * Called when the stream manager reconnects. A reconnect re-runs the whole
   * turn on the server, so the consumer must drop the text, thinking content
   * and tool cards it showed for the abandoned attempt.
   */
  onRestart?: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentExecutionState() {
  const [state, setState] = useState<AgentExecutionState>(INITIAL_STATE);
  const managerRef = useRef<SSEStreamManager | null>(null);
  // Ref to track accumulated text so we don't depend on stale closures
  const accumulatedTextRef = useRef('');
  // Params of the running execution: cancel needs its terminal callbacks.
  const paramsRef = useRef<StartExecutionParams | null>(null);
  // Bumped per execution so a late finish never overwrites a newer one.
  const executionIdRef = useRef(0);
  // False once unmounted: a finish then runs no watchdog, status write or
  // timeout notice (the consumer's unmount cleanup may still cancel).
  const isMountedRef = useRef(false);
  // Clears the watchdog timer of each pending `finishing` wait.
  const pendingWatchdogsRef = useRef(new Set<() => void>());

  useEffect(() => {
    isMountedRef.current = true;
    const pendingWatchdogs = pendingWatchdogsRef.current;
    return () => {
      isMountedRef.current = false;
      pendingWatchdogs.forEach(cancelWatchdog => cancelWatchdog());
      pendingWatchdogs.clear();
    };
  }, []);

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

  /**
   * `finishing` → wait for the terminal callback (bounded by the watchdog)
   * → the terminal status. A timed-out wait still ends the execution; later
   * agent writes remain allowed and undoable, so nothing is lost.
   */
  const finishExecution = useCallback(
    async (
      terminalCallback: TerminalCallback | undefined,
      terminal: Partial<AgentExecutionState>,
      onFinishingTimeout: (() => void) | undefined,
    ): Promise<void> => {
      const work = Promise.resolve().then(() => terminalCallback?.());
      if (!isMountedRef.current) {
        await work.catch((error: unknown) => {
          console.error('[useAgentExecutionState] terminal callback failed', { error });
        });
        return;
      }
      const executionId = executionIdRef.current;
      updateState({ status: 'finishing' });
      const wait = settleWithin(work, FINISHING_WATCHDOG_MS);
      pendingWatchdogsRef.current.add(wait.cancel);
      const drained = await wait.result;
      pendingWatchdogsRef.current.delete(wait.cancel);
      if (!isMountedRef.current || executionIdRef.current !== executionId) return;
      if (drained === 'timed-out') {
        console.error('[useAgentExecutionState] event chain did not drain before the watchdog', {
          status: terminal.status,
          watchdogMs: FINISHING_WATCHDOG_MS,
        });
        onFinishingTimeout?.();
      }
      updateState(terminal);
    },
    [updateState],
  );

  // ---- handleEvent: update execution state from SSE events ----

  const handleEvent = useCallback(
    (event: SSEEvent, externalOnEvent?: (event: SSEEvent) => void) => {
      switch (event.type) {
        case 'thinking_start':
          updateState({ isThinking: true });
          break;

        case 'thinking_end':
          updateState({ isThinking: false });
          break;

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

        case 'cancelled':
          // Server-side abort propagated — move the in-flight tool into
          // completedTools (as an error-styled entry, since this UI-level
          // `ToolCallRecord` union does not carry a distinct 'cancelled'
          // value) so the busy-bar / live indicator stop showing a phantom
          // in-flight tool after the stream ends.
          setState(prev => {
            if (!prev.currentTool) return prev;
            const sealed: ToolCallRecord = {
              ...prev.currentTool,
              status: 'error',
            };
            return {
              ...prev,
              completedTools: [...prev.completedTools, sealed],
              currentTool: null,
            };
          });
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
      paramsRef.current = params;
      executionIdRef.current += 1;

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
          void finishExecution(params.onComplete, { status: 'completed' }, params.onFinishingTimeout);
        },

        onError: (error) => {
          void finishExecution(
            () => params.onError?.(error),
            { status: 'error', error },
            params.onFinishingTimeout,
          );
        },

        onRetry: (attempt, reason) => {
          updateState({ status: 'retrying', retryCount: attempt });
          console.log(`[useAgentExecutionState] Retrying (${attempt}): ${reason}`);
          // Allow retry to proceed
          return true;
        },

        onRestart: () => {
          // The reconnect re-runs the turn: drop the abandoned attempt's text.
          accumulatedTextRef.current = '';
          updateState({ pendingMessage: '' });
          params.onRestart?.();
        },
      });

      managerRef.current = manager;

      // Fire and forget — the manager's callbacks drive state updates.
      // We catch here only to prevent unhandled rejection warnings.
      manager.start().catch((err) => {
        console.error('[useAgentExecutionState] Unexpected manager error:', err);
      });
    },
    [handleEvent, updateState, finishExecution],
  );

  // ---- cancelExecution ----

  const cancelExecution = useCallback(() => {
    if (!managerRef.current?.isRunning) {
      return;
    }
    managerRef.current.cancel();
    managerRef.current = null;
    accumulatedTextRef.current = '';
    const params = paramsRef.current;
    void finishExecution(
      params?.onCancel,
      { status: 'cancelled', error: null },
      params?.onFinishingTimeout,
    );
  }, [finishExecution]);

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
    executionIdRef.current += 1;
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
