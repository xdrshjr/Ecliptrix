/**
 * setCameraMotion — orchestrated action for attaching / clearing a 2D or 3D
 * 运镜 on a timeline clip.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §7.2.
 *
 * Mirrors the `detachAudio` shape: eligibility is decided HERE (not in the pure
 * domain), the action no-ops without recording history when nothing can change,
 * and the after-snapshot is captured on the next frame so one panel "Apply" is
 * exactly one `Ctrl+Z` step — including the case where the user tweaked a dozen
 * sliders before applying.
 */

import type { TimelineStore } from '../useTimelineStore';
import type { CameraMotionData } from '../../domain';

/**
 * Whether two motions are value-equal, so a redundant apply records no history.
 * Compared through JSON because the payload is a small, cycle-free plain object
 * whose key order is fixed by its single construction site.
 */
function isSameMotion(
  a: CameraMotionData | undefined,
  b: CameraMotionData | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Attach or clear a camera motion on one video item.
 *
 * @param get     Zustand get accessor.
 * @param itemId  The video item to change.
 * @param motion  The motion to attach, or `null` to remove any existing one.
 * @returns True when the store changed (and a history entry was recorded).
 */
export function setCameraMotionAction(
  get: () => TimelineStore,
  itemId: string,
  motion: CameraMotionData | null,
): boolean {
  const state = get();
  const found = state._aggregate.findItem(itemId);
  if (!found) return false;

  // Camera motion is a video-frame transform; audio and subtitle items have no
  // frame to move. A locked track rejects every edit, consistent with move /
  // resize / delete.
  if (found.item.type !== 'video') return false;
  if (found.track.isLocked) return false;
  if (isSameMotion(found.item.cameraMotion, motion)) return false;

  state.recordAction('SET_CAMERA_MOTION', { itemId, presetId: motion?.presetId ?? null });
  state.setItemCameraMotion(itemId, motion);

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      get().captureNextState();
    });
  } else {
    Promise.resolve().then(() => {
      get().captureNextState();
    });
  }
  return true;
}
