/**
 * HistoryService
 *
 * Extracted from TimelinePanel.tsx:
 *  - addToHistory (lines 334-361)
 *  - updateLastHistoryNextState (lines 364-383)
 *  - handleUndo (lines 1675-1714)
 *  - handleRedo (lines 1716-1764)
 *
 * Implements snapshot-based undo/redo (NOT command pattern).
 * Each action records a before-snapshot (previousState) and an
 * after-snapshot (nextState). Undo restores previousState; redo
 * restores nextState.
 *
 * This is a stateful class (not static), because it holds the history
 * stack and current index. It has NO external dependencies — no React,
 * no DOM, no timers.
 */

import type { TimelineSnapshot } from '../types';

// ---------------------------------------------------------------------------
// TimelineAction — the unit stored in the history stack
// ---------------------------------------------------------------------------

/**
 * Represents a single recorded user action with before/after snapshots.
 *
 * Action type values match the existing code in TimelinePanel.tsx.
 */
export interface TimelineAction {
  type:
    | 'ADD_ITEM'
    | 'REMOVE_ITEM'
    | 'UPDATE_ITEM'
    | 'MOVE_ITEM'
    | 'SELECT_ITEM'
    | 'DESELECT_ALL'
    | 'SELECT_ALL_TRACK_ITEMS'
    | 'TRACK_LOCK'
    | 'TRACK_MUTE'
    | 'TRACK_VOLUME'
    | 'TRACK_VISIBILITY'
    | 'TRACK_ADD'
    | 'TRACK_REMOVE';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
  timestamp: Date;
  /** State snapshot taken BEFORE the action was applied. */
  previousState?: TimelineSnapshot;
  /** State snapshot taken AFTER the action was applied (captured on next render). */
  nextState?: TimelineSnapshot;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of actions retained in the history stack. */
const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// HistoryService
// ---------------------------------------------------------------------------

export class HistoryService {
  /** Exposed constant for external consumers. */
  static readonly MAX_HISTORY = MAX_HISTORY;

  /** The ordered list of recorded actions. */
  private _history: TimelineAction[] = [];

  /**
   * Points to the current position in the history stack.
   *
   * When the user has not undone anything, this equals `_history.length - 1`.
   * After an undo, it decrements. After a redo, it increments.
   *
   * A value of -1 means "before any recorded action" — there is nothing to undo.
   */
  private _historyIndex: number = -1;

  // -----------------------------------------------------------------------
  // Mutators
  // -----------------------------------------------------------------------

  /**
   * Record a new action.
   *
   * Extracted from TimelinePanel.tsx addToHistory (lines 334-361):
   *   1. Truncate any forward history beyond the current index (creates a
   *      new branch, discarding redo stack).
   *   2. Append the new action.
   *   3. Trim to MAX_HISTORY if needed (remove oldest entries).
   *   4. Set historyIndex to the new last position.
   *
   * The caller is responsible for setting previousState on the action
   * (typically a snapshot of the current state before the action). If
   * previousState is not set on the action, the caller should call
   * captureBeforeState() before this method.
   */
  addAction(action: TimelineAction): void {
    // 1. Truncate forward history (new branch)
    this._history = this._history.slice(0, this._historyIndex + 1);

    // 2. Append
    this._history.push(action);

    // 3. Trim to MAX_HISTORY
    if (this._history.length > MAX_HISTORY) {
      this._history = this._history.slice(-MAX_HISTORY);
    }

    // 4. Update index to point at the new last entry
    this._historyIndex = this._history.length - 1;
  }

  /**
   * Attach a "before" snapshot to the most recently added action.
   *
   * This is a convenience method for callers that capture the snapshot
   * separately from the addAction call (e.g. when the action is created
   * before the state is snapshotted).
   *
   * @param snapshot  A deep-cloned snapshot of the timeline state before
   *                  the action was applied.
   */
  captureBeforeState(snapshot: TimelineSnapshot): void {
    if (this._history.length === 0) return;

    const lastIndex = this._history.length - 1;
    this._history[lastIndex] = {
      ...this._history[lastIndex],
      previousState: snapshot,
    };
  }

  /**
   * Attach an "after" snapshot to the most recently added action.
   *
   * Extracted from TimelinePanel.tsx updateLastHistoryNextState (lines 364-383).
   * Typically called on the next render frame after the action has been applied
   * so that the snapshot reflects the post-mutation state.
   *
   * @param snapshot  A deep-cloned snapshot of the timeline state after
   *                  the action was applied.
   */
  captureAfterState(snapshot: TimelineSnapshot): void {
    if (this._history.length === 0) return;

    const lastIndex = this._history.length - 1;
    this._history[lastIndex] = {
      ...this._history[lastIndex],
      nextState: snapshot,
    };
  }

  // -----------------------------------------------------------------------
  // Undo / Redo
  // -----------------------------------------------------------------------

  /**
   * Undo the most recent action.
   *
   * Extracted from TimelinePanel.tsx handleUndo (lines 1675-1714).
   *
   * @returns The previousState snapshot to restore, or null if there is
   *          nothing to undo.
   */
  undo(): TimelineSnapshot | null {
    if (!this.canUndo()) {
      return null;
    }

    const actionToUndo = this._history[this._historyIndex];
    if (!actionToUndo || !actionToUndo.previousState) {
      return null;
    }

    this._historyIndex--;
    return actionToUndo.previousState;
  }

  /**
   * Redo the next action in the history.
   *
   * Extracted from TimelinePanel.tsx handleRedo (lines 1716-1764).
   *
   * @returns The nextState snapshot to restore, or null if there is
   *          nothing to redo.
   */
  redo(): TimelineSnapshot | null {
    if (!this.canRedo()) {
      return null;
    }

    const actionToRedo = this._history[this._historyIndex + 1];
    if (!actionToRedo || !actionToRedo.nextState) {
      return null;
    }

    this._historyIndex++;
    return actionToRedo.nextState;
  }

  // -----------------------------------------------------------------------
  // Query methods
  // -----------------------------------------------------------------------

  /**
   * Whether an undo operation is possible.
   *
   * True when the index is >= 0 and the action at that index has a
   * previousState snapshot.
   */
  canUndo(): boolean {
    return (
      this._historyIndex >= 0 &&
      this._historyIndex < this._history.length &&
      !!this._history[this._historyIndex]?.previousState
    );
  }

  /**
   * Whether a redo operation is possible.
   *
   * True when there are actions after the current index that have a
   * nextState snapshot.
   */
  canRedo(): boolean {
    return (
      this._historyIndex < this._history.length - 1 &&
      !!this._history[this._historyIndex + 1]?.nextState
    );
  }

  /** Total number of recorded actions. */
  getActionCount(): number {
    return this._history.length;
  }

  /** Current index in the history stack. -1 means "at the beginning". */
  getCurrentIndex(): number {
    return this._historyIndex;
  }

  /** Read-only access to the history array (for debugging/inspection). */
  getHistory(): ReadonlyArray<TimelineAction> {
    return this._history;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Clear all history (e.g. after importing a project JSON).
   *
   * Resets the stack and index to their initial empty state.
   */
  clear(): void {
    this._history = [];
    this._historyIndex = -1;
  }
}
