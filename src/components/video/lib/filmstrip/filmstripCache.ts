/**
 * filmstripCache — zoom-aware filmstrip frame computation, URL caching and
 * extract/persist orchestration (local-video-editing-refactor spec 03 §2.3).
 *
 * Responsibilities
 *   1. Compute the source-time set of frames a clip needs at a given zoom,
 *      using ``ZoomLevel.toPixelsPerSecond()`` and the slot-width density
 *      formula (N = clamp(round(W / slot), 1, max)).
 *   2. Quantize the continuous zoom value into a finite set of tiers so frames
 *      are reused across nearby zoom levels rather than re-cut on every step.
 *   3. Hold an in-memory URL cache keyed by ``(materialId, zoomTier, tMs)``.
 *   4. Orchestrate on-demand extraction (canvas) + persistence (backend) for
 *      the frames that are missing, degrading to leave a slot empty (the UI
 *      falls back to the poster) when a single frame fails.
 *
 * It is intentionally framework-agnostic (no React) so it can be unit-tested
 * and shared between the timeline item renderer and any pre-warm path. Direct
 * extraction always uses the clip's same-origin ``/api/storage/files`` URL —
 * never ``/api/video-proxy`` (spec §2.3 / §6.6).
 */

import { ZoomLevel } from '../../timeline/domain/value-objects/ZoomLevel';
import { extractVideoFrameBlobAt } from '../../utils/extractVideoThumbnail';
import { listMaterialThumbnails, persistThumbnailFrame } from '../api/thumbnailClient';

/** Minimal clip shape the cache needs (subset of TimelineItemData). */
export interface FilmstripItem {
  materialId?: string;
  /** Source-time clip in-point (seconds). Defaults to 0. */
  clipStart?: number;
  /** Source-time clip out-point (seconds). Defaults to clipStart+duration. */
  clipEnd?: number;
  /** Timeline duration of the clip (seconds). */
  duration: number;
  /** Same-origin playback URL used as the extraction source. */
  url?: string;
}

/** Density / capacity knobs (mirror the backend ThumbnailConfig defaults). */
export interface FilmstripDensityOptions {
  /** Pixel width allotted to one filmstrip slot. */
  slotPx: number;
  /** Hard cap on frames per clip regardless of zoom width. */
  maxFrames: number;
  /** JPEG quality (0..1) for extracted frames. */
  quality?: number;
}

/** One filmstrip slot: a source-time (ms) and its cached URL (or null). */
export interface FilmstripSlot {
  tMs: number;
  url: string | null;
}

const DEFAULT_OPTIONS: FilmstripDensityOptions = {
  slotPx: 80,
  maxFrames: 24,
  quality: 0.7,
};

// The finite zoom tiers continuous zoom values snap to. Reusing a tier across
// nearby zooms avoids re-cutting frames on every wheel step (spec §2.3).
//
// Labels are CONSTRAINED to [A-Za-z0-9]+ because they are interpolated into the
// backend frame filename ``strip_{tier}_{tMs}.jpg``, whose parser pins the tier
// group to that alphabet. Hence fractional tiers use a ``q`` (quarter/quotient)
// prefix instead of a dot: 0.25 → "q025", 0.5 → "q05".
const ZOOM_TIERS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.25, label: 'q025' },
  { value: 0.5, label: 'q05' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 4, label: '4x' },
];

/** Snap a continuous zoom value to the nearest fixed tier label. */
export function quantizeZoomTier(zoomValue: number): string {
  const z = Number.isFinite(zoomValue) ? zoomValue : 1;
  let best = ZOOM_TIERS[0];
  let bestDist = Math.abs(z - best.value);
  for (const tier of ZOOM_TIERS) {
    const dist = Math.abs(z - tier.value);
    if (dist < bestDist) {
      best = tier;
      bestDist = dist;
    }
  }
  return best.label;
}

function resolveClipBounds(item: FilmstripItem): { start: number; end: number } {
  const start = Math.max(0, item.clipStart ?? 0);
  const fallbackEnd = start + Math.max(0, item.duration ?? 0);
  const end = Math.max(start, item.clipEnd ?? fallbackEnd);
  return { start, end };
}

