/**
 * projectHydration — load-side project rehydration (spec 06 §2.1).
 *
 * After a project's JSON is imported (tracks + items carrying only a
 * `materialId`, never a live URL), the editor must reconnect every item to its
 * LIVE `MaterialItem` so the preview pipeline (spec 02) can play it. This
 * module owns that reconnection with three responsibilities:
 *
 *   1. Resolve each video/audio item's preview URL by `materialId` against the
 *      live material list — the SINGLE AUTHORITY is spec 02
 *      `resolveSequencePlaybackUrl` (RC-B). A snapshot `url`/`serverUrl` on the
 *      item or material is only a fallback and MUST NOT override a live
 *      direct-local URL (doing so reintroduces the black-screen symptom).
 *
 *   2. Regularize INV-3 violations once, conservatively (recompute `duration`
 *      from `clipEnd - clipStart`, never touch `startTime`). The Repository
 *      already does this on import; this is an idempotent second guard for
 *      callers that hydrate a TimelineData built some other way.
 *
 *   3. Report which derived resources (poster/filmstrip, waveform peaks) are
 *      missing for each material so the caller can trigger on-demand
 *      regeneration (spec 03/04 caches re-resolve by materialId).
 *
 * Pure functions — no DOM, no network. Safe to call from a load effect or a
 * `useMemo`. The actual derived-resource regeneration (filmstrip/waveform
 * cache `ensure`) is the caller's job; this module only tells it WHAT to do.
 */

import type { MaterialItem } from '@/types';
import type { TimelineData, TimelineItemData } from '../timeline/domain/types';
import {
  resolveSequencePlaybackUrl,
  type ResolvedPlaybackUrl,
} from './resolveSequencePlaybackUrl';
import { canPreviewDirectLocalMaterial } from './localMaterial';

/** Tolerance for INV-3, matching the domain `TIME_EPSILON` (spec 01 §2.2). */
const INV3_EPSILON = 0.001;

/** A material's derived-resource readiness, computed by `materialId`. */
export interface DerivedResourceStatus {
  materialId: string;
  /** Whether a poster/filmstrip thumbnail snapshot is already present. */
  hasThumbnail: boolean;
  /** Whether inline waveform peaks are present (legacy first-paint fallback). */
  hasInlineWaveform: boolean;
  /** Material type, used to decide which derived resources to regenerate. */
  type: 'video' | 'audio' | 'subtitle' | 'image';
}

/** Per-item hydration outcome. */
export interface HydratedItem {
  itemId: string;
  materialId?: string;
  /**
   * The authoritative preview URL resolved from the LIVE material by
   * `materialId`. `null` when the material is missing or has no usable URL.
   */
  preview: ResolvedPlaybackUrl | null;
  /** True when the live material is a directly-previewable same-origin local file. */
  isDirectLocal: boolean;
  /** True when `duration` was corrected to satisfy INV-3 during hydration. */
  regularized: boolean;
}

/** Aggregate hydration result for a whole project. */
export interface ProjectHydrationResult {
  /** The timeline with INV-3 violations regularized. */
  timelineData: TimelineData;
  /** Per-(video/audio) item hydration outcomes. */
  items: HydratedItem[];
  /** Material ids whose derived thumbnail/waveform must be (re)generated. */
  derivedToRegenerate: DerivedResourceStatus[];
  /** Count of items whose `duration` was corrected on load (diagnostics). */
  regularizedCount: number;
}

/**
 * Resolve the authoritative preview URL for a timeline item by `materialId`.
 *
 * The resolver reads the LIVE material list (spec 02 RC-B): the item carries
 * only `materialId`, so we feed `{ materialId, url, cacheUrl }` to
 * `resolveSequencePlaybackUrl`, where the snapshot `url` is a LAST-RESORT
 * fallback that the resolver itself demotes below any live direct-local URL.
 *
 * @param item Imported timeline item (post-Repository).
 * @param liveMaterials The current live material list (authority).
 * @returns The resolved playback URL, or `null` when unresolvable.
 */
export function resolveItemPreviewUrl(
  item: Pick<TimelineItemData, 'materialId' | 'url' | 'cacheUrl'>,
  liveMaterials: MaterialItem[] | null | undefined,
): ResolvedPlaybackUrl | null {
  return resolveSequencePlaybackUrl(
    {
      materialId: item.materialId,
      // Snapshot url/cacheUrl are fallbacks only — the resolver prefers the
      // live material's direct-local URL and never lets these override it.
      url: item.url,
      cacheUrl: item.cacheUrl ?? null,
    },
    liveMaterials,
  );
}

/**
 * Regularize a single item's INV-3 violation (idempotent, conservative).
 *
 * @param item The item to validate.
 * @returns `{ item, regularized }`; `item` is unchanged when already valid.
 */
