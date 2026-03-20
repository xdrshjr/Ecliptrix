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
// Video/Audio Sequence Item shapes (used by ICompositionPort)
// ---------------------------------------------------------------------------

export interface VideoSequenceItem {
  id: string;
  name: string;
  url: string;
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

// ---------------------------------------------------------------------------
// ICompositionPort — Timeline to composition sequence conversion
// ---------------------------------------------------------------------------

export interface ICompositionPort {
  /**
   * Extract video sequences from tracks and materials.
   * Filters for visible, unlocked video tracks with video-type items.
   * URL selection: prefer serverUrl, fallback url.
   * Volume: item.volume * track.volume / 100, clamped to [0, 2].
   */
  extractVideoSequences(
    tracks: TrackData[],
    materials: MaterialData[]
  ): VideoSequenceItem[];

  /**
   * Extract audio sequences from tracks and materials.
   * Filters for visible, unlocked, unmuted audio tracks.
   * URL selection: prefer serverUrl, fallback url.
   * Volume: item.volume * track.volume / 100, clamped to [0, 2].
   */
  extractAudioSequences(
    tracks: TrackData[],
    materials: MaterialData[]
  ): AudioSequenceItem[];

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
