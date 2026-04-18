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

/**
 * Remove a track.
 *
 * Refuses to delete the last remaining track (UI also disables the button in
 * that case; this is the store-side guard). Cleans up any selected items that
 * belong to the doomed track so the selection set does not retain dangling IDs.
 */
export function removeTrackAction(
  get: () => TimelineStore,
  trackId: string,
): void {
  const state = get();

  if (state.tracks.length <= 1) {
    return;
  }

  state.clearItemsOfTrack(trackId);
  state.recordAction('TRACK_REMOVE', { trackId });
  state.removeTrack(trackId);
  scheduleNextStateCapture(get);
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
