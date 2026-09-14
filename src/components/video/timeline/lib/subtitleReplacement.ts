/**
 * Guards for the "recognise subtitles and replace the subtitle track" flow
 * (S key / toolbar). Pure so the ordering can be pinned by tests without
 * rendering TimelinePanel.
 */

import type { MaterialItem } from '@/types';
import { selectAudioPlaybackUrl } from '@/lib/utils/audioUrl';
import type { TimelineItemData, TrackData } from '../domain';
import { isTrackRendered } from '../infrastructure/renderableTimeline';

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

/** One entry of `POST /api/audio/batch-transcribe` `audio_items` (field names are the API's). */
export interface TranscriptionItemRequest {
  id: string;
  name: string;
  url: string;
  start_time: number;
  duration: number;
  track_id: string;
  clip_start: number;
  clip_end: number;
}

type TranscribableItem = Pick<
  TimelineItemData,
  'id' | 'name' | 'type' | 'materialId' | 'startTime' | 'duration' | 'clipStart' | 'clipEnd'
>;

export type TranscribableTrack = Pick<TrackData, 'id' | 'type' | 'isVisible' | 'isMuted'> & {
  items: readonly TranscribableItem[];
};

function transcriptionUrlFor(material: MaterialItem | undefined): string {
  // Backend transcription can never fetch a blob: URL (it dies with the page).
  const resolved = material ? selectAudioPlaybackUrl(material) : null;
  return resolved && !resolved.startsWith('blob:') ? resolved : (material?.serverUrl || '');
}

/**
 * Audio clips to transcribe: only tracks that are actually heard (a muted BGM
 * lane's lyrics must not become subtitles), each with its trimmed source
 * window so the backend maps only the kept part onto the timeline.
 */
export function collectTranscriptionItems(
  tracks: readonly TranscribableTrack[],
  materials: readonly MaterialItem[],
): TranscriptionItemRequest[] {
  const materialsById = new Map(materials.map((material) => [material.id, material]));
  const requests: TranscriptionItemRequest[] = [];
  for (const track of tracks) {
    if (track.type !== 'audio' || !isTrackRendered(track)) continue;
    for (const item of track.items) {
      if (item.type !== 'audio' || !item.materialId) continue;
      // `??`, not `||`: a clip trimmed to start at 0 s is not "missing" a start.
      const clipStart = item.clipStart ?? 0;
      requests.push({
        id: item.id,
        name: item.name,
        url: transcriptionUrlFor(materialsById.get(item.materialId)),
        start_time: item.startTime,
        duration: item.duration,
        track_id: track.id,
        clip_start: clipStart,
        clip_end: item.clipEnd ?? clipStart + item.duration,
      });
    }
  }
  return requests;
}
