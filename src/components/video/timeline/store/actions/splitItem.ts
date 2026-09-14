/**
 * splitItem — Orchestrated action for the split/cut operation (spec 01 §2.3).
 *
 * Resolves the target clips by scope, records ONE 'SPLIT_ITEM' history entry,
 * splits each target at the cut time, runs autoOrganize, then captures the
 * after-snapshot. The whole batch enters the undo stack as a single atomic
 * unit, matching removeItemsAction / swapItemsAction.
 */

import type { TimelineStore } from '../useTimelineStore';
import { TIME_EPSILON, cutLeavesValidPieces } from '../../domain';
import type { TrackData, TimelineItemData } from '../../domain';
import { isEditLocked } from '../editLock';

/** Where the split applies its cut. */
export type SplitScope = 'selected' | 'playhead';

/**
 * What a split did. `'split'` — at least one clip was cut. `'too-close'` —
 * nothing was cut because every crossed clip would leave a piece shorter than
 * MIN_CLIP_DURATION_SECONDS, so the caller can tell the user why.
 * `'none'` — the cut crossed nothing (or the timeline is edit-locked).
 */
export type SplitOutcome = 'split' | 'none' | 'too-close';

interface SplitTargets {
  ids: string[];
  tooCloseCount: number;
}

/**
 * Whether `tCut` falls strictly inside an item interval with epsilon margin.
 * A click exactly on an edge is not an attempt to split, so it is neither a
 * target nor "too close".
 */
function cutIsInside(item: TimelineItemData, tCut: number): boolean {
  const start = item.startTime;
  const end = item.startTime + item.duration;
  return tCut > start + TIME_EPSILON && tCut < end - TIME_EPSILON;
}

/**
 * Collect the clips eligible for a split at `tCut`. Locked tracks are skipped
 * entirely; for 'playhead' all visible unlocked tracks are scanned and only
 * the clip(s) the cursor sits inside count; for 'selected' only the currently
 * selected clips the cut crosses count — on hidden tracks too, since the user
 * clicked that very clip with the cut tool (TL3-05). Crossed clips whose
 * halves would be too short are counted instead of targeted.
 */
function collectTargets(
  tracks: TrackData[],
  selected: ReadonlyArray<string>,
  tCut: number,
  scope: SplitScope,
): SplitTargets {
  const selectedSet = new Set(selected);
  const targets: SplitTargets = { ids: [], tooCloseCount: 0 };

  for (const track of tracks) {
    if (track.isLocked || (scope === 'playhead' && !track.isVisible)) continue;
    for (const item of track.items) {
      if (scope === 'selected' && !selectedSet.has(item.id)) continue;
      if (!cutIsInside(item, tCut)) continue;
      if (cutLeavesValidPieces(item.startTime, item.startTime + item.duration, tCut)) {
        targets.ids.push(item.id);
      } else {
        targets.tooCloseCount += 1;
      }
    }
  }

  return targets;
}

/**
 * Split clips at a track-timeline cut time.
 *
 * @param get    Zustand get accessor.
 * @param tCut   Cut time on the track timeline (seconds).
 * @param scope  'playhead' cuts every visible unlocked clip under the cursor;
 *               'selected' cuts only the currently selected clips the cut crosses.
 * @returns what happened; only `'split'` writes history.
 */
export function splitAction(
  get: () => TimelineStore,
  tCut: number,
  scope: SplitScope,
): SplitOutcome {
  const state = get();
  if (isEditLocked(state)) return 'none';

  const { ids, tooCloseCount } = collectTargets(state.tracks, state.selectedItems, tCut, scope);
  if (ids.length === 0) {
    // Nothing to cut → no history entry.
    return tooCloseCount > 0 ? 'too-close' : 'none';
  }

  state.recordAction('SPLIT_ITEM', { tCut, scope, itemIds: ids });

  for (const id of ids) {
    state.splitItemAtTime(id, tCut);
  }

  get().autoOrganize();

  get().captureNextState();
  return 'split';
}
