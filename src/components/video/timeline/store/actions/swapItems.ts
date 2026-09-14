/**
 * swapItems — Orchestrated action for swapping the startTimes of two
 * items that live on the same video/audio track.
 *
 * Records history before the mutation, applies the swap, runs autoOrganize
 * to close any incidental gap, then captures the after-snapshot. Same
 * pattern as addItemAction / moveItemAction so that the swap enters
 * the undo stack as a single atomic unit.
 */

import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';

/**
 * Whether the aggregate would accept the swap. Checked BEFORE recording, so
 * a refused swap leaves no empty history entry behind.
 */
function canSwap(get: () => TimelineStore, aId: string, bId: string): boolean {
  if (isEditLocked(get())) return false;
  const aggregate = get()._aggregate;
  const a = aggregate.findItem(aId);
  const b = aggregate.findItem(bId);
  if (!a || !b) return false;
  if (a.track.id !== b.track.id) return false;
  return !a.track.isLocked && a.track.type !== 'subtitle';
}

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
  if (!canSwap(get, aId, bId)) return;

  const state = get();

  state.recordAction('SWAP_ITEMS', { aId, bId });
  state.swapItems(aId, bId);
  state.autoOrganize();

  get().captureNextState();
}
