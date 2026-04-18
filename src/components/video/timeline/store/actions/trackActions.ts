/**
 * trackActions — Orchestrated actions for track-level operations.
 *
 * Each action records history before the mutation and schedules
 * after-snapshot capture, following the same pattern as item actions.
 */

import type { TimelineStore } from '../useTimelineStore';
import { clampVolume } from '../../constants';

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
  const clamped = clampVolume(volume);
  const state = get();
  state.recordAction('TRACK_VOLUME', { trackId, volume: clamped });
  state.setTrackVolume(trackId, clamped);
  scheduleNextStateCapture(get);
}

// ---------------------------------------------------------------------------
// Add track
// ---------------------------------------------------------------------------

export type AddTrackType = 'video' | 'image' | 'audio' | 'subtitle';

export interface AddTrackParams {
  type: AddTrackType;
  /** Localized base name (e.g. "Video Track"); caller supplies to keep store i18n-agnostic. */
  baseTrackName: string;
}

export interface AddTrackResult {
  trackId: string;
}

/**
 * Insert a new track into the timeline, recording history so Undo works.
 *
 * Group-aware placement: video/image/audio/subtitle each live in their own
 * group; new tracks are appended to the end of their own group (or inserted
 * before the first track of a higher-priority group if none exist).
 * Monotonic numbering based on the highest existing suffix in the same group.
 */
export function addTrackAction(
  get: () => TimelineStore,
  { type, baseTrackName }: AddTrackParams,
): AddTrackResult {
  const state = get();
  const existingIds = state.tracks.map(tr => tr.id);

  const idPrefix = type === 'image' ? 'image-track' : `${type}-track`;
  const domainType: 'video' | 'audio' | 'subtitle' =
    type === 'image' ? 'video' : type;

  const sameGroupTracks = state.tracks.filter(tr => {
    if (type === 'image') return tr.id.startsWith('image-track');
    if (type === 'video') return tr.type === 'video' && !tr.id.startsWith('image-track');
    return tr.type === type;
  });

  const maxExistingNumber = sameGroupTracks.reduce((max, tr) => {
    const m = tr.id.match(/-(\d+)$/) ?? tr.name.match(/(\d+)\s*$/);
    const n = m ? parseInt(m[1], 10) : 0;
    return n > max ? n : max;
  }, 0);

  let trackNumber = maxExistingNumber + 1;
  let trackId = `${idPrefix}-${trackNumber}`;
  while (existingIds.includes(trackId)) {
    trackNumber++;
    trackId = `${idPrefix}-${trackNumber}`;
  }
  const trackName = `${baseTrackName} ${trackNumber}`;

  const currentData = state.exportToData();
  const typeOrder = { video: 0, image: 1, audio: 2, subtitle: 3 } as const;
  type GroupKey = keyof typeof typeOrder;
  const getGroupKey = (tr: { id: string; type: string }): GroupKey =>
    tr.id.startsWith('image-track') ? 'image' : (tr.type as GroupKey);

  const requestedGroup: GroupKey = type;
  const sameGroupExisting = currentData.tracks.filter(
    tr => getGroupKey(tr) === requestedGroup,
  );

  let insertIndex = currentData.tracks.length;
  let orderValue: number;

  if (sameGroupExisting.length > 0) {
    const lastSame = sameGroupExisting[sameGroupExisting.length - 1];
    insertIndex = currentData.tracks.indexOf(lastSame) + 1;
    orderValue = lastSame.order + 1;
  } else {
    const priority = typeOrder[requestedGroup];
    const insertBeforeIndex = currentData.tracks.findIndex(
      tr => typeOrder[getGroupKey(tr)] > priority,
    );
    if (insertBeforeIndex === -1) {
      insertIndex = currentData.tracks.length;
      orderValue = currentData.tracks.length;
    } else {
      insertIndex = insertBeforeIndex;
      orderValue = currentData.tracks[insertBeforeIndex].order;
    }
  }

  const newTrack = {
    id: trackId,
    name: trackName,
    type: domainType,
    height: type === 'subtitle' ? 50 : (type === 'audio' || type === 'image') ? 60 : 80,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: clampVolume(100),
    order: orderValue,
    items: [],
  };

  const updatedTracks = [...currentData.tracks];
  updatedTracks.splice(insertIndex, 0, newTrack);
  updatedTracks.forEach((tr, i) => { tr.order = i; });

  // Record action BEFORE the mutation so the before-snapshot is correct.
  state.recordAction('TRACK_ADD', { trackId, trackType: type });
  state.importFromData({ ...currentData, tracks: updatedTracks });
  scheduleNextStateCapture(get);

  return { trackId };
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
