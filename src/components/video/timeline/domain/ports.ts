/**
 * Domain Ports — Interface Definitions
 *
 * These interfaces define the contracts that infrastructure adapters must
 * implement. They follow the Ports & Adapters (Hexagonal) pattern to keep
 * the domain layer free of infrastructure concerns.
 *
 * The Store layer consumes these interfaces via dependency injection or
 * module-level imports. Tests can substitute mock implementations.
 */

import type { TimelineData, TrackData, MaterialData } from './types';

// ---------------------------------------------------------------------------
// Cache state (shared across ports)
// ---------------------------------------------------------------------------

export type CacheState = 'loading' | 'loaded' | 'error' | 'not-found';

// ---------------------------------------------------------------------------
// Export metadata
// ---------------------------------------------------------------------------

export interface ExportMetadata {
  /** ISO date string of when the export was created. */
  exportedAt: string;
  /** Export format version (for migration support). */
  version: string;
  /** The task ID associated with this export. */
  taskId: string;
}

// ---------------------------------------------------------------------------
// ITimelineRepository — JSON export/import persistence
// ---------------------------------------------------------------------------

export interface ITimelineRepository {
  /**
   * Export the timeline state and materials to a JSON blob.
   * @returns An object containing the Blob and a suggested filename.
   */
  exportToJSON(
    data: TimelineData,
    materials: MaterialData[],
    metadata: ExportMetadata
  ): Promise<{ blob: Blob; filename: string }>;

  /**
   * Import timeline state and materials from a JSON file.
   * @throws TimelineImportError if the file is invalid.
   */
  importFromJSON(
    file: File
  ): Promise<{ timelineData: TimelineData; materials: MaterialData[] }>;

  /**
   * Type-guard that validates a parsed JSON object matches the expected
   * TimelineExportData structure.
   */
  validateExportData(data: unknown): boolean;
}

// ---------------------------------------------------------------------------
// IVideoCachePort — Video preloading and cache management
// ---------------------------------------------------------------------------

export interface IVideoCachePort {
  /**
   * Preload a video by material ID and URL.
   * If already cached, returns the current cache state immediately.
   */
  preloadVideo(materialId: string, url: string): Promise<CacheState>;

  /**
   * Query the current cache state for a given material.
   */
  getCacheState(materialId: string): CacheState;

  /**
   * Retrieve the preloaded HTMLVideoElement for a material.
   * Returns null if not cached or not yet loaded.
   */
  getVideoElement(materialId: string): HTMLVideoElement | null;

  /**
   * Evict a single material from the cache.
   */
  evict(materialId: string): void;

  /**
   * Clear the entire cache.
   */
  clearAll(): void;
}

// ---------------------------------------------------------------------------
// IRemoteMaterialPrefetchPort — Remote material pre-download orchestration
// ---------------------------------------------------------------------------

/**
 * Identifier triple for a cached_materials row. `source` is e.g. `pexels`,
 * `unsplash`, `ark`, or `url`; `source_id` is the per-source stable id (e.g.
 * Pexels video id, ARK video id, or a sha1 fingerprint of the URL).
 */
export interface RemoteMaterialKey {
  source: string;
  source_id: string;
  url: string;
}

/** Backend `cached_materials.status` projection plus client-only hints. */
export type RemoteMaterialCacheStatus =
  | 'pending'
  | 'downloading'
  | 'ready'
  | 'failed'
  | 'missing';

/**
 * Wire shape returned by `/api/material/ingest` and `/api/material/lookup`.
 * Mirrors the FastAPI `MaterialIngestResultEntry` model (see backend
 * `app/routers/material_router.py`).
 */
export interface RemoteMaterialResult {
  source: string;
  source_id: string;
  material_id: string;
  status: RemoteMaterialCacheStatus | string;
  local_path?: string | null;
  /** Same-origin URL the browser can play directly. */
  local_url?: string | null;
  error_message?: string | null;
  // Preview-proxy mirror fields, serialised by `material_router.py`
  // (`_proxy_fields_from_row`). Hydrating these on ingest/lookup lets a page
  // refresh restore `previewProxyStatus`/`previewProxyLocalUrl` directly
  // instead of waiting for an idempotent re-POST (spec C4 / R6).
  preview_proxy_status?: string | null;
  preview_proxy_profile?: string | null;
  preview_proxy_local_url?: string | null;
  preview_proxy_progress?: number | null;
}

/** Progress callback contract — invoked between transitions. */
export type RemoteMaterialProgressCallback = (
  result: RemoteMaterialResult,
) => void;

export interface IRemoteMaterialPrefetchPort {
  /**
   * POST a batch to `/api/material/ingest`. Returns one entry per item in
   * order, including `local_url` when the row is already `ready`.
   */
  ingest(items: RemoteMaterialKey[]): Promise<RemoteMaterialResult[]>;

  /**
   * Poll `/api/material/lookup` (preferring `(source, source_id)`, falling
   * back to the URL) until the row is `ready` or `failed`, then resolve.
   *
   * MUST short-circuit when the prior `ingest` call already returned
   * `status='ready' && local_url`, to avoid a wasted round-trip.
   *
   * @param signal AbortController signal; rejects with AbortError when fired.
   * @param onProgress Optional patch callback; fires on each transition.
   */
  pollUntilReady(
    key: RemoteMaterialKey,
    options?: {
      signal?: AbortSignal;
      onProgress?: RemoteMaterialProgressCallback;
    },
  ): Promise<RemoteMaterialResult>;
}

