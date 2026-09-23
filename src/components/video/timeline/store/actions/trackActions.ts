/**
 * trackActions — Orchestrated actions for track-level operations.
 *
 * Content actions record history before the mutation and capture the
 * after-snapshot, following the same pattern as item actions. Lock, mute and
 * visibility are view flags (S12, D-27): toggling them records nothing, so it
 * never clears the redo stack and undo never flips them back.
 */

import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';
import { clampVolume, getDefaultTrackHeight, type TrackKind } from '../../constants';

/**
 * Toggle the locked state of a track. Not an undoable edit.
 */
export function toggleTrackLockAction(
  get: () => TimelineStore,
  trackId: string,
): void {
  if (isEditLocked(get())) return;
  get().toggleTrackLock(trackId);
}

/**
 * Toggle the muted state of a track. Not an undoable edit.
 */
export function toggleTrackMuteAction(
  get: () => TimelineStore,
  trackId: string,
): void {
  if (isEditLocked(get())) return;
  get().toggleTrackMute(trackId);
}

/**
 * Toggle the visibility of a track. Not an undoable edit.
 */
export function toggleTrackVisibilityAction(
  get: () => TimelineStore,
  trackId: string,
): void {
  if (isEditLocked(get())) return;
  get().toggleTrackVisibility(trackId);
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
  if (isEditLocked(get())) return;
  const clamped = clampVolume(volume);
  const state = get();
  state.recordAction('TRACK_VOLUME', { trackId, volume: clamped });
  state.setTrackVolume(trackId, clamped);
  scheduleNextStateCapture(get);
}

/**
 * Set the volume of a track WITHOUT recording an undo entry (live preview).
 *
 * Used while a volume slider is being dragged / keyboard-stepped so the
 * composition preview follows the value in real time. The reactive chain
 * (track.volume → useTimelineComposition rebuild → engine → AudioSyncPool)
 * still fires, so the preview audio updates, but no history snapshot is taken
 * — the trailing {@link setTrackVolumeAction} on release records the single
 * undo entry for the whole gesture. Callers MUST throttle (rAF) the call rate.
 *
 * @param volume  Volume as a percentage (0-200).
 */
export function setTrackVolumePreviewAction(
  get: () => TimelineStore,
  trackId: string,
  volume: number,
): void {
  if (isEditLocked(get())) return;
  get().setTrackVolume(trackId, clampVolume(volume));
}

/**
 * Commit a volume gesture as ONE undo entry that reverts to the value from
 * before the gesture began.
 *
 * The live-preview channel ({@link setTrackVolumePreviewAction}) mutates
 * `track.volume` on every throttled drag / keyboard tick WITHOUT recording
 * history, so by the time the gesture ends the store already holds an
 * intermediate value. Recording history now (via {@link setTrackVolumeAction})
 * would snapshot that intermediate value as the before-state, and a single Undo
 * would jump to a mid-gesture frame instead of the pre-gesture value. To keep
 * "one gesture = one clean undo", first restore the pre-gesture value (no
 * history), then record the history entry for the final value — so the
 * before-snapshot reflects the true start of the gesture. A gesture the
 * agent's edit lock interrupted ends at the pre-gesture value with no entry,
 * rather than leaving an unrecorded preview value in the store.
 *
 * @param preGestureVolume  track.volume captured before the gesture started.
 * @param finalVolume       The released value to commit (percentage, 0-200).
 */
export function commitTrackVolumeAction(
  get: () => TimelineStore,
  trackId: string,
  preGestureVolume: number,
  finalVolume: number,
): void {
  get().setTrackVolume(trackId, clampVolume(preGestureVolume));
  if (isEditLocked(get())) return;
  setTrackVolumeAction(get, trackId, finalVolume);
}

/**
 * Abandon a volume gesture (Escape, window blur, unmount mid-drag): put the
 * pre-gesture value back and record nothing. Unlike the preview and commit
 * actions this ignores the edit lock — restoring the value the store held
 * before the gesture is always safe, and the lock must not strand a preview.
 *
 * @param preGestureVolume  track.volume captured before the gesture started.
 */
export function revertTrackVolumePreviewAction(
  get: () => TimelineStore,
  trackId: string,
  preGestureVolume: number,
): void {
  get().setTrackVolume(trackId, clampVolume(preGestureVolume));
}

// ---------------------------------------------------------------------------
// Rename track
// ---------------------------------------------------------------------------

/** Longest track name the header accepts (spec R2 §3.10). */
export const TRACK_NAME_MAX_LENGTH = 24;

/** Trimmed and capped; '' means "use the derived default name". */
export function normalizeTrackName(name: string): string {
  return name.trim().slice(0, TRACK_NAME_MAX_LENGTH);
}

/**
 * Rename a track as one undoable edit. An empty name restores the
 * locale-derived default (deriveTrackDisplayName prefers a non-empty name).
 *
 * Locked tracks may be renamed: the name is not content. The entity's name
 * setter refuses locked tracks, so the rename goes through a data round-trip
 * like addTrackAction instead of mutating the aggregate in place.
 */
export function renameTrackAction(
  get: () => TimelineStore,
  trackId: string,
  name: string,
): void {
  if (isEditLocked(get())) return;
  const state = get();
  const nextName = normalizeTrackName(name);
  const current = state.tracks.find(tr => tr.id === trackId);
  if (!current || current.name === nextName) return;

  const data = state.exportToData();
  const tracks = data.tracks.map(tr => (
    tr.id === trackId ? { ...tr, name: nextName } : tr
  ));
  state.recordAction('TRACK_RENAME', { trackId, name: nextName });
  state.importFromData({ ...data, tracks });
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
  /** null when the edit was refused because the agent holds the edit lock. */
  trackId: string | null;
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
  if (isEditLocked(get())) return { trackId: null };
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
  // Default name is derived at render time in Track.tsx:trackDisplayName
  // based on current locale; storing '' here keeps JSON round-trip honest and
  // makes locale switches live. baseTrackName is retained in the signature
  // to avoid churn at call sites but is intentionally not used.
  void baseTrackName;
  const trackName = '';

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
    height: getDefaultTrackHeight(type as TrackKind),
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
  // Auto-organize: new tracks start empty so this is a no-op for the fresh
  // track but still keeps other tracks well-packed (defensive + consistent).
  get().autoOrganize();
  scheduleNextStateCapture(get);

  return { trackId };
}

export type RemoveTrackGroupKey = 'video' | 'image' | 'audio' | 'subtitle';

export type RemoveTrackResult =
  | { ok: true }
  | { ok: false; reason: 'LAST_TRACK' }
  | { ok: false; reason: 'LAST_OF_GROUP'; group: RemoveTrackGroupKey }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'EDIT_LOCKED' };

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
  if (isEditLocked(get())) return { ok: false, reason: 'EDIT_LOCKED' };
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
  get().autoOrganize();
  scheduleNextStateCapture(get);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function scheduleNextStateCapture(get: () => TimelineStore): void {
  // Synchronous on purpose: a capture deferred to the next frame lands on
  // whichever entry is last by then, breaking redo for same-tick edits.
  get().captureNextState();
}
