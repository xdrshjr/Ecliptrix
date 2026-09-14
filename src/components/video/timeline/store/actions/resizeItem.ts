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
 *
 * Both the toolbar/agent paths and a trim drag commit come through here, so
 * the lock check, history and camera-motion window shift apply to all of them.
 */

import type { TimelineStore } from '../useTimelineStore';
import type { TimelineItemData } from '../../domain';
import { isEditLocked } from '../editLock';
import { shiftCameraMotionWindow } from '../../../playback/camera/splitRebase';

/** Below this the clip-local origin did not move (float noise). */
const ORIGIN_SHIFT_EPSILON_SECONDS = 1e-9;

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
  if (isEditLocked(state)) return;
  const found = state._aggregate.findItem(itemId);
  // A refused trim (missing clip, locked lane) must not leave an empty
  // history entry behind.
  if (!found || found.track.isLocked) return;
  const before = found.item.toPlainObject();

  // Record history (captures before-snapshot)
  state.recordAction('UPDATE_ITEM', { itemId, edge, newPosition });

  // Perform the resize
  state.resizeItem(itemId, edge, newPosition);

  if (edge === 'start') {
    shiftMotionWindowWithTrim(get, before);
  }

  // Auto-organize after resize so that any trailing gap is closed.
  get().autoOrganize();

  // Capture the after-snapshot synchronously (the resize already happened)
  get().captureNextState();
}

/**
 * camera-motion-2d-3d §4.6: trimming the START edge moves the clip-local
 * origin, so an EXPLICIT motion window has to travel with it (same semantics
 * as a split). The shift is how far the origin actually moved — the in-point
 * for a video (a clamped trim moves it less than the pointer asked for), the
 * start time for a still, which has no in-point. An implicit window
 * (`duration == null`) re-flows over the new length by itself.
 */
function shiftMotionWindowWithTrim(get: () => TimelineStore, before: TimelineItemData): void {
  const motion = before.cameraMotion;
  if (!motion || motion.duration == null) return;
  const after = get()._aggregate.findItem(before.id)?.item.toPlainObject();
  if (!after) return;
  const shift =
    before.originalMaterialType === 'image'
      ? after.startTime - before.startTime
      : (after.clipStart ?? 0) - (before.clipStart ?? 0);
  if (Math.abs(shift) <= ORIGIN_SHIFT_EPSILON_SECONDS) return;
  get().updateItemCameraMotion(before.id, shiftCameraMotionWindow(motion, shift) ?? null);
}