function regularizeItem(
  item: TimelineItemData,
): { item: TimelineItemData; regularized: boolean } {
  const { clipStart, clipEnd } = item;
  if (typeof clipStart !== 'number' || typeof clipEnd !== 'number') {
    return { item, regularized: false };
  }
  const clipSpan = clipEnd - clipStart;
  if (!(clipSpan > 0)) return { item, regularized: false };
  if (Math.abs((item.duration ?? 0) - clipSpan) <= INV3_EPSILON) {
    return { item, regularized: false };
  }
  return { item: { ...item, duration: clipSpan }, regularized: true };
}

/** Whether an item's material has any present thumbnail snapshot. */
function itemHasThumbnail(
  item: TimelineItemData,
  material: MaterialItem | undefined,
): boolean {
  return Boolean(item.thumbnailUrl || material?.thumbnailUrl);
}

/**
 * Compute the derived-resource regeneration list for hydrated materials.
 *
 * A video item needs a filmstrip/poster when no thumbnail snapshot is present;
 * a video/audio item needs waveform peaks when no inline peaks are present
 * (they re-resolve by materialId via spec 04). Image/subtitle items contribute
 * nothing. Deduplicated by `materialId`.
 *
 * @param timelineData The (hydrated) timeline.
 * @param liveMaterials The live material list.
 * @returns Distinct derived-resource statuses needing regeneration.
 */
export function listDerivedToRegenerate(
  timelineData: TimelineData,
  liveMaterials: MaterialItem[] | null | undefined,
): DerivedResourceStatus[] {
  const list = Array.isArray(liveMaterials) ? liveMaterials : [];
  const byId = new Map<string, MaterialItem>(list.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const out: DerivedResourceStatus[] = [];

  for (const track of timelineData.tracks) {
    for (const item of track.items) {
      const materialId = item.materialId;
      if (!materialId || seen.has(materialId)) continue;
      if (item.type !== 'video' && item.type !== 'audio') continue;

      const material = byId.get(materialId);
      const hasThumbnail = itemHasThumbnail(item, material);
      const hasInlineWaveform =
        Array.isArray(item.waveformData) && item.waveformData.length > 0;

      // Needs regeneration when a required derived resource is absent:
      //  - video: missing thumbnail OR missing waveform
      //  - audio: missing waveform
      const needsThumbnail = item.type === 'video' && !hasThumbnail;
      const needsWaveform = !hasInlineWaveform;
      if (!needsThumbnail && !needsWaveform) {
        seen.add(materialId);
        continue;
      }

      seen.add(materialId);
      out.push({
        materialId,
        hasThumbnail,
        hasInlineWaveform,
        type: item.type,
      });
    }
  }
  return out;
}

/**
 * Hydrate a freshly-imported project against the live material list.
 *
 * Reconnects every video/audio item to its live `MaterialItem` (authoritative
 * preview URL via spec 02 resolver), regularizes any INV-3 violations once,
 * and computes the derived-resource regeneration list. On load the timeline is
 * paused, selection cleared and history reset — those are the caller's store
 * responsibilities; this function returns `isPlaying: false` so a caller that
 * spreads the result cannot accidentally resume playback.
 *
 * @param timelineData The imported timeline (items carry `materialId` only).
 * @param liveMaterials The current live material list (single URL authority).
 * @returns The hydration result (regularized timeline + per-item outcomes +
 *   derived-resource regeneration list).
 */
export function hydrateProject(
  timelineData: TimelineData,
  liveMaterials: MaterialItem[] | null | undefined,
): ProjectHydrationResult {
  const list = Array.isArray(liveMaterials) ? liveMaterials : [];
  const byId = new Map<string, MaterialItem>(list.map((m) => [m.id, m]));

  const items: HydratedItem[] = [];
  let regularizedCount = 0;

  const tracks = timelineData.tracks.map((track) => ({
    ...track,
    items: track.items.map((rawItem) => {
      const { item, regularized } = regularizeItem(rawItem);
      if (regularized) regularizedCount += 1;

      if (item.type === 'video' || item.type === 'audio') {
        const material = item.materialId ? byId.get(item.materialId) : undefined;
        const preview = resolveItemPreviewUrl(item, list);
        items.push({
          itemId: item.id,
          materialId: item.materialId,
          preview,
          isDirectLocal: material
            ? canPreviewDirectLocalMaterial(material)
            : false,
          regularized,
        });
      }
      return item;
    }),
  }));

  const hydratedTimeline: TimelineData = {
    ...timelineData,
    tracks,
    // Always start paused on load (spec 06 §2.1). Selection/history reset are
    // the caller's store concern.
    isPlaying: false,
  };

  return {
    timelineData: hydratedTimeline,
    items,
    derivedToRegenerate: listDerivedToRegenerate(hydratedTimeline, list),
    regularizedCount,
  };
}
