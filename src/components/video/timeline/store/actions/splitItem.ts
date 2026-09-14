/**
 * splitItem — Orchestrated action for the split/cut operation (spec 01 §2.3).
 *
 * Resolves the target clips by scope, records ONE 'SPLIT_ITEM' history entry,
 * splits each target at the cut time, runs autoOrganize, then schedules the
 * after-snapshot capture. The whole batch enters the undo stack as a single
 * atomic unit, matching removeItemsAction / swapItemsAction.
 */

import type { TimelineStore } from '../useTimelineStore';
import { TIME_EPSILON } from '../../domain';
import type { TrackData, TimelineItemData } from '../../domain';

/** Where the split applies its cut. */
export type SplitScope = 'selected' | 'playhead';

/**
 * Whether `tCut` falls strictly inside an item interval with epsilon margin.
 * Splitting exactly at an edge would yield a zero-length half, so it is
 * excluded here (the domain layer rejects it too — this avoids a no-op call).
 */
function cutIsInside(item: TimelineItemData, tCut: number): boolean {
  const start = item.startTime;
  const end = item.startTime + item.duration;
  return tCut > start + TIME_EPSILON && tCut < end - TIME_EPSILON;
}

/**
 * Collect the ids of clips eligible for a split at `tCut`. Locked tracks are
 * skipped entirely; for 'playhead' all visible unlocked tracks are scanned and
 * only the clip(s) the cursor sits inside are returned; for 'selected' only the
 * currently selected clips that the cut crosses are returned.
 */
function collectTargetIds(
  tracks: TrackData[],
  selected: ReadonlyArray<string>,
  tCut: number,
  scope: SplitScope,
): string[] {
  const selectedSet = new Set(selected);
  const ids: string[] = [];

  for (const track of tracks) {
    if (track.isLocked || !track.isVisible) continue;
    for (const item of track.items) {
      if (scope === 'selected' && !selectedSet.has(item.id)) continue;
      if (!cutIsInside(item, tCut)) continue;
      ids.push(item.id);
    }
  }

  return ids;
}

/**
 * Split clips at a track-timeline cut time.
 *
 * @param get    Zustand get accessor.
 * @param tCut   Cut time on the track timeline (seconds).
 * @param scope  'playhead' cuts every visible unlocked clip under the cursor;
 *               'selected' cuts only the currently selected clips the cut crosses.
 */
export function splitAction(
  get: () => TimelineStore,
  tCut: number,
  scope: SplitScope,
): void {
  const state = get();
  const targetIds = collectTargetIds(state.tracks, state.selectedItems, tCut, scope);
  if (targetIds.length === 0) return; // nothing to cut → no history entry

  state.recordAction('SPLIT_ITEM', { tCut, scope, itemIds: targetIds });

  for (const id of targetIds) {
    state.splitItemAtTime(id, tCut);
  }

  get().autoOrganize();

  get().captureNextState();
}
