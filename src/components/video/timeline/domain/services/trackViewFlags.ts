/**
 * trackViewFlags — lock, mute and visibility are view / protection state,
 * not content (S12 invariant 2, D-27 / D-31).
 *
 * Toggling them records no history, and a write that restores content (undo,
 * redo, undoing an agent turn) keeps whatever the user set since. Otherwise
 * undoing a turn silently unmutes a track the user muted afterwards and the
 * export brings the music back, or quietly drops a lock.
 *
 * Pure: no store or React access.
 */

import type { TrackData } from '../types';

export const VIEW_FLAG_KEYS = ['isLocked', 'isMuted', 'isVisible'] as const;

export type TrackViewFlagKey = (typeof VIEW_FLAG_KEYS)[number];

export type TrackViewFlags = Record<TrackViewFlagKey, boolean>;

/** A track's current flags, with the defaults the domain applies on import. */
export function readViewFlags(track: Pick<TrackData, TrackViewFlagKey>): TrackViewFlags {
  return {
    isLocked: track.isLocked ?? false,
    isMuted: track.isMuted ?? false,
    isVisible: track.isVisible ?? true,
  };
}

/**
 * Tracks in `incoming` that share an id with a track in `current` take the
 * current track's flags; every other track is returned as it is. Neither
 * input is modified.
 */
export function carryViewFlags(
  incoming: readonly TrackData[],
  current: readonly TrackData[],
): TrackData[] {
  const currentById = new Map<string, TrackData>();
  for (const track of current) currentById.set(track.id, track);
  return incoming.map((track) => {
    const live = currentById.get(track.id);
    return live ? { ...track, ...readViewFlags(live) } : track;
  });
}
