/**
 * addItem — Orchestrated action for adding a material to the timeline.
 *
 * Full flow:
 *   1. Resolve the target track; refuse (without touching history) when it
 *      is missing, locked or cannot hold this material type.
 *   2. Record the before-snapshot via historySlice.recordAction.
 *   3. Create item and add to aggregate via timelineSlice.addItemToTrack.
 *   4. Capture the after-snapshot synchronously.
 *   5. Return the created item data (for video preloading by the caller).
 */

import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';
import type { MaterialData, TimelineItemData } from '../../domain';
import { TrackSelectionService, TrackTypeUtils } from '../../domain';

/**
 * Add a material to the timeline as a new item.
 *
 * @param get  Zustand get accessor.
 * @param trackId  Target track ID (or best-match will be found).
 * @param material  Material metadata.
 * @returns The created item data, or null when the edit was refused.
 */
export function addItemAction(
  get: () => TimelineStore,
  trackId: string,
  material: MaterialData,
): TimelineItemData | null {
  const state = get();
  if (isEditLocked(state)) return null;

  // 1. A refused add must not record history: an empty entry would also
  //    wipe the redo stack for nothing.
  const track = TrackSelectionService.selectTrackForMaterial(
    state._aggregate.tracks,
    material.type,
    trackId,
  );
  if (
    !track ||
    track.isLocked ||
    !TrackTypeUtils.canAcceptMaterial(track.type, material.type, track.id)
  ) {
    return null;
  }

  // 2. Record history (captures before-snapshot)
  state.recordAction('ADD_ITEM', {
    materialId: material.id,
    materialName: material.name,
    trackId: track.id,
  });

  // 3. Create and add the item
  const itemData = state.addItemToTrack(track.id, material);

  // 3.5 Auto-organize: pack video/audio tracks flush from 0 after the add.
  // Not recorded in history — bracketed by the before/after snapshots above.
  get().autoOrganize();

  // 4. Every mutation above is synchronous, so capture right away.
  get().captureNextState();

  return itemData;
}
