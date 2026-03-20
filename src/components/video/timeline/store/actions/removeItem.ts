/**
 * removeItem — Orchestrated action for deleting one or more timeline items.
 *
 * Records history before and after deletion. Supports batch removal
 * (e.g., deleting all selected items).
 */

import type { TimelineStore } from '../useTimelineStore';

/**
 * Remove a single item from the timeline.
 *
 * @param get  Zustand get accessor.
 * @param itemId  The item to remove.
 */
export function removeItemAction(
  get: () => TimelineStore,
  itemId: string,
): void {
  const state = get();

  // Record history (captures before-snapshot)
  state.recordAction('REMOVE_ITEM', { itemId });

  // Perform the removal
  state.removeItem(itemId);

  // Clear from selection if selected (use fresh state after mutation)
  const selectedItems = get().selectedItems;
  if (selectedItems.includes(itemId)) {
    get().deselectAll();
  }

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

/**
 * Remove multiple items from the timeline in a single batch.
 *
 * Records a single history entry for the entire batch operation.
 *
 * @param get  Zustand get accessor.
 * @param itemIds  The items to remove.
 */
export function removeItemsAction(
  get: () => TimelineStore,
  itemIds: string[],
): void {
  if (itemIds.length === 0) return;

  const state = get();

  // Record a single history entry for the batch
  state.recordAction('REMOVE_ITEM', { itemIds });

  // Remove each item
  for (const itemId of itemIds) {
    state.removeItem(itemId);
  }

  // Clear selection
  state.deselectAll();

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
