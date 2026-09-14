/**
 * reorderItem — commit a same-lane move on a magnetic (video / audio) track
 * as "take slot N" instead of "start at T" (TL3-01).
 *
 * The lane is packed flush from 0 either way; what the user chose by dropping
 * is the order. A release that keeps the clip in its slot is not an edit and
 * records nothing.
 */

import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';

/**
 * Move `itemId` to `insertIndex` among the other clips of its lane.
 *
 * @returns whether the timeline changed (and one history entry was written).
 */
export function reorderItemAction(
  get: () => TimelineStore,
  itemId: string,
  insertIndex: number,
): boolean {
  const state = get();
  if (isEditLocked(state)) return false;
  const found = state._aggregate.findItem(itemId);
  if (!found || found.track.isLocked) return false;
  if (found.track.type !== 'video' && found.track.type !== 'audio') return false;

  const currentIndex = [...found.track.items]
    .sort((a, b) => a.startTime.value - b.startTime.value)
    .findIndex(item => item.id === itemId);
  if (currentIndex === insertIndex) return false;

  state.recordAction('MOVE_ITEM', { itemId, insertIndex });
  try {
    state._aggregate.reorderMagneticItem(itemId, insertIndex);
  } catch (error) {
    // Pre-checked above; if the aggregate still refuses, the capture below
    // finds the tracks unchanged and withdraws the entry.
    console.error('[reorderItemAction] reorder failed', { itemId, insertIndex, error });
  }
  get().autoOrganize();
  get().captureNextState();
  return true;
}
