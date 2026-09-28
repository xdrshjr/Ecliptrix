/**
 * videoExportItems — pure builders for the export composition request.
 *
 * Every item that goes into the request, and the pre-export plan, is decided
 * here from the same render rule the preview uses (S5 `renderableTimeline`):
 * hidden tracks and muted audio tracks are skipped, locked tracks export, the
 * timeline ends at the latest rendered item — not at the sum of clip lengths.
 *
 * Pure: no React, no notifications, no network.
 */

import type { MaterialItem, SubtitleStyle, TimelineItem, Track } from '@/types';
import type { RequiredCover } from '@/lib/api/videoComposition';
import type { CoverAspectRatio, CoverMode } from '@/types/videoCover';
import { isCanonicalCover, isCoverClip } from '../cover/coverTimeline';
import { coverSize } from '../cover/layout';
import type {
  AudioCompositionItem,
  ImageCompositionItem,
  SubtitleCompositionItem,
  VideoCompositionItem,
} from '@/lib/api/videoComposition';
import { selectAudioPlaybackUrl } from '@/lib/utils/audioUrl';
import { DEFAULT_IMAGE_POSITION } from '../components/VideoPlayerPanel/imageOverlayGeometry';
import { materialCompositeKey } from '../lib/materialKey';
import { selectPlaybackUrl, stripLocalOrigin } from '../lib/selectPlaybackUrl';
import { toCameraMotionWire } from '../playback/camera/wire';
import { clampImageZIndex, effectiveImageOpacity } from '../playback/ImageOverlayLayer';
import { computeEffectiveVolume } from '../timeline/infrastructure/effectiveVolume';
import {
  collectRenderSpans,
  computeRenderEnd,
  computeVisualEnd,
  hasVisualSpan,
  isTrackRendered,
  type RenderSpanKind,
} from '../timeline/infrastructure/renderableTimeline';

/** A black tail shorter than this is frame noise, not worth a notice. */
export const BLACK_TAIL_NOTICE_SECONDS = 0.5;

export type CoverExportCheck =
  | { status: 'none' }
  | { status: 'error'; code: string; itemId?: string }
  | { status: 'hidden'; digest: string; item: TimelineItem }
  | { status: 'ready'; requiredCover: RequiredCover; item: TimelineItem; mode?: CoverMode };

/** Mandatory gate, independent of advisory dismissal and of render-span filtering. */
export function validateCoverExport(options: {
  tracks: readonly Track[];
  materialsById: ReadonlyMap<string, MaterialItem>;
  projectId?: string;
  aspectRatio?: string;
}): CoverExportCheck {
  const { tracks, materialsById, projectId, aspectRatio = '16:9' } = options;
  const covers = tracks.flatMap(track => track.items.filter(isCoverClip)
    .map(item => ({ track, item })));
  if (!covers.length) return { status: 'none' };
  const fail = (code: string): CoverExportCheck => ({ status: 'error', code, itemId: covers[0].item.id });
  if (covers.length !== 1) return fail('COVER_TIMELINE_CONFLICT');
  const { track, item } = covers[0];
  const reference = item.metadata?.cover;
  const material = item.materialId ? materialsById.get(item.materialId) : undefined;
  if (!reference || reference.schemaVersion !== 2 || reference.projectId !== projectId
    || !reference.revisionId || !reference.assetId || !reference.sha256 || !material
    || material.type !== 'image' || material.metadata?.cover?.revisionId !== reference.revisionId
    || material.metadata?.cover?.projectId !== projectId
    || material.metadata?.cover?.sha256 !== reference.sha256
    || material.metadata?.cover?.assetId !== reference.assetId
    || typeof material.url !== 'string'
    || !material.url.startsWith('/api/storage/files/')) return fail('COVER_ASSET_MISSING');
  if (!isCanonicalCover(item) || !track.id.startsWith('image-track')) return fail('COVER_TIMELINE_CONFLICT');
  // Product aspect labels map to fixed output sizes: 21:9 is 2560×1080,
  // rather than the mathematical 2520×1080 ratio.
  const outputSize = coverSize(aspectRatio as CoverAspectRatio);
  if (!outputSize || material.width !== outputSize.width
    || material.height !== outputSize.height) {
    return fail('COVER_ASPECT_MISMATCH');
  }
  if (track.isVisible === false) return { status: 'hidden', item,
    digest: JSON.stringify([projectId, tracks, aspectRatio, Array.from(materialsById)]) };
  const intrusion = collectRenderSpans(tracks, materialsById).some(span =>
    span.itemId !== item.id && span.start < item.duration - 1e-6);
  if (intrusion) return fail('COVER_TIMELINE_CONFLICT');
  const mode = material.metadata?.coverMode;
  return { status: 'ready', item,
    mode: mode === 'html' || mode === 'ai' || mode === 'mixed' ? mode : undefined,
    requiredCover: {
    project_id: projectId!, revision_id: reference.revisionId,
    image_item_id: item.id, sha256: reference.sha256,
  } };
}

