/**
 * moveItem — Orchestrated action for moving a timeline item.
 *
 * Supports two modes:
 *   - Preview mode (isPreview=true): moves the item without recording
 *     history, used during drag interactions for real-time feedback.
 *   - Commit mode (isPreview=false): records history before and after
 *     the move for undo/redo support.
 */

import type { TimelineStore } from '../useTimelineStore';

/**
 * Move a timeline item to a new start time.
 *
 * @param get  Zustand get accessor.
 * @param itemId  The item to move.
 * @param newStartTime  New start time in seconds.
 * @param isPreview  If true, skip history recording (drag preview mode).
 */
export function moveItemAction(
  get: () => TimelineStore,
  itemId: string,
  newStartTime: number,
  isPreview: boolean = false,
): void {
  const state = get();

  if (!isPreview) {
    // Record history (captures before-snapshot)
    state.recordAction('MOVE_ITEM', { itemId, newStartTime });
  }

  // Perform the move
  state.moveItem(itemId, newStartTime, isPreview);

  if (!isPreview) {
    // Auto-organize on commit only — preview drags must not pack tracks.
    get().autoOrganize();

    // Schedule after-snapshot capture
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        get().captureNextState();
      });
    } else {
      Promise.resolve().then(() => {
        get().captureNextState();
      });
    }
  }
}
