/**
 * Pure arithmetic behind the context ring.
 *
 * The ratio uses the same denominator as `budgetModelContext` on the server
 * (window minus the output reservation minus a fixed safety margin), so a
 * ratio of 1 means "the next request starts dropping old turns".
 */

/** Same margin `budgetModelContext` keeps free below the window. */
export const CONTEXT_SAFETY_MARGIN_TOKENS = 2048;
/** Used until the first `context_usage` event reveals the real model limits. */
export const DEFAULT_WINDOW_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export const NOTICE_RATIO = 0.6;
export const WARN_RATIO = 0.8;

export interface ContextUsageReading {
  usedTokens: number;
  windowTokens: number;
  maxOutputTokens: number;
  /** The server dropped whole old turns for this request. */
  dropped: boolean;
}

export type ContextLevel = 'ok' | 'notice' | 'warn' | 'dropped';

export function contextRatio(reading: ContextUsageReading): number {
  const capacity = reading.windowTokens - reading.maxOutputTokens - CONTEXT_SAFETY_MARGIN_TOKENS;
  if (!(capacity > 0)) return 1;
  return Math.max(0, reading.usedTokens / capacity);
}

export function contextLevel(ratio: number, dropped: boolean): ContextLevel {
  if (dropped) return 'dropped';
  if (ratio >= WARN_RATIO) return 'warn';
  return ratio >= NOTICE_RATIO ? 'notice' : 'ok';
}

/** Whole percent for display, capped at 100 so the ring never overflows its text. */
export function ratioPercent(ratio: number): number {
  return Math.min(100, Math.round(ratio * 100));
}

/**
 * The reading to show between turns: the local estimate of the conversation,
 * measured against the model limits of the last server reading (or defaults).
 * The larger of the estimate and a still-valid server reading wins, since the
 * server count also covers the system prompt the estimate cannot see.
 */
export function idleReading(
  estimatedTokens: number, lastServerReading: ContextUsageReading | null,
): ContextUsageReading {
  const windowTokens = lastServerReading?.windowTokens ?? DEFAULT_WINDOW_TOKENS;
  const maxOutputTokens = lastServerReading?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const usedTokens = Math.max(estimatedTokens, lastServerReading?.usedTokens ?? 0);
  return { usedTokens, windowTokens, maxOutputTokens, dropped: lastServerReading?.dropped ?? false };
}
