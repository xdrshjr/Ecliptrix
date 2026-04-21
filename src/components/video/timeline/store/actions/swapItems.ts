/**
 * swapItems — Orchestrated action for swapping the startTimes of two
 * items that live on the same video/audio track.
 *
 * Records history before the mutation, applies the swap, runs autoOrganize
 * to close any incidental gap, then schedules the after-snapshot capture.
 * Same pattern as addItemAction / moveItemAction so that the swap enters
 * the undo stack as a single atomic unit.
 */

import type { TimelineStore } from '../useTimelineStore';

/**
 * Swap two items on the same non-subtitle, non-locked track.
 *
 * @param get   Zustand get accessor.
 * @param aId   First item id.
 * @param bId   Second item id.
 */
export function swapItemsAction(
  get: () => TimelineStore,
  aId: string,
  bId: string,
): void {
  if (aId === bId) return;

  const state = get();

  state.recordAction('SWAP_ITEMS', { aId, bId });
  state.swapItems(aId, bId);
  state.autoOrganize();

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
