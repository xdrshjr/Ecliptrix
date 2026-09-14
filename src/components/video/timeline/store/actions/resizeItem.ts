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
import { shiftCameraMotionWindow } from '../../../playback/camera/splitRebase';

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

  // camera-motion-2d-3d §4.6: trimming the START edge moves the clip-local
  // origin, so an EXPLICIT motion window has to travel with it (same semantics
  // as a split). An implicit window (`duration == null`) re-flows over the new
  // length by itself and is deliberately left alone.
  const found = edge === 'start' ? state._aggregate.findItem(itemId) : null;
  const motionBefore = found?.item.cameraMotion;
  const startDelta = found ? newPosition - found.item.startTime.value : 0;

  // Perform the resize
  state.resizeItem(itemId, edge, newPosition);

  if (motionBefore && motionBefore.duration != null && startDelta !== 0) {
    get().updateItemCameraMotion(itemId, shiftCameraMotionWindow(motionBefore, startDelta) ?? null);
  }

  // Auto-organize after resize so that any trailing gap is closed.
  get().autoOrganize();

  // Capture the after-snapshot synchronously (the resize already happened)
  get().captureNextState();
}
