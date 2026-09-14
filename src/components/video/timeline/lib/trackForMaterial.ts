/**
 * Which track a material lands on when the caller did not name one (a drop
 * onto a track that no longer exists, or a programmatic add). Pure so the
 * compatibility rule lives in one place and the all-locked case is testable.
 */

import type { MaterialItem } from '@/types';
import type { TrackData } from '../domain';

type TrackCandidate = Pick<TrackData, 'id' | 'type' | 'isLocked'>;

export type TrackForMaterialLookup =
  | { trackId: string; reason?: undefined }
  | { trackId: null; reason: 'all-locked' | 'no-compatible-track' };

/** Whether a track can hold this material type, ignoring its lock. */
export function isTrackCompatibleWithMaterial(
  track: TrackCandidate,
  materialType: MaterialItem['type'],
): boolean {
  if (materialType === 'image') return track.id === 'image-track-1' || track.type === 'video';
  if (materialType === 'video') return track.type === 'video' && !track.id.startsWith('image-track');
  if (materialType === 'audio') return track.type === 'audio';
  if (materialType === 'subtitle') return track.type === 'subtitle';
  return false;
}

/**
 * First unlocked compatible track. When every compatible track is locked the
 * reason says so, letting the caller explain the refusal instead of dropping
 * the material silently.
 */
export function findTrackForMaterial(
  tracks: readonly TrackCandidate[],
  materialType: MaterialItem['type'],
): TrackForMaterialLookup {
  const compatible = tracks.filter(track => isTrackCompatibleWithMaterial(track, materialType));
  const unlocked = compatible.find(track => !track.isLocked);
  if (unlocked) return { trackId: unlocked.id };
  return {
    trackId: null,
    reason: compatible.length > 0 ? 'all-locked' : 'no-compatible-track',
  };
}
