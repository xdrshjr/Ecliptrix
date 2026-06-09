/**
 * resizeItem — Orchestrated action for resizing a timeline item.
 *
 * Records history before and after the resize operation for undo/redo.
 *
 * Resize is a TRIM of the source interval, enforced at the entity layer
 * (TimelineItem.resize): the track duration and the clip interval move in
 * lock-step so INV-3 (duration === clipEnd - clipStart) always holds. This
 * action therefore needs no extra clip math — it routes through the slice →
 * aggregate → entity and lets the invariant live in one place (spec 01 §2.6).
 */

import type { TimelineStore } from '../useTimelineStore';

/**
 * Resize a timeline item by moving one of its edges.
 *
 * @param get  Zustand get accessor.
 * @param itemId  The item to resize.
 * @param edge  Which edge is being adjusted ('start' or 'end').
 * @param newPosition  The new position for the edge in seconds.
 */
export function resizeItemAction(
  get: () => TimelineStore,
  itemId: string,
  edge: 'start' | 'end',
  newPosition: number,
): void {
  const state = get();

  // Record history (captures before-snapshot)
  state.recordAction('UPDATE_ITEM', { itemId, edge, newPosition });

  // Perform the resize
  state.resizeItem(itemId, edge, newPosition);

  // Auto-organize after resize so that any trailing gap is closed.
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
