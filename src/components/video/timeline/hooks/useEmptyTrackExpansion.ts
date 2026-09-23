'use client';

/**
 * useEmptyTrackExpansion — empty image / subtitle lanes fold into a 20px
 * strip until the user opens them (spec R2 §3.10, §6.2).
 *
 * The opened lanes are view state, kept per project in localStorage under
 * `ecliptrix.timeline.expandedEmptyTracks.<projectId>` (a `string[]` of track
 * ids). It is never project data and never history. Storage can be missing or
 * throw (private mode, quota, disabled storage): every access falls back to
 * the default — collapsed — with a logged warning, so the lane still renders.
 */

import { useCallback, useEffect, useState } from 'react';

export const EXPANDED_EMPTY_TRACKS_KEY_PREFIX = 'ecliptrix.timeline.expandedEmptyTracks.';

export interface CollapsibleTrackLike {
  id: string;
  items: readonly unknown[];
}

/** Only empty image and subtitle lanes fold; a lane with content never does. */
export function isCollapsibleEmptyTrack(track: CollapsibleTrackLike): boolean {
  if (track.items.length > 0) return false;
  return track.id.startsWith('image-track') || track.id.startsWith('subtitle-track');
}

function storageKey(projectId: string): string {
  return `${EXPANDED_EMPTY_TRACKS_KEY_PREFIX}${projectId}`;
}

function parseTrackIds(raw: string | null): string[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === 'string');
}

/** Opened lane ids for a project; [] when storage is unavailable or corrupt. */
export function readExpandedEmptyTracks(projectId: string): string[] {
  // Server render: no storage, and nothing worth a warning.
  if (typeof window === 'undefined') return [];
  try {
    return parseTrackIds(window.localStorage.getItem(storageKey(projectId)));
  } catch (error) {
    console.warn('[timeline] expanded empty tracks unavailable', { projectId, error });
    return [];
  }
}

/** Remember one more opened lane; a failed write only costs the preference. */
export function rememberExpandedEmptyTrack(projectId: string, trackId: string): void {
  // Read-modify-write against storage, not a cached copy: every lane runs
  // its own hook instance, and a stale list would drop another lane's id.
  const ids = readExpandedEmptyTracks(projectId);
  if (ids.includes(trackId)) return;
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify([...ids, trackId]));
  } catch (error) {
    console.warn('[timeline] could not persist expanded empty track', {
      projectId, trackId, error,
    });
  }
}

export interface EmptyTrackExpansion {
  /** True when the lane shows as the 20px「＋ 添加…」strip. */
  isCollapsed: boolean;
  /** Open the lane at full height and remember it for this project. */
  expand: () => void;
}

/**
 * Collapse state of one lane.
 *
 * @param projectId  Project / task id scoping the preference; without one the
 *                   opened state lives only as long as the component.
 */
export function useEmptyTrackExpansion(
  projectId: string | undefined,
  track: CollapsibleTrackLike | undefined,
): EmptyTrackExpansion {
  const trackId = track?.id;
  const readStored = useCallback((): boolean => {
    if (!projectId || !trackId) return false;
    return readExpandedEmptyTracks(projectId).includes(trackId);
  }, [projectId, trackId]);

  const [isExpanded, setIsExpanded] = useState<boolean>(readStored);
  // Another project (or lane id) brings its own preference.
  useEffect(() => { setIsExpanded(readStored()); }, [readStored]);

  const expand = useCallback(() => {
    setIsExpanded(true);
    if (projectId && trackId) rememberExpandedEmptyTrack(projectId, trackId);
  }, [projectId, trackId]);

  const isCollapsed = track !== undefined && !isExpanded && isCollapsibleEmptyTrack(track);
  return { isCollapsed, expand };
}
