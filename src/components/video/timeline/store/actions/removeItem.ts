/**
 * removeItem — Orchestrated action for deleting one or more timeline items.
 *
 * Records history before and after deletion. Supports batch removal
 * (e.g., deleting all selected items). Items on locked tracks are never
 * removed, and a removal that ends up touching nothing records no history.
 */

import type { TimelineStore } from '../useTimelineStore';

/** Ids that exist and sit on an unlocked track. */
function filterEditableItemIds(
  get: () => TimelineStore,
  itemIds: readonly string[],
): string[] {
  const aggregate = get()._aggregate;
  return itemIds.filter(id => {
    const found = aggregate.findItem(id);
    return found !== null && !found.track.isLocked;
  });
}

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
  if (filterEditableItemIds(get, [itemId]).length === 0) return;

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

  // Auto-organize: close any gap left by the removed item.
  get().autoOrganize();

  get().captureNextState();
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
  const editableIds = filterEditableItemIds(get, itemIds);
  if (editableIds.length === 0) return;

  const state = get();

  // Record a single history entry for the batch
  state.recordAction('REMOVE_ITEM', { itemIds: editableIds });

  // Remove each item
  for (const itemId of editableIds) {
    state.removeItem(itemId);
  }

  // Clear selection
  state.deselectAll();

  // Auto-organize once for the whole batch.
  get().autoOrganize();

  get().captureNextState();
}
