/**
 * historyActions — Orchestrated actions for undo/redo.
 *
 * These are thin wrappers that delegate to historySlice methods.
 * They exist as standalone functions for consistency with other actions
 * and to allow future cross-cutting concerns (e.g., logging, analytics).
 */

import type { TimelineStore } from '../useTimelineStore';

/**
 * Undo the most recent action.
 */
export function undoAction(get: () => TimelineStore): void {
  get().undo();
}

/**
 * Redo the next action in the history stack.
 */
export function redoAction(get: () => TimelineStore): void {
  get().redo();
}

/**
 * Clear all history (e.g., after importing a project).
 */
export function clearHistoryAction(get: () => TimelineStore): void {
  get().clearHistory();
}
