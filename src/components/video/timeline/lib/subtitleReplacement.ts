/**
 * Guards for the "recognise subtitles and replace the subtitle track" flow
 * (S key / toolbar). Pure so the ordering can be pinned by tests without
 * rendering TimelinePanel.
 */

import type { TrackData } from '../domain';

export type SubtitleReplacementBlocker = 'extracting' | 'confirm-pending' | 'track-locked';

export interface SubtitleReplacementInput {
  /** A transcription request is already running. */
  isExtracting: boolean;
  /**
   * The replace confirmation is open. The extracting flag is only raised
   * after the user confirms, so without this a second S press while the
   * dialog is up would start a parallel run and orphan the first prompt.
   */
  isConfirmPending: boolean;
  subtitleTrack: Pick<TrackData, 'isLocked'> | undefined;
}

/**
 * Decide whether a subtitle replacement may start, checked in the order
 * extracting → confirm-pending → track-locked. Returns null when free to go.
 */
export function getSubtitleReplacementBlocker(
  input: SubtitleReplacementInput,
): SubtitleReplacementBlocker | null {
  if (input.isExtracting) return 'extracting';
  if (input.isConfirmPending) return 'confirm-pending';
  if (input.subtitleTrack?.isLocked) return 'track-locked';
  return null;
}

export type SubtitleCommitBlocker = 'edit-locked' | 'track-missing' | 'track-locked';

export interface SubtitleCommitInput {
  /** Holder of the external edit lock (S4), or null when the timeline is free. */
  externalEditLock: string | null;
  subtitleTrack: Pick<TrackData, 'isLocked'> | undefined;
}

/**
 * Checked right before transcription starts and again before its result is
 * written: the confirmation and the request can both outlast the moment the
 * agent takes the timeline, or the track is locked / removed. Checked in the
 * order edit-locked → track-missing → track-locked; null when free to go.
 */
export function getSubtitleCommitBlocker(
  input: SubtitleCommitInput,
): SubtitleCommitBlocker | null {
  if (input.externalEditLock !== null) return 'edit-locked';
  if (!input.subtitleTrack) return 'track-missing';
  if (input.subtitleTrack.isLocked) return 'track-locked';
  return null;
}