/**
 * Subtitle style when an item has none. No background: the preview draws no
 * box for such a caption, so the export must not add one (EXO-10).
 */
const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'default',
  fontSize: 24,
  fontColor: '#FFFFFF',
  position: 'bottom',
};

export interface ExportCompositionItems {
  videoItems: VideoCompositionItem[];
  audioItems: AudioCompositionItem[];
  subtitleItems: SubtitleCompositionItem[];
  imageItems: ImageCompositionItem[];
}

export interface MissingMaterialClip {
  itemId: string;
  name: string;
}

export type VideoExportPlan =
  | { status: 'missing-materials'; clips: MissingMaterialClip[] }
  | { status: 'nothing-visible' }
  | { status: 'ready'; renderEnd: number; blackTailSeconds: number };

/**
 * Burn-in entry for one subtitle item, or null when its text is blank — a
 * blank caption used to be exported under its item name ("Subtitle 1").
 */
export function toSubtitleCompositionItem(
  item: TimelineItem,
  track: Pick<Track, 'id'>,
): SubtitleCompositionItem | null {
  if (typeof item.text !== 'string' || item.text.trim() === '') return null;
  const style = item.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;
  return {
    id: item.id,
    name: item.name,
    text: item.text,
    start_time: item.startTime,
    duration: item.duration,
    track_id: track.id,
    font_family: style.fontFamily,
    font_size: style.fontSize,
    font_color: style.fontColor,
    background_color: style.backgroundColor || undefined,
    position: style.position,
  };
}

/** Overlay entry for a still, with the opacity and stacking the preview draws. */
export function toImageCompositionItem(
  item: TimelineItem,
  track: Pick<Track, 'id'>,
  material: MaterialItem,
): ImageCompositionItem {
  const position = item.imagePosition ?? DEFAULT_IMAGE_POSITION;
  // Absent camera motion omits the key entirely so the backend path is unchanged.
  const cameraWire = toCameraMotionWire(item.cameraMotion);
  return {
    id: item.id,
    name: item.name,
    // Desktop export sends the backend-resolvable same-origin reference, kept
    // relative so an absolute loopback URL cannot trip the SSRF guard.
    url: stripLocalOrigin(selectPlaybackUrl(material, { purpose: 'export' })),
    start_time: item.startTime,
    duration: item.duration,
    track_id: track.id,
    position: { ...position, zIndex: clampImageZIndex(position.zIndex) },
    // `opacity || 1` turned a deliberate 0 into fully opaque (EXO-02).
    opacity: effectiveImageOpacity(item.opacity),
    fade_in_duration: 0,
    fade_out_duration: 0,
    ...(cameraWire ? { camera_motion: cameraWire } : {}),
  };
}

function toVideoCompositionItem(
  item: TimelineItem,
  track: Track,
  material: MaterialItem,
): VideoCompositionItem {
  const clipStart = item.clipStart || 0;
  const clipEnd = item.clipEnd || (item.originalDuration || item.duration);
  // Same composite key the background prefetch ingested under, so the backend
  // reuses the cached file; cache_url is only a disk hint, never downloaded.
  const { source, source_id: sourceId } = materialCompositeKey(material);
  return {
    id: item.id,
    name: item.name,
    url: stripLocalOrigin(selectPlaybackUrl(material, { purpose: 'export' })),
    // The real timeline start: gaps and stills before a clip render as such (EXV-09).
    start_time: item.startTime,
    duration: item.duration,
    track_id: track.id,
    volume: computeEffectiveVolume(item.volume, track.volume),
    opacity: item.opacity ?? 1,
    clip_start: clipStart,
    clip_end: clipEnd,
    clipped_duration: clipEnd - clipStart,
    // Same z rule as the preview compositor's track groups.
    track_z: track.order,
    transition_in: item.transitionIn,
    transition_out: item.transitionOut,
    audio_detached: item.audioDetached,
    camera_motion: toCameraMotionWire(item.cameraMotion),
    source,
    source_id: sourceId,
    cache_url: material.cacheUrl || undefined,
  };
}