/**
 * Compute the source-time timestamps (seconds) of the frames a clip needs at
 * the given zoom. Frames are spread evenly across [clipStart, clipEnd]; a
 * single-frame clip samples the midpoint.
 *
 * @param item Clip to compute frames for
 * @param zoom Current timeline zoom level
 * @param opts Density knobs (slot width, max frames)
 * @returns Source-time seconds, ascending, length in [1, maxFrames]
 */
export function computeFrameTimestamps(
  item: FilmstripItem,
  zoom: ZoomLevel,
  opts: FilmstripDensityOptions,
): number[] {
  const { start, end } = resolveClipBounds(item);
  const span = Math.max(0, end - start);
  const pxPerSec = zoom.toPixelsPerSecond();
  const widthPx = span * pxPerSec;
  const slot = Math.max(1, opts.slotPx);
  const raw = Math.round(widthPx / slot);
  const n = Math.min(opts.maxFrames, Math.max(1, raw));

  if (n === 1 || span === 0) {
    return [start + span / 2];
  }
  // Sample at slot centers: t_i = start + (i + 0.5) * span / n. This keeps the
  // first/last frames inside the clip rather than pinned to the exact edges.
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(start + ((i + 0.5) * span) / n);
  }
  return out;
}

/** A frame cache key: materialId + tier + millisecond timestamp. */
function cacheKey(materialId: string, tier: string, tMs: number): string {
  return `${materialId}::${tier}::${tMs}`;
}

/**
 * In-memory filmstrip frame cache with extract/persist orchestration.
 *
 * One instance is shared per editor session; it stores resolved frame URLs so
 * repeated renders / scroll / re-zoom to the same tier are pure cache hits.
 */
export class FilmstripCache {
  private readonly opts: FilmstripDensityOptions;
  /** Resolved frame URLs keyed by (materialId, tier, tMs). */
  private readonly urls = new Map<string, string>();
  /** In-flight extraction promises so concurrent ensures don't double-cut. */
  private readonly inflight = new Map<string, Promise<void>>();
  /**
   * One pre-warm attempt per materialId per session, keyed by materialId. The
   * stored promise is reused (not re-issued) so repeated ensure()/prewarm()
   * calls for the same material list the backend at most once — the basis of
   * the reload "不重抽" guarantee (spec 03 §6).
   */
  private readonly prewarmed = new Map<string, Promise<void>>();

  constructor(opts?: Partial<FilmstripDensityOptions>) {
    this.opts = { ...DEFAULT_OPTIONS, ...(opts ?? {}) };
  }

  /**
   * Return the slot list for a clip at a zoom, populating ``url`` from the
   * cache where a frame has already been resolved (else ``null``).
   */
  framesFor(item: FilmstripItem, zoom: ZoomLevel): FilmstripSlot[] {
    const materialId = item.materialId ?? '';
    const tier = quantizeZoomTier(zoom.value);
    const ts = computeFrameTimestamps(item, zoom, this.opts);
    return ts.map((sec) => {
      const tMs = Math.round(sec * 1000);
      return { tMs, url: this.urls.get(cacheKey(materialId, tier, tMs)) ?? null };
    });
  }

  /** Seed a known frame URL (e.g. from a backend pre-warm listing). */
  seed(materialId: string, tier: string, tMs: number, url: string): void {
    this.urls.set(cacheKey(materialId, tier, tMs), url);
  }

  /**
   * Spec 06 §2.3 delete-联动 cache eviction. Drop every cached frame URL for a
   * material plus its one-shot pre-warm record so a deleted material leaves no
   * stale filmstrip keys behind and a later re-add re-lists from the backend.
   * Idempotent — a material with no cached frames is a safe no-op.
   *
   * @param materialId The material whose filmstrip cache entries to evict.
   */
  evict(materialId: string): void {
    if (!materialId) return;
    const prefix = `${materialId}::`;
    for (const key of Array.from(this.urls.keys())) {
      if (key.startsWith(prefix)) this.urls.delete(key);
    }
    for (const key of Array.from(this.inflight.keys())) {
      if (key.startsWith(prefix)) this.inflight.delete(key);
    }
    this.prewarmed.delete(materialId);
  }

