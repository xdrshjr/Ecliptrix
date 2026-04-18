/**
 * trackActions — Orchestrated actions for track-level operations.
 *
 * Each action records history before the mutation and schedules
 * after-snapshot capture, following the same pattern as item actions.
 */

import type { TimelineStore } from '../useTimelineStore';

/**
 * Toggle the locked state of a track.
 */
export function toggleTrackLockAction(
  get: () => TimelineStore,
  trackId: string,
): void {
  const state = get();
  state.recordAction('TRACK_LOCK', { trackId });
  state.toggleTrackLock(trackId);
  scheduleNextStateCapture(get);
}

/**
 * Toggle the muted state of a track.
 */
export function toggleTrackMuteAction(
  get: () => TimelineStore,
  trackId: string,
): void {
  const state = get();
  state.recordAction('TRACK_MUTE', { trackId });
  state.toggleTrackMute(trackId);
  scheduleNextStateCapture(get);
}

/**
 * Toggle the visibility of a track.
 */
export function toggleTrackVisibilityAction(
  get: () => TimelineStore,
  trackId: string,
): void {
  const state = get();
  state.recordAction('TRACK_VISIBILITY', { trackId });
  state.toggleTrackVisibility(trackId);
  scheduleNextStateCapture(get);
}

/**
 * Set the volume of a track.
 *
 * @param volume  Volume as a percentage (0-200).
 */
export function setTrackVolumeAction(
  get: () => TimelineStore,
  trackId: string,
  volume: number,
): void {
  const state = get();
  state.recordAction('TRACK_VOLUME', { trackId, volume });
  state.setTrackVolume(trackId, volume);
  scheduleNextStateCapture(get);
}

export type RemoveTrackGroupKey = 'video' | 'image' | 'audio' | 'subtitle';

export type RemoveTrackResult =
  | { ok: true }
  | { ok: false; reason: 'LAST_TRACK' }
  | { ok: false; reason: 'LAST_OF_GROUP'; group: RemoveTrackGroupKey }
  | { ok: false; reason: 'NOT_FOUND' };

/**
 * Remove a track.
 *
 * Refuses to delete the last remaining track globally or the last track of a
 * logical group (video/image/audio/subtitle). image tracks are distinguished
 * from video tracks by the 'image-track' id prefix. Cleans up any selected
 * items that belong to the doomed track so the selection set does not retain
 * dangling IDs. Returns a typed result so the UI layer can decide how to
 * surface feedback (toast vs. inline).
 */
export function removeTrackAction(
  get: () => TimelineStore,
  trackId: string,
): RemoveTrackResult {
  const state = get();
  const tracks = state.tracks;

  if (tracks.length <= 1) {
    return { ok: false, reason: 'LAST_TRACK' };
  }

  const target = tracks.find(tr => tr.id === trackId);
  if (!target) return { ok: false, reason: 'NOT_FOUND' };

  const groupKey: RemoveTrackGroupKey = target.id.startsWith('image-track')
    ? 'image'
    : (target.type as 'video' | 'audio' | 'subtitle');

  const sameGroupCount = tracks.filter(tr => {
    if (groupKey === 'image') return tr.id.startsWith('image-track');
    return tr.type === groupKey && !tr.id.startsWith('image-track');
  }).length;

  if (sameGroupCount <= 1) {
    return { ok: false, reason: 'LAST_OF_GROUP', group: groupKey };
  }

  state.clearItemsOfTrack(trackId);
  state.recordAction('TRACK_REMOVE', { trackId });
  state.removeTrack(trackId);
  scheduleNextStateCapture(get);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function scheduleNextStateCapture(get: () => TimelineStore): void {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      get().captureNextState();
    });
  } else {
    Promise.resolve().then(() => {
      get().captureNextState();
    });
  }
}
