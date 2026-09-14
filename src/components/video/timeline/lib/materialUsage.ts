/**
 * materialUsage — which timeline clips reference a material.
 *
 * Shared by the materials panel delete flow and the agent `remove_material`
 * tool so both refuse / warn from the same count. Locked-track clips are
 * reported separately: deleting their material would indirectly delete a
 * clip the user locked against edits.
 */

import type { TimelineItemData, TrackData } from '../domain/types';

export interface MaterialUsage {
  materialId: string;
  itemIds: string[];
  lockedItemIds: string[];
}

/** Structural shape: accepts `TrackData`, UI `Track` and the agent's track state. */
export type UsageTrack = Pick<TrackData, 'isLocked'> & {
  items: readonly Pick<TimelineItemData, 'id' | 'materialId'>[];
};

/**
 * Only materials that are actually referenced are returned, in the order of
 * `materialIds`. Clips on locked tracks appear in both `itemIds` and
 * `lockedItemIds`. Subtitles carry no `materialId` and never count.
 */
export function findTimelineUsages(
  tracks: readonly UsageTrack[],
  materialIds: readonly string[],
): MaterialUsage[] {
  const usages = new Map<string, MaterialUsage>();
  for (const materialId of materialIds) {
    if (!usages.has(materialId)) {
      usages.set(materialId, { materialId, itemIds: [], lockedItemIds: [] });
    }
  }
  for (const track of tracks) {
    for (const item of track.items) {
      const usage = item.materialId ? usages.get(item.materialId) : undefined;
      if (!usage) continue;
      usage.itemIds.push(item.id);
      if (track.isLocked) usage.lockedItemIds.push(item.id);
    }
  }
  return Array.from(usages.values()).filter((usage) => usage.itemIds.length > 0);
}
