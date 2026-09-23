// Locale-aware derivation of a human-readable track label.
//
// The timeline seeds `track.name = ''` and derives the display label at render
// time from the id prefix (`video-track-1`, `audio-track-2`, …). When users
// exported a project the empty string leaked into the JSON, so external
// consumers saw blanks. This helper centralises the derivation so the render
// path (Track.tsx), the export path (useTimelineExport.ts) and the AI-mix
// confirmation (useAIMixedEditing.ts) all produce the same label (spec RV-04).

export interface TrackI18n {
  videoTrack: string;
  imageTrack: string;
  audioTrack: string;
  subtitleTrack: string;
  /** 「主画面」 — the first video lane. */
  mainVisual: string;
  /** 「画面」 — every further video lane, suffixed with its number. */
  visualTrack: string;
  /** 「旁白」 — an audio lane that carries a generated voice-over. */
  narrationTrack: string;
  /** Short lane names 「图片」「音频」「字幕」; the long forms stay type labels. */
  imageShort: string;
  audioShort: string;
  subtitleShort: string;
}

export interface TrackLike {
  id: string;
  name: string;
  type: string;
  /**
   * Optional so callers holding a bare track header still type-check. The
   * narration rule reads it here, inside the one function, so the three
   * callers can never disagree on what counts as narration.
   */
  items?: ReadonlyArray<{ sentenceSegments?: unknown }>;
}

/** A voice-over clip carries per-sentence timing; plain music does not. */
function hasNarration(track: TrackLike): boolean {
  return (track.items ?? []).some((item) => {
    const segments = item.sentenceSegments as { sentences?: unknown[] } | null | undefined;
    return (segments?.sentences?.length ?? 0) > 0;
  });
}

/** `base N`, or just `base` for an id without a trailing number. */
function numbered(base: string, num: number): string {
  return num > 0 ? `${base} ${num}` : base;
}

export function deriveTrackDisplayName(track: TrackLike, t: TrackI18n): string {
  if (track.name && track.name.trim().length > 0) return track.name.trim();

  // N is the number in the id, never a renumbering: names must not jump
  // when another lane is added or removed.
  const match = track.id.match(/-(\d+)$/);
  const num = match ? parseInt(match[1], 10) : 0;

  if (track.id.startsWith('image-track')) {
    return numbered(t.imageShort, num);
  }
  if (track.id.startsWith('video-track')) {
    return num === 1 ? t.mainVisual : numbered(t.visualTrack, num);
  }
  if (track.id.startsWith('audio-track')) {
    return numbered(hasNarration(track) ? t.narrationTrack : t.audioShort, num);
  }
  if (track.id.startsWith('subtitle-track')) {
    return numbered(t.subtitleShort, num);
  }
  return track.name;
}