function toAudioCompositionItem(
  item: TimelineItem,
  track: Track,
  material: MaterialItem,
): AudioCompositionItem {
  // Never send a blob: URL; stripLocalOrigin keeps loopback references relative.
  const resolved = selectAudioPlaybackUrl(material);
  const url = resolved && !resolved.startsWith('blob:') ? resolved : (material.serverUrl || '');
  return {
    id: item.id,
    name: item.name,
    url: stripLocalOrigin(url),
    start_time: item.startTime,
    duration: item.duration,
    track_id: track.id,
    volume: computeEffectiveVolume(item.volume, track.volume),
    clip_start: item.clipStart || 0,
    clip_end: item.clipEnd || (item.originalDuration || item.duration),
  };
}

function appendExportItem(
  result: ExportCompositionItems,
  kind: RenderSpanKind,
  item: TimelineItem,
  track: Track,
  materialsById: ReadonlyMap<string, MaterialItem>,
): void {
  if (kind === 'subtitle') {
    const subtitle = toSubtitleCompositionItem(item, track);
    if (subtitle) result.subtitleItems.push(subtitle);
    return;
  }
  // Media spans only exist for items whose material is in the library.
  const material = item.materialId ? materialsById.get(item.materialId) : undefined;
  if (!material) return;
  if (kind === 'audio') {
    result.audioItems.push(toAudioCompositionItem(item, track, material));
  } else if (kind === 'image') {
    result.imageItems.push(toImageCompositionItem(item, track, material));
  } else {
    result.videoItems.push(toVideoCompositionItem(item, track, material));
  }
}

const byStartTime = (a: { start_time: number }, b: { start_time: number }) =>
  a.start_time - b.start_time;

// A JSON pair cannot collide for any ids and holds no control characters (EX3-07).
const renderKey = (trackId: string, itemId: string) => JSON.stringify([trackId, itemId]);

/**
 * Every request item, taken from the render spans the preview plays. An item
 * the preview skips — invalid timing, a non-video material on a video track —
 * is not sent either: the backend would render what the preview never showed,
 * or refuse the whole request over one out-of-range start.
 */
export function buildExportCompositionItems(
  tracks: readonly Track[],
  materialsById: ReadonlyMap<string, MaterialItem>,
): ExportCompositionItems {
  const renderedKinds = new Map(
    collectRenderSpans(tracks, materialsById).map(
      (span) => [renderKey(span.trackId, span.itemId), span.kind] as const,
    ),
  );
  const result: ExportCompositionItems = {
    videoItems: [],
    audioItems: [],
    subtitleItems: [],
    imageItems: [],
  };
  for (const track of tracks) {
    for (const item of track.items) {
      const kind = renderedKinds.get(renderKey(track.id, item.id));
      if (kind) appendExportItem(result, kind, item, track, materialsById);
    }
  }
  result.videoItems.sort(byStartTime);
  result.audioItems.sort(byStartTime);
  result.subtitleItems.sort(byStartTime);
  // Images keep track order: equal zIndex stacks by request order in export,
  // exactly as the preview stacks by input order.
  return result;
}

/**
 * Whether a clip lost its material: no material id, or one the library no
 * longer has. Subtitles have no material. Shared by the export plan and the
 * timeline's missing-material badge (N-01) so both agree on one rule.
 */
export function isClipMaterialMissing(
  item: Pick<TimelineItem, 'type' | 'materialId'>,
  materialsById: ReadonlyMap<string, MaterialItem>,
): boolean {
  if (item.type === 'subtitle') return false;
  return !item.materialId || !materialsById.has(item.materialId);
}

/** Rendered clips whose material is no longer in the library (ME-02). */
export function findClipsWithMissingMaterial(
  tracks: readonly Track[],
  materialsById: ReadonlyMap<string, MaterialItem>,
): MissingMaterialClip[] {
  const missing: MissingMaterialClip[] = [];
  for (const track of tracks) {
    if (!isTrackRendered(track) || track.type === 'subtitle') continue;
    for (const item of track.items) {
      if (!isClipMaterialMissing(item, materialsById)) continue;
      missing.push({ itemId: item.id, name: item.name || item.id });
    }
  }
  return missing;
}

/**
 * Decide whether the timeline can be exported. Missing materials are checked
 * first: a clip whose material was deleted also has no picture, and "remove
 * these clips" is the actionable message, not "nothing to export".
 */
export function planVideoExport(
  tracks: readonly Track[],
  materialsById: ReadonlyMap<string, MaterialItem>,
): VideoExportPlan {
  const missing = findClipsWithMissingMaterial(tracks, materialsById);
  if (missing.length > 0) return { status: 'missing-materials', clips: missing };
  const spans = collectRenderSpans(tracks, materialsById);
  if (!hasVisualSpan(spans)) return { status: 'nothing-visible' };
  const renderEnd = computeRenderEnd(spans);
  return {
    status: 'ready',
    renderEnd,
    blackTailSeconds: Math.max(0, renderEnd - computeVisualEnd(spans)),
  };
}
