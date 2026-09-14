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
import { tracksEqual } from '../../domain/services/snapshotEquality';
import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';

// ---------------------------------------------------------------------------
// Slice state + actions interface
// ---------------------------------------------------------------------------

export interface HistorySlice {
  _historyService: HistoryService;
  canUndo: boolean;
  canRedo: boolean;

  /**
   * Record a new action. Captures the current timeline state as the
   * before-snapshot automatically. The caller should call
   * captureNextState() right after the mutation has been applied.
   */
  recordAction: (type: TimelineAction['type'], payload?: unknown) => void;

  /**
   * Capture the current timeline state as the after-snapshot for the
   * most recently recorded action. Call it synchronously, immediately
   * after the mutation and _syncDerivedState: deferring it to the next
   * frame lets a second action in the same tick steal the snapshot.
   */
  captureNextState: () => void;

  /**
   * Undo the most recent action by restoring its before-snapshot.
   * No-op while the external edit lock is held or a drag is in flight.
   */
  undo: () => void;

  /**
   * Redo the next action by restoring its after-snapshot.
   * No-op while the external edit lock is held or a drag is in flight.
   */
  redo: () => void;

  /**
   * Clear all history (e.g., after a JSON import).
   */
  clearHistory: () => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * History travel is refused while the agent holds the edit lock, and while a
 * drag is in flight: restoring a snapshot under a live gesture let the release
 * commit on top of it, leaving only the move in history and the undone step
 * impossible to redo (TL2-18).
 */
function canTravelHistory(state: TimelineStore): boolean {
  return !isEditLocked(state) && !state.isInteracting;
}

/** A restored snapshot may no longer contain the selected or edited clips (TL2-03). */
function dropReferencesToVanishedItems(get: () => TimelineStore): void {
  get().pruneSelection();
  const editingId = get().editingSubtitleId;
  if (editingId !== null && get()._aggregate.findItem(editingId) === null) {
    get().setEditingSubtitle(null);
  }
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
    // S12: an edit that left the tracks as they were (a clip that snapped
    // back, an already tidy lane, an unchanged volume) takes its entry back
    // and returns the redo branch it cut off.
    const history = state._historyService.getHistory();
    const last = history[history.length - 1];
    const unchanged =
      !!last?.previousState && tracksEqual(last.previousState.tracks, afterSnapshot.tracks);
    if (!unchanged || !state._historyService.discardLastAction()) {
      state._historyService.captureAfterState(afterSnapshot);
    }
    set({
      canUndo: state._historyService.canUndo(),
      canRedo: state._historyService.canRedo(),
    });
  },

  undo: () => {
    const state = get();
    if (!canTravelHistory(state)) return;
    const snapshot = state._historyService.undo();
    if (snapshot) {
      state.restoreFromSnapshot(snapshot);
      dropReferencesToVanishedItems(get);
    }
    set({
      canUndo: state._historyService.canUndo(),
      canRedo: state._historyService.canRedo(),
    });
  },

  redo: () => {
    const state = get();
    if (!canTravelHistory(state)) return;
    const snapshot = state._historyService.redo();
    if (snapshot) {
      state.restoreFromSnapshot(snapshot);
      dropReferencesToVanishedItems(get);
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
