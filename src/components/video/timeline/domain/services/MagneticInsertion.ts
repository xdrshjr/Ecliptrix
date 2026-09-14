/**
 * MagneticInsertion — where a dragged clip lands among its magnetic peers.
 *
 * Video and audio lanes pack clips flush from 0, so a drop position only means
 * "between which neighbours". Committing the raw preview start let the stable
 * sort keep an earlier clip in front of one released at the same time: a clip
 * dragged to 0 came back second (TL3-01). The midpoint rule (D-29) lets clips
 * of any length reach any slot.
 *
 * Pure: no store, React or DOM access.
 */

import { TIME_EPSILON } from './ClipTimeMapping';
import type { LanePeer } from './FreeLaneRules';

/**
 * Insertion index of the dragged clip among the other clips of its lane,
 * ordered by start time: the number of those clips whose midpoint lies at or
 * before `previewStart`. Peers are the same `LanePeer` shape free lanes use,
 * built with `lanePeersOf`.
 */
export function magneticInsertIndex(
  peers: readonly LanePeer[],
  draggedId: string,
  previewStart: number,
): number {
  let index = 0;
  for (const peer of peers) {
    if (peer.id === draggedId) continue;
    if (peer.startTime + peer.duration / 2 <= previewStart + TIME_EPSILON) index += 1;
  }
  return index;
}
