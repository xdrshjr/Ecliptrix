/**
 * setCameraMotion — orchestrated action for applying / clearing camera motion
 * (camera-motion-2d-3d §4.6).
 *
 * Structurally identical to {@link detachAudioAction}: record ONE history entry
 * for the whole batch, mutate every target item, then capture the after-
 * snapshot so undo/redo treats a multi-clip apply as a single atomic step.
 */

import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';
import type { CameraMotionData } from '../../domain';
import { canApplyCameraMotion } from '../../../playback/camera/eligibility';

/**
 * Apply `motion` to every eligible item in `itemIds` (or clear it with `null`).
 *
 * Eligibility is re-checked here with the shared predicate, locked tracks
 * included: a track locked while the panel was open must still refuse the
 * write (TL3-06). No-ops without recording history when nothing is left.
 *
 * @param get      Zustand get accessor.
 * @param itemIds  Target item ids.
 * @param motion   The motion to write, or `null` to reset the clip.
 * @returns whether any clip received the motion.
 */
export function setCameraMotionAction(
  get: () => TimelineStore,
  itemIds: string[],
  motion: CameraMotionData | null,
): boolean {
  if (!itemIds || itemIds.length === 0) return false;

  const state = get();
  if (isEditLocked(state)) return false;
  // Pre-flight so we never record an empty entry (mirrors detachAudioAction).
  const targets = itemIds.filter((id) => {
    const found = state._aggregate.findItem(id);
    return !!found && canApplyCameraMotion(found.item.toPlainObject(), found.track.toPlainObject());
  });
  if (targets.length === 0) return false;

  state.recordAction('UPDATE_ITEM', { itemIds: targets, kind: 'CAMERA_MOTION' });

  targets.forEach((id) => {
    get().updateItemCameraMotion(id, motion);
  });

  get().captureNextState();
  return true;
}