  /**
   * Hydrate the in-memory cache from the material's already-persisted backend
   * frames so a project/material reload reuses them instead of re-extracting
   * (spec 03 §6 "重载项目后 filmstrip 仍在（持久化命中，不重抽)"). Runs at most
   * once per materialId per session; repeated calls await the first attempt.
   * Never throws — a failed listing leaves the cache empty so ensure() simply
   * extracts as before (silent degrade).
   *
   * @param materialId Material whose persisted frames to load
   * @param signal     Optional AbortSignal for the listing request
   */
  prewarm(materialId: string, signal?: AbortSignal): Promise<void> {
    if (!materialId) return Promise.resolve();
    const existing = this.prewarmed.get(materialId);
    if (existing) return existing;

    const task = this.loadPersistedFrames(materialId, signal);
    this.prewarmed.set(materialId, task);
    return task;
  }

  /** List the material's persisted frames and seed each into the cache. */
  private async loadPersistedFrames(materialId: string, signal?: AbortSignal): Promise<void> {
    try {
      const listing = await listMaterialThumbnails(materialId, signal);
      for (const frame of listing?.frames ?? []) {
        if (frame?.url) {
          this.seed(materialId, frame.zoom_tier, frame.t_ms, frame.url);
        }
      }
    } catch {
      // Listing failed (offline / not-yet-persisted) — degrade to extraction.
    }
  }

  /**
   * Extract + persist every missing frame for a clip at the given zoom and
   * cache the resolved URLs. Concurrent calls for the same (clip, tier)
   * coalesce. A single failed frame is left empty (UI degrades to poster);
   * it never throws.
   *
   * Before extracting, a one-shot pre-warm (per materialId per session) loads
   * any already-persisted frames from the backend so a reload reuses them
   * instead of re-decoding/re-POSTing (spec 03 §6 "不重抽").
   */
  async ensure(item: FilmstripItem, zoom: ZoomLevel): Promise<void> {
    const materialId = item.materialId;
    const src = item.url;
    if (!materialId || !src) return;

    const tier = quantizeZoomTier(zoom.value);
    const flightKey = `${materialId}::${tier}`;
    const existing = this.inflight.get(flightKey);
    if (existing) return existing;

    const task = this.prewarm(materialId)
      .then(() => this.extractMissing(item, materialId, src, tier, zoom))
      .finally(() => this.inflight.delete(flightKey));
    this.inflight.set(flightKey, task);
    return task;
  }

  /** Resolve each uncached slot via extract → persist → cache. */
  private async extractMissing(
    item: FilmstripItem,
    materialId: string,
    src: string,
    tier: string,
    zoom: ZoomLevel,
  ): Promise<void> {
    const ts = computeFrameTimestamps(item, zoom, this.opts);
    await Promise.all(
      ts.map((sec) => {
        const tMs = Math.round(sec * 1000);
        if (this.urls.has(cacheKey(materialId, tier, tMs))) return Promise.resolve();
        return this.extractOne(materialId, src, tier, sec, tMs);
      }),
    );
  }

  /** Drop every cached frame URL (e.g. full editor reset). */
  clear(): void {
    this.urls.clear();
    this.inflight.clear();
    this.prewarmed.clear();
  }

  /** Extract one frame, persist it, and cache its URL. Swallows per-frame
   *  failures so a bad seek never blocks the rest of the strip. */
  private async extractOne(
    materialId: string,
    src: string,
    tier: string,
    sec: number,
    tMs: number,
  ): Promise<void> {
    try {
      const blob = await extractVideoFrameBlobAt(src, sec, {
        maxWidth: this.opts.slotPx * 2,
        quality: this.opts.quality,
      });
      if (!blob) return; // degrade: leave slot null → UI uses poster
      const result = await persistThumbnailFrame(materialId, tier, tMs, blob);
      if (result?.success && result.url) {
        this.urls.set(cacheKey(materialId, tier, tMs), result.url);
      }
    } catch {
      // Network / decode failure for one frame — degrade silently.
    }
  }
}

/**
 * Shared filmstrip cache singleton (spec 03 §2.3 default density). The timeline
 * renderer and the spec-06 delete-联动 flow share ONE instance so an eviction
 * actually clears the keys the renderer reads. Mirrors the `waveformCache`
 * singleton pattern.
 */
export const filmstripCache = new FilmstripCache({
  slotPx: 80,
  maxFrames: 24,
  quality: 0.7,
});
