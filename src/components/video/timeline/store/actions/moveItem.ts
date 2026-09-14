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
import { isEditLocked } from '../editLock';
import { fitMove, lanePeersOf } from '../../domain/services/FreeLaneRules';

/**
 * Move a timeline item to a new start time.
 *
 * A committed move on a subtitle lane lands in the nearest free gap instead
 * of on top of another caption; when no gap holds it, nothing happens and no
 * history is written (TL3-04).
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
  if (isEditLocked(state)) return;

  let startTime = newStartTime;
  if (!isPreview) {
    const found = state._aggregate.findItem(itemId);
    if (found?.track.type === 'subtitle') {
      const fitted = fitMove(lanePeersOf(found.track), itemId, newStartTime, found.item.duration.value);
      if (fitted === null) return;
      startTime = fitted;
    }
    // Record history (captures before-snapshot)
    state.recordAction('MOVE_ITEM', { itemId, newStartTime: startTime });
  }

  // Perform the move
  state.moveItem(itemId, startTime, isPreview);

  if (!isPreview) {
    // Auto-organize on commit only — preview drags must not pack tracks.
    get().autoOrganize();

    // Capture the after-snapshot synchronously (the move already happened)
    get().captureNextState();
  }
}
