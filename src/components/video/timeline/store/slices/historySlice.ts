/**
 * historySlice — Undo/redo state management.
 *
 * Wraps the HistoryService domain service to provide snapshot-based
 * undo/redo. Coordinates with timelineSlice for snapshot capture
 * and restore operations.
 *
 * Flow:
 *   1. Before a mutation, call recordAction() which captures the before-snapshot.
 *   2. After the mutation completes (and _syncDerivedState runs), call
 *      captureNextState() to attach the after-snapshot to the last action.
 *   3. On undo: restore the before-snapshot via timelineSlice.restoreFromSnapshot.
 *   4. On redo: restore the after-snapshot via timelineSlice.restoreFromSnapshot.
 */

import type { StateCreator } from 'zustand';
import { HistoryService } from '../../domain';
import type { TimelineAction } from '../../domain';
import type { TimelineStore } from '../useTimelineStore';

// ---------------------------------------------------------------------------
// Slice state + actions interface
// ---------------------------------------------------------------------------

export interface HistorySlice {
  _historyService: HistoryService;
  canUndo: boolean;
  canRedo: boolean;

  /**
   * Record a new action. Captures the current timeline state as the
   * before-snapshot automatically. The caller should schedule
   * captureNextState() after the mutation has been applied.
   */
  recordAction: (type: TimelineAction['type'], payload?: unknown) => void;

  /**
   * Capture the current timeline state as the after-snapshot for the
   * most recently recorded action. Should be called after the mutation
   * has been applied and _syncDerivedState has run.
   *
   * Typically called via requestAnimationFrame or in the next microtask
   * to ensure the state reflects the completed mutation.
   */
  captureNextState: () => void;

  /**
   * Undo the most recent action by restoring its before-snapshot.
   */
  undo: () => void;

  /**
   * Redo the next action by restoring its after-snapshot.
   */
  redo: () => void;

  /**
   * Clear all history (e.g., after a JSON import).
   */
  clearHistory: () => void;
}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createHistorySlice: StateCreator<
  TimelineStore,
  [],
  [],
  HistorySlice
> = (set, get) => ({
  _historyService: new HistoryService(),
  canUndo: false,
  canRedo: false,

  recordAction: (type: TimelineAction['type'], payload?: unknown) => {
    const state = get();
    const beforeSnapshot = state.getSnapshot();

    const action: TimelineAction = {
      type,
      payload,
      timestamp: new Date(),
      previousState: beforeSnapshot,
    };

    state._historyService.addAction(action);
    set({
      canUndo: state._historyService.canUndo(),
      canRedo: state._historyService.canRedo(),
    });
  },

  captureNextState: () => {
    const state = get();
    const afterSnapshot = state.getSnapshot();
    state._historyService.captureAfterState(afterSnapshot);
    set({
      canUndo: state._historyService.canUndo(),
      canRedo: state._historyService.canRedo(),
    });
  },

  undo: () => {
    const state = get();
    const snapshot = state._historyService.undo();
    if (snapshot) {
      state.restoreFromSnapshot(snapshot);
    }
    set({
      canUndo: state._historyService.canUndo(),
      canRedo: state._historyService.canRedo(),
    });
  },

  redo: () => {
    const state = get();
    const snapshot = state._historyService.redo();
    if (snapshot) {
      state.restoreFromSnapshot(snapshot);
    }
    set({
      canUndo: state._historyService.canUndo(),
      canRedo: state._historyService.canRedo(),
    });
  },

  clearHistory: () => {
    const state = get();
    state._historyService.clear();
    set({
      canUndo: false,
      canRedo: false,
    });
  },
});
