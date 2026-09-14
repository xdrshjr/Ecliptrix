/**
 * Error classification and recovery strategy for SSE stream connections.
 *
 * Provides a typed error taxonomy, user-friendly messages (zh-CN + en fallback),
 * and a `classifyError` function that maps raw exceptions / HTTP status codes
 * into actionable `StreamError` objects consumed by `SSEStreamManager` and
 * `useAgentExecutionState`.
 *
 * @module errorRecovery
 */

import type { SSEEvent } from './types';

// ---------------------------------------------------------------------------
// Error type enum
// ---------------------------------------------------------------------------

export enum StreamErrorType {
  /** Network connection dropped (fetch rejected, reader error) */
  NETWORK_DROP = 'network_drop',
  /** No data received within heartbeat window (default 30 s) */
  HEARTBEAT_TIMEOUT = 'heartbeat_timeout',
  /** Total execution time exceeded (default 120 s) */
  TOTAL_TIMEOUT = 'total_timeout',
  /** Failed to parse an SSE data line as JSON */
  PARSE_ERROR = 'parse_error',
  /** Server returned a non-2xx HTTP status or an explicit error event */
  SERVER_ERROR = 'server_error',
  /** A tool execution reported failure (forwarded by Agent) */
  TOOL_ERROR = 'tool_error',
  /** User explicitly cancelled the stream */
  CANCELLED = 'cancelled',
}

// ---------------------------------------------------------------------------
// StreamError interface
// ---------------------------------------------------------------------------

export interface StreamError {
  /** Classified error type */
  type: StreamErrorType;
  /** Developer-readable message (English) */
  message: string;
  /** User-facing localised message */
  userMessage: string;
  /** Whether automatic retry is appropriate for this error */
  recoverable: boolean;
  /** HTTP status code when available */
  httpStatus?: number;
  /** Additional context for retry / debugging */
  context?: StreamErrorContext;
}

export interface StreamErrorContext {
  /** The last successfully received SSE event (for resumption context) */
  lastEventId?: number;
  /** The last SSE event object */
  lastEvent?: SSEEvent;
  /** Tool call IDs that completed before the error */
  completedToolCallIds?: string[];
  /** Tool call IDs that were in-flight when the error occurred */
  pendingToolCallIds?: string[];
  /** Number of retries already attempted */
  retryCount?: number;
  /** The raw error object if available */
  rawError?: unknown;
}

// ---------------------------------------------------------------------------
// Recovery strategy matrix
// ---------------------------------------------------------------------------

/**
 * Static lookup: whether a given error type is auto-recoverable.
 *
 * NETWORK_DROP / HEARTBEAT_TIMEOUT → yes (up to maxRetries)
 * TOTAL_TIMEOUT / CANCELLED       → never
 * SERVER_ERROR                     → depends on status (5xx yes, 4xx no)
 * PARSE_ERROR                      → partially (skip & continue, but 3+ consecutive → fatal)
 * TOOL_ERROR                       → handled by Agent itself, not stream retry
 */
const RECOVERABLE_MAP: Record<StreamErrorType, boolean | 'conditional'> = {
  [StreamErrorType.NETWORK_DROP]: true,
  [StreamErrorType.HEARTBEAT_TIMEOUT]: true,
  [StreamErrorType.TOTAL_TIMEOUT]: false,
  [StreamErrorType.PARSE_ERROR]: 'conditional',
  [StreamErrorType.SERVER_ERROR]: 'conditional',
  [StreamErrorType.TOOL_ERROR]: false, // Agent-level, not stream-level
  [StreamErrorType.CANCELLED]: false,
};

// ---------------------------------------------------------------------------
// User-friendly messages
// ---------------------------------------------------------------------------

const USER_MESSAGES: Record<StreamErrorType, string> = {
  [StreamErrorType.NETWORK_DROP]: '网络连接中断，正在尝试重新连接…',
  [StreamErrorType.HEARTBEAT_TIMEOUT]: 'Agent 响应超时，正在重试…',
  [StreamErrorType.TOTAL_TIMEOUT]:
    '执行时间超过限制，请尝试简化您的请求。',
  [StreamErrorType.PARSE_ERROR]: '数据解析异常，请稍后重试。',
  [StreamErrorType.SERVER_ERROR]: '服务端发生错误，请稍后重试。',
  [StreamErrorType.TOOL_ERROR]: '工具执行失败，Agent 正在尝试其他方案…',
  [StreamErrorType.CANCELLED]: '已取消执行。',
};

/**
 * Shown when the stream drops after the agent started calling tools. The
 * route cannot resume a turn and a rerun could execute those tools twice, so
 * the stream manager does not reconnect.
 * en: "Connection lost after the agent started using tools. It was not
 * retried to avoid running them twice; any completed edits stay on the
 * timeline."
 */
export const INTERRUPTED_AFTER_TOOLS_MESSAGE =
  '连接中断：Agent 已开始调用工具，为避免重复执行未自动重连。已完成的更改保留在时间轴上，可继续对话。';

/**
 * Turn a recoverable stream error into a terminal one because tool calls
 * already started: reconnecting re-runs the whole turn on the server.
 */