// ---------------------------------------------------------------------------
// Video/Audio Sequence Item shapes (used by ICompositionPort)
// ---------------------------------------------------------------------------

export interface VideoSequenceItem {
  id: string;
  name: string;
  /**
   * Backend media reference for this sequence. In desktop local mode this is
   * usually a same-origin storage/cache URL that the backend resolver maps to
   * a validated local file. Legacy remote materials still fall back to
   * `serverUrl || url`.
   */
  url: string;
  /**
   * Optional same-origin URL pointing at the locally pre-cached file
   * (`/api/storage/files/cached_materials/...`). Populated when the material
   * has been ingested via `useRemoteMaterialPrefetch`.
   */
  cacheUrl?: string;
  sourceRef?: string;
  startTime: number;
  duration: number;
  thumbnailUrl?: string;
  materialId?: string;
  trackId: string;
  clipStart?: number;
  clipEnd?: number;
  originalDuration?: number;
  volume?: number;
  cacheState?: CacheState;
  /**
   * When true, this video sequence's embedded audio has been detached to an
   * independent audio sequence. Preview (02) and export (05) MUST suppress
   * this video sequence's audio so the derived audio sequence is the sole
   * contributor (avoids double-audio). See spec 01 §2.4.
   */
  audioDetached?: boolean;
}

export interface AudioSequenceItem {
  id: string;
  name: string;
  url: string;
  startTime: number;
  duration: number;
  materialId?: string;
  trackId: string;
  volume?: number;
  clipStart?: number;
  clipEnd?: number;
  originalDuration?: number;
}

/**
 * Subtitle sequence item for the compositor subtitle layer (spec 02 §5).
 * Times are seconds on the composition timeline. `style` is the timeline's
 * `SubtitleStyle` (font family / color / position) which the SubtitleLayer
 * resolves to draw-oriented defaults. Structurally compatible with the
 * `SubtitleSequenceItem` re-declared in `types/videoEditingTypes.ts`.
 */
export interface SubtitleSequenceItem {
  id: string;
  text: string;
  startTime: number;
  duration: number;
  trackId: string;
  style?: import('@/types').SubtitleStyle;
}

// ---------------------------------------------------------------------------
// ICompositionPort — Timeline to composition sequence conversion
// ---------------------------------------------------------------------------

export interface ICompositionPort {
  /**
   * Extract video sequences from tracks and materials.
   * Filters for visible, unlocked video tracks with video-type items.
   * URL selection: prefer local backend reference, fallback serverUrl/url.
   * Volume: item.volume * track.volume / 100, clamped to [0, 2].
   */
  extractVideoSequences(
    tracks: TrackData[],
    materials: MaterialData[]
  ): VideoSequenceItem[];

  /**
   * Extract audio sequences from tracks and materials.
   * Filters for visible, unlocked, unmuted audio tracks.
   * URL selection: prefer local backend reference, fallback serverUrl/url.
   * Volume: item.volume * track.volume / 100, clamped to [0, 2].
   */
  extractAudioSequences(
    tracks: TrackData[],
    materials: MaterialData[]
  ): AudioSequenceItem[];

  /**
   * Extract subtitle sequences from tracks (spec 02 §2.3 / §5).
   * Filters for visible subtitle tracks with non-empty subtitle items.
   * Materials are NOT required — subtitle text/style live on the item.
   */
  extractSubtitleSequences(tracks: TrackData[]): SubtitleSequenceItem[];

  /**
   * Build a composition request from extracted sequences.
   * Used to submit a video composition job to the backend.
   */
  buildCompositionRequest(
    videoSequences: VideoSequenceItem[],
    audioSequences: AudioSequenceItem[],
    config: CompositionConfig
  ): VideoCompositionRequest;
}

// ---------------------------------------------------------------------------
// Composition config and request types
// ---------------------------------------------------------------------------

export interface CompositionConfig {
  /** Output video width in pixels. */
  width?: number;
  /** Output video height in pixels. */
  height?: number;
  /** Output format (e.g., 'mp4'). */
  format?: string;
  /** Task ID for tracking. */
  taskId?: string;
  /** Total timeline duration in seconds. */
  totalDuration?: number;
}

export interface VideoCompositionRequest {
  video_sequences: Array<{
    id: string;
    name: string;
    url: string;
    start_time: number;
    duration: number;
    clip_start?: number;
    clip_end?: number;
    original_duration?: number;
    volume: number;
    /** Suppress this video's audio in export (its audio was detached). */
    audio_detached?: boolean;
  }>;
  audio_sequences: Array<{
    id: string;
    name: string;
    url: string;
    start_time: number;
    duration: number;
    clip_start?: number;
    clip_end?: number;
    volume: number;
  }>;
  output_config: {
    width: number;
    height: number;
    format: string;
  };
  task_id?: string;
  total_duration?: number;
}
