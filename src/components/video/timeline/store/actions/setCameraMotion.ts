/**
 * setCameraMotion — orchestrated action for applying / clearing camera motion
 * (camera-motion-2d-3d §4.6).
 *
 * Structurally identical to {@link detachAudioAction}: record ONE history entry
 * for the whole batch, mutate every target item, then schedule the after-
 * snapshot on the next frame so undo/redo treats a multi-clip apply as a single
 * atomic step.
 */

import type { TimelineStore } from '../useTimelineStore';
import type { CameraMotionData } from '../../domain';

/**
 * Apply `motion` to every item in `itemIds` (or clear it with `null`).
 *
 * No-ops without recording history when there is nothing to change — an empty
 * selection must not push a bogus undo entry.
 *
 * @param get      Zustand get accessor.
 * @param itemIds  Target item ids (already filtered for eligibility by the UI).
 * @param motion   The motion to write, or `null` to reset the clip.
 */
export function setCameraMotionAction(
  get: () => TimelineStore,
  itemIds: string[],
  motion: CameraMotionData | null,
): void {
  if (!itemIds || itemIds.length === 0) return;

  const state = get();
  // Pre-flight so we never record an empty entry (mirrors detachAudioAction).
  const targets = itemIds.filter((id) => state._aggregate.findItem(id) != null);
  if (targets.length === 0) return;

  state.recordAction('UPDATE_ITEM', { itemIds: targets, kind: 'CAMERA_MOTION' });

  targets.forEach((id) => {
    get().updateItemCameraMotion(id, motion);
  });

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