export function toNonRetryableAfterSideEffects(error: StreamError): StreamError {
  return {
    ...error,
    recoverable: false,
    message: `${error.message} (not retried: tool calls already started)`,
    userMessage: INTERRUPTED_AFTER_TOOLS_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// classifyError()
// ---------------------------------------------------------------------------

export interface ClassifyErrorInput {
  /** The raw error / exception caught */
  error: unknown;
  /** HTTP status from the fetch response, if available */
  httpStatus?: number;
  /** Reason string from handleDisconnect, e.g. 'heartbeat_timeout' */
  disconnectReason?: string;
  /** Context to attach to the resulting StreamError */
  context?: StreamErrorContext;
}

/**
 * Classify a raw error into a typed `StreamError`.
 *
 * Classification priority:
 * 1. Explicit disconnect reason (heartbeat, total timeout, cancel)
 * 2. HTTP status code (4xx / 5xx)
 * 3. Error message heuristics (network keywords, abort signal)
 * 4. Fallback to NETWORK_DROP (most common real-world cause)
 */
export function classifyError(input: ClassifyErrorInput): StreamError {
  const { error, httpStatus, disconnectReason, context } = input;
  const rawMessage = error instanceof Error ? error.message : String(error ?? 'Unknown error');

  // ---- 1. Explicit disconnect reasons ----
  if (disconnectReason === 'heartbeat_timeout') {
    return buildStreamError(StreamErrorType.HEARTBEAT_TIMEOUT, rawMessage, httpStatus, context);
  }
  if (disconnectReason === 'total_timeout') {
    return buildStreamError(StreamErrorType.TOTAL_TIMEOUT, rawMessage, httpStatus, context);
  }
  if (disconnectReason === 'cancelled') {
    return buildStreamError(StreamErrorType.CANCELLED, rawMessage, httpStatus, context);
  }

  // ---- 2. HTTP status ----
  if (httpStatus !== undefined && httpStatus >= 400) {
    return buildStreamError(StreamErrorType.SERVER_ERROR, rawMessage, httpStatus, context);
  }

  // ---- 3. Error message heuristics ----
  const lowerMessage = rawMessage.toLowerCase();

  // AbortController signals
  if (
    lowerMessage.includes('abort') ||
    lowerMessage.includes('cancelled') ||
    lowerMessage.includes('canceled') ||
    (error instanceof DOMException && error.name === 'AbortError')
  ) {
    return buildStreamError(StreamErrorType.CANCELLED, rawMessage, httpStatus, context);
  }

  // Network errors
  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('net::') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('load failed') ||
    lowerMessage.includes('networkerror')
  ) {
    return buildStreamError(StreamErrorType.NETWORK_DROP, rawMessage, httpStatus, context);
  }

  // Timeout patterns
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return buildStreamError(StreamErrorType.TOTAL_TIMEOUT, rawMessage, httpStatus, context);
  }

  // Parse errors
  if (
    lowerMessage.includes('json') ||
    lowerMessage.includes('parse') ||
    lowerMessage.includes('unexpected token') ||
    lowerMessage.includes('syntaxerror')
  ) {
    return buildStreamError(StreamErrorType.PARSE_ERROR, rawMessage, httpStatus, context);
  }

  // ---- 4. Fallback ----
  return buildStreamError(StreamErrorType.NETWORK_DROP, rawMessage, httpStatus, context);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildStreamError(
  type: StreamErrorType,
  rawMessage: string,
  httpStatus?: number,
  context?: StreamErrorContext,
): StreamError {
  return {
    type,
    message: rawMessage,
    userMessage: USER_MESSAGES[type],
    recoverable: resolveRecoverable(type, httpStatus),
    httpStatus,
    context: context ? { ...context, rawError: undefined } : undefined,
  };
}

/**
 * Determine whether a specific error instance is recoverable, accounting
 * for conditional cases (SERVER_ERROR depends on status code, PARSE_ERROR
 * is recoverable only in isolation).
 */
function resolveRecoverable(type: StreamErrorType, httpStatus?: number): boolean {
  const value = RECOVERABLE_MAP[type];
  if (typeof value === 'boolean') return value;

  // Conditional cases
  if (type === StreamErrorType.SERVER_ERROR) {
    // 4xx → client error, not recoverable; 5xx → server error, retryable
    if (httpStatus !== undefined) return httpStatus >= 500;
    return false;
  }

  if (type === StreamErrorType.PARSE_ERROR) {
    // Single parse errors are recoverable (skip the line); the caller
    // tracks consecutive parse failures and escalates when threshold met.
    return true;
  }

  return false;
}

/**
 * Calculate exponential backoff delay for retry attempts.
 *
 * @param attempt - Zero-based retry attempt number (0 = first retry)
 * @param baseDelay - Base delay in milliseconds (default 1000)
 * @returns Delay in milliseconds: 1000 → 2000 (capped at attempt 1)
 */
export function getRetryDelay(attempt: number, baseDelay = 1000): number {
  // Exponential: 1s, 2s — capped because maxRetries is 2
  return baseDelay * Math.pow(2, Math.min(attempt, 1));
}

/**
 * Check whether the error is recoverable AND retry budget remains.
 */
export function shouldRetry(
  error: StreamError,
  currentRetryCount: number,
  maxRetries: number,
): boolean {
  if (!error.recoverable) return false;
  if (currentRetryCount >= maxRetries) return false;
  return true;
}
