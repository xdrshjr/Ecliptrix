/**
 * renderableTimeline — one rule for "what ends up in the rendered video" and
 * "where the timeline ends", shared by preview and export.
 *
 * Preview duration, export `total_duration`, the export "nothing visible"
 * guard and transcription item collection all read from here so they can
 * never disagree about hidden tracks, muted audio, blank subtitles or clips
 * whose material has been deleted.
 *
 * Pure module: no React, no store.
 */

import type { MaterialItem, TimelineItem, Track } from '@/types';

export type RenderSpanKind = 'video' | 'image' | 'audio' | 'subtitle';

export interface RenderSpan {
  itemId: string;
  trackId: string;
  kind: RenderSpanKind;
  /** Seconds. */
  start: number;
  /** Seconds, always greater than `start`. */
  end: number;
}

type RenderableItem = Pick<
  TimelineItem,
  'id' | 'startTime' | 'duration' | 'materialId' | 'text' | 'originalMaterialType'
>;

/** Structural track shape: accepts both `Track` and the domain `TrackData`. */
export type RenderableTrack = Pick<Track, 'id' | 'type' | 'isVisible' | 'isMuted'> & {
  items: readonly RenderableItem[];
};

/**
 * Locking only prevents edits (round 1 EX-02), so locked tracks still render.
 * Hidden tracks never render; mute only applies to audio tracks.
 */
export function isTrackRendered(track: Pick<Track, 'type' | 'isVisible' | 'isMuted'>): boolean {
  if (track.isVisible === false) return false;
  return !(track.type === 'audio' && track.isMuted === true);
}

function hasValidTiming(item: RenderableItem): boolean {
  return (
    Number.isFinite(item.startTime) &&
    item.startTime >= 0 &&
    Number.isFinite(item.duration) &&
    item.duration > 0
  );
}

/**
 * Whether a clip renders as a still image: tagged by `originalMaterialType`, or
 * a legacy clip backed by an image material. The preview overlay selection
 * uses this same rule, so an untagged image can never export without previewing.
 */
export function isStillImageItem(
  item: Pick<TimelineItem, 'originalMaterialType'>,
  material: Pick<MaterialItem, 'type'> | undefined,
): boolean {
  return item.originalMaterialType === 'image' || material?.type === 'image';
}

function spanKindFor(
  track: RenderableTrack,
  item: RenderableItem,
  materialsById: ReadonlyMap<string, Pick<MaterialItem, 'id' | 'type'>>,
): RenderSpanKind | null {
  if (track.type === 'subtitle') {
    return typeof item.text === 'string' && item.text.trim() !== '' ? 'subtitle' : null;
  }
  const material = item.materialId ? materialsById.get(item.materialId) : undefined;
  // A missing material is reported by the export pre-check, not rendered.
  if (!material) return null;
  if (track.type === 'audio') return 'audio';
  if (isStillImageItem(item, material)) return 'image';
  return material.type === 'video' ? 'video' : null;
}

export function collectRenderSpans(
  tracks: readonly RenderableTrack[],
  materialsById: ReadonlyMap<string, Pick<MaterialItem, 'id' | 'type'>>,
): RenderSpan[] {
  const spans: RenderSpan[] = [];
  for (const track of tracks) {
    if (!isTrackRendered(track)) continue;
    for (const item of track.items) {
      if (!hasValidTiming(item)) continue;
      const kind = spanKindFor(track, item, materialsById);
      if (!kind) continue;
      spans.push({
        itemId: item.id,
        trackId: track.id,
        kind,
        start: item.startTime,
        end: item.startTime + item.duration,
      });
    }
  }
  return spans;
}

/** Latest end of any rendered span; 0 when nothing renders. */
export function computeRenderEnd(spans: readonly RenderSpan[]): number {
  return spans.reduce((latest, span) => Math.max(latest, span.end), 0);
}

function isVisualSpan(span: RenderSpan): boolean {
  return span.kind === 'video' || span.kind === 'image';
}

/** Whether any picture (video or image) renders. */
export function hasVisualSpan(spans: readonly RenderSpan[]): boolean {
  return spans.some(isVisualSpan);
}

/** Latest end of a video / image span; 0 without pictures. Used for the black-tail notice. */
export function computeVisualEnd(spans: readonly RenderSpan[]): number {
  return spans.filter(isVisualSpan).reduce((latest, span) => Math.max(latest, span.end), 0);
}

/** Convenience for callers holding a material array. */
export function indexMaterialsById<T extends Pick<MaterialItem, 'id' | 'type'>>(
  materials: readonly T[],
): Map<string, T> {
  return new Map(materials.map((material) => [material.id, material]));
}
