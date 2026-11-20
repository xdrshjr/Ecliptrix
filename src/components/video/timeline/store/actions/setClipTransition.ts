/**
 * setClipTransition — orchestrated action for clearing / editing a clip's
 * fade-in / fade-out from the timeline UI.
 *
 * Mirrors {@link setCameraMotionAction}: ONE history entry for the whole
 * batch, then the after-snapshot, so undo/redo treats it as one atomic step.
 * Transitions are also written by the editing agent; this is the user's way to
 * see-and-revert that write (the toolbar has no "add transition" flow yet).
 */

import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';
import type { SequenceTransitionData } from '../../domain';
import { canApplyCameraMotion } from '../../../playback/camera/eligibility';

/** A side that is absent is left untouched; `null` clears it. */
export interface TransitionPatch {
  in?: SequenceTransitionData | null;
  out?: SequenceTransitionData | null;
}

function sameTransition(
  current: SequenceTransitionData | undefined,
  next: SequenceTransitionData | null,
): boolean {
  if (next === null) return current === undefined;
  return current?.type === next.type && current.duration === next.duration;
}

/**
 * Apply `patch` to every editable item in `itemIds`.
 *
 * Re-checks eligibility with the shared visual-clip predicate (locked tracks
 * refuse, as in TL3-06) and skips items the patch would not change, so a
 * redundant click never records an empty undo step.
 *
 * @param get      Zustand get accessor.
 * @param itemIds  Target item ids.
 * @param patch    Sides to set (object) or clear (`null`).
 * @returns whether any clip was changed.
 */
export function setClipTransitionAction(
  get: () => TimelineStore,
  itemIds: string[],
  patch: TransitionPatch,
): boolean {
  if (!itemIds || itemIds.length === 0) return false;
  if (patch.in === undefined && patch.out === undefined) return false;

  const state = get();
  if (isEditLocked(state)) return false;

  const targets = itemIds.filter((id) => {
    const found = state._aggregate.findItem(id);
    if (!found) return false;
    if (!canApplyCameraMotion(found.item.toPlainObject(), found.track.toPlainObject())) return false;
    const inChanges = patch.in !== undefined && !sameTransition(found.item.transitionIn, patch.in);
    const outChanges = patch.out !== undefined && !sameTransition(found.item.transitionOut, patch.out);
    return inChanges || outChanges;
  });
  if (targets.length === 0) return false;

  state.recordAction('UPDATE_ITEM', { itemIds: targets, kind: 'TRANSITION' });
  targets.forEach((id) => get().updateItemTransition(id, patch));
  get().captureNextState();
  return true;
}
