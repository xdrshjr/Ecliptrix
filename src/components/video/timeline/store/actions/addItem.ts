/**
 * addItem — Orchestrated action for adding a material to the timeline.
 *
 * Full flow:
 *   1. Record the before-snapshot via historySlice.recordAction.
 *   2. Create item and add to aggregate via timelineSlice.addItemToTrack.
 *   3. Schedule captureNextState for after the state has settled.
 *   4. Return the created item data (for video preloading by the caller).
 */

import type { TimelineStore } from '../useTimelineStore';
import type { MaterialData, TimelineItemData } from '../../domain';

/**
 * Add a material to the timeline as a new item.
 *
 * @param get  Zustand get accessor.
 * @param trackId  Target track ID (or best-match will be found).
 * @param material  Material metadata.
 * @returns The created item data, or null on failure.
 */
export function addItemAction(
  get: () => TimelineStore,
  trackId: string,
  material: MaterialData,
): TimelineItemData | null {
  const state = get();

  // 1. Record history (captures before-snapshot)
  state.recordAction('ADD_ITEM', {
    materialId: material.id,
    materialName: material.name,
    trackId,
  });

  // 2. Create and add the item
  const itemData = state.addItemToTrack(trackId, material);

  // 3. Schedule after-snapshot capture
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      get().captureNextState();
    });
  } else {
    // Node.js / test environment fallback
    Promise.resolve().then(() => {
      get().captureNextState();
    });
  }

  return itemData;
}
