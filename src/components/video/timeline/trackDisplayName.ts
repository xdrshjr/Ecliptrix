// Locale-aware derivation of a human-readable track label.
//
// The timeline seeds `track.name = ''` and derives the display label at render
// time from the id prefix (`video-track-1`, `audio-track-2`, …). When users
// exported a project the empty string leaked into the JSON, so external
// consumers saw blanks. This helper centralises the derivation so both the
// render path (Track.tsx) and the export path (useTimelineExport.ts) produce
// the same label.

export interface TrackI18n {
  videoTrack: string;
  imageTrack: string;
  audioTrack: string;
  subtitleTrack: string;
}

export interface TrackLike {
  id: string;
  name: string;
  type: string;
}

export function deriveTrackDisplayName(track: TrackLike, t: TrackI18n): string {
  if (track.name && track.name.trim().length > 0) return track.name.trim();

  const match = track.id.match(/-(\d+)$/);
  const num = match ? parseInt(match[1], 10) : 0;

  if (track.id.startsWith('image-track')) {
    return num > 0 ? `${t.imageTrack} ${num}` : t.imageTrack;
  }
  if (track.id.startsWith('video-track')) {
    return num > 0 ? `${t.videoTrack} ${num}` : t.videoTrack;
  }
  if (track.id.startsWith('audio-track')) {
    return num > 0 ? `${t.audioTrack} ${num}` : t.audioTrack;
  }
  if (track.id.startsWith('subtitle-track')) {
    return num > 0 ? `${t.subtitleTrack} ${num}` : t.subtitleTrack;
  }
  return track.name;
}
