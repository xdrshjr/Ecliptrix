/**
 * TimelineRepository — Infrastructure Adapter
 *
 * Responsible for timeline state persistence via JSON export/import.
 * Implements ITimelineRepository from the domain ports.
 *
 * Extracted from:
 * - src/components/video/services/timelineExportService.ts (prepareExportData, downloadJSONFile)
 * - src/components/video/hooks/useTimelineExport.ts (validation, error handling)
 * - src/components/video/timeline/TimelinePanel.tsx (import logic)
 *
 * The export format is backward-compatible with TimelineExportData from
 * the original timelineExportService.ts.
 */

import type { ITimelineRepository, ExportMetadata } from '../domain/ports';
import type { TimelineData, TrackData, TimelineItemData, MaterialData } from '../domain/types';
import { TimelineExportError, TimelineImportError } from './errors';

/**
 * Ensure legacy track names carry a numeric suffix. Older exports stored names
 * like "Video Track" without a number, which would display identically for
 * every track after import. If the name already ends in a digit, return as-is;
 * otherwise append the trailing number parsed from the id (e.g. "-3").
 */
function normalizeTrackName(name: string, id: string): string {
  // Empty/whitespace name: leave empty so Track.tsx:trackDisplayName can
  // derive a locale-aware label at render time. Padding with an id-suffix
  // here would render as " 1" (leading space) on the receiving side.
  if (!name || !name.trim()) return '';
  if (/\d+\s*$/.test(name)) return name;
  const match = id.match(/-(\d+)$/);
  if (!match) return name;
  return `${name} ${match[1]}`;
}

export type SerializedTrackKind = 'video' | 'image' | 'audio' | 'subtitle';

// image-tracks carry internal type='video' but id prefix 'image-track-';
// expose their external identity as 'image' in the serialized JSON so
// consumers (and round-tripping) see the correct semantic kind.
export function getSerializedTrackKind(track: { id: string; type: string }): SerializedTrackKind {
  if (track.id.startsWith('image-track')) return 'image';
  return track.type as SerializedTrackKind;
}

// ---------------------------------------------------------------------------
// TimelineExportData — the on-disk JSON shape
// ---------------------------------------------------------------------------

/**
 * The full structure of a timeline export file.
 * This matches the shape from services/timelineExportService.ts so that
 * files exported by the old system can be imported by this adapter.
 */
export interface TimelineExportData {
  metadata: ExportMetadata & {
    totalDuration: number;
    trackCount: number;
    itemCount: number;
  };
  timeline: {
    currentTime: number;
    totalDuration: number;
    zoomLevel: number;
    selectedItems?: string[];
    playbackRate: number;
    isPlaying: boolean;
    snapToGrid: boolean;
    gridSize: number;
    scrollLeft: number;
  };
  tracks: Array<{
    id: string;
    name: string;
    type: SerializedTrackKind;
    height: number;
    isLocked: boolean;
    isMuted: boolean;
    isVisible: boolean;
    volume?: number;
    order: number;
    items: Array<{
      id: string;
      name: string;
      type: 'video' | 'audio' | 'subtitle';
      startTime: number;
      duration: number;
      trackId: string;
      color: string;
      thumbnailUrl?: string;
      waveformData?: number[];
      text?: string;
      materialId?: string;
      volume?: number;
      opacity?: number;
      isSelected?: boolean;
      clipStart?: number;
      clipEnd?: number;
      originalDuration?: number;
      originalMaterialType?: string;
      subtitleStyle?: unknown;
      imagePosition?: unknown;
    }>;
  }>;
  materials: Array<{
    id: string;
    name: string;
    type: string;
    format?: string;
    size?: number;
    duration?: number;
    width?: number;
    height?: number;
    thumbnailUrl?: string;
    url?: string;
    serverUrl?: string;
    createdAt?: string;
    tags?: string[];
    description?: string;
    metadata?: unknown;
  }>;
}

// ---------------------------------------------------------------------------
// Export format version
// ---------------------------------------------------------------------------

const EXPORT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// TimelineRepository implementation
// ---------------------------------------------------------------------------

export class TimelineRepository implements ITimelineRepository {
  /**
   * Export timeline data and materials to a JSON Blob.
   *
   * Logic extracted from timelineExportService.ts#prepareExportData and
   * timelineExportService.ts#downloadJSONFile.
   */
  async exportToJSON(
    data: TimelineData,
    materials: MaterialData[],
    metadata: ExportMetadata
  ): Promise<{ blob: Blob; filename: string }> {
    try {
      // Count total items across all tracks
      const totalItems = data.tracks.reduce(
        (sum, track) => sum + track.items.length,
        0
      );
      // Empty timeline exports 0 instead of the aggregate's >0 invariant
      // fallback (0.001). Re-import is safe: the aggregate re-clamps on load.
      const effectiveTotalDuration = totalItems === 0 ? 0 : data.totalDuration;

      const exportData: TimelineExportData = {
        metadata: {
          exportedAt: metadata.exportedAt,
          version: metadata.version || EXPORT_VERSION,
          taskId: metadata.taskId,
          totalDuration: effectiveTotalDuration,
          trackCount: data.tracks.length,
          itemCount: totalItems,
        },
        timeline: {
          currentTime: data.currentTime,
          totalDuration: effectiveTotalDuration,
          zoomLevel: data.zoomLevel,
          playbackRate: data.playbackRate,
          isPlaying: data.isPlaying,
          snapToGrid: data.snapToGrid,
          gridSize: data.gridSize,
          scrollLeft: data.scrollLeft,
        },
        tracks: data.tracks.map((track) => {
          const kind = getSerializedTrackKind(track);
          const base = {
            id: track.id,
            name: track.name,
            type: kind,
            height: track.height,
            isLocked: track.isLocked,
            isMuted: track.isMuted,
            isVisible: track.isVisible,
            order: track.order,
            items: track.items.map((item) => ({
              id: item.id,
              name: item.name,
              type: item.type,
              startTime: item.startTime,
              duration: item.duration,
              trackId: item.trackId,
              color: item.color,
              thumbnailUrl: item.thumbnailUrl,
              waveformData: item.waveformData,
              text: item.text,
              materialId: item.materialId,
              volume: item.volume,
              opacity: item.opacity,
              isSelected: item.isSelected,
              clipStart: item.clipStart,
              clipEnd: item.clipEnd,
              originalDuration: item.originalDuration,
              originalMaterialType: item.originalMaterialType,
              subtitleStyle: item.subtitleStyle,
              imagePosition: item.imagePosition,
            })),
          };
          // image- and subtitle-tracks do not carry a volume at rest
          return (kind === 'image' || kind === 'subtitle')
            ? base
            : { ...base, volume: track.volume };
        }),
        materials: materials.map((material) => ({
          id: material.id,
          name: material.name,
          type: material.type,
          duration: material.duration,
          thumbnailUrl: material.thumbnailUrl,
          url: material.url,
        })),
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const filename = `timeline-export-${metadata.taskId}-${Date.now()}.json`;

      return { blob, filename };
    } catch (error) {
      throw new TimelineExportError(
        `Failed to export timeline to JSON: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Import timeline data and materials from a JSON file.
   *
   * Reads the file, parses JSON, validates structure, and converts
   * to domain-compatible TimelineData and MaterialData shapes.
   */
  async importFromJSON(
    file: File
  ): Promise<{ timelineData: TimelineData; materials: MaterialData[] }> {
    // Read file content
    let fileContent: string;
    try {
      fileContent = await file.text();
    } catch (error) {
      throw new TimelineImportError(
        'Failed to read the import file.',
        ['File could not be read. It may be corrupted or inaccessible.'],
        error
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(fileContent);
    } catch (error) {
      throw new TimelineImportError(
        'Invalid JSON format.',
        ['The file does not contain valid JSON.'],
        error
      );
    }

    // Validate structure
    const validationErrors = this.collectValidationErrors(parsed);
    if (validationErrors.length > 0) {
      throw new TimelineImportError(
        'The import file has an invalid structure.',
        validationErrors
      );
    }

    const exportData = parsed as TimelineExportData;

    // Convert to domain shapes
    const timelineData: TimelineData = {
      currentTime: exportData.timeline.currentTime ?? 0,
      totalDuration: exportData.timeline.totalDuration ?? 0,
      zoomLevel: exportData.timeline.zoomLevel ?? 1,
      playbackRate: exportData.timeline.playbackRate ?? 1,
      isPlaying: false, // Always start paused on import
      snapToGrid: exportData.timeline.snapToGrid ?? true,
      gridSize: exportData.timeline.gridSize ?? 1,
      scrollLeft: exportData.timeline.scrollLeft ?? 0,
      tracks: exportData.tracks.map((track): TrackData => ({
        id: track.id,
        name: normalizeTrackName(track.name, track.id),
        // 'image' in JSON → internal 'video' (image-tracks live in the video domain).
        type: track.type === 'image' ? 'video' : track.type,
        height: track.height,
        isLocked: track.isLocked ?? false,
        isMuted: track.isMuted ?? false,
        isVisible: track.isVisible ?? true,
        volume: track.volume ?? 100,
        order: track.order ?? 0,
        items: track.items.map((item): TimelineItemData => ({
          id: item.id,
          name: item.name,
          type: item.type,
          startTime: item.startTime,
          duration: item.duration,
          trackId: item.trackId,
          color: item.color,
          thumbnailUrl: item.thumbnailUrl,
          waveformData: item.waveformData,
          text: item.text,
          materialId: item.materialId,
          volume: item.volume,
          opacity: item.opacity,
          isSelected: false, // Clear selection on import
          clipStart: item.clipStart,
          clipEnd: item.clipEnd,
          originalDuration: item.originalDuration,
          originalMaterialType: item.originalMaterialType as TimelineItemData['originalMaterialType'],
          subtitleStyle: item.subtitleStyle as TimelineItemData['subtitleStyle'],
          imagePosition: item.imagePosition as TimelineItemData['imagePosition'],
        })),
      })),
    };

    const materials: MaterialData[] = exportData.materials.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type as MaterialData['type'],
      duration: m.duration,
      thumbnailUrl: m.thumbnailUrl,
      url: m.url,
    }));

    return { timelineData, materials };
  }

  /**
   * Type-guard that validates a parsed JSON object has the expected
   * TimelineExportData structure.
   */
  validateExportData(data: unknown): boolean {
    return this.collectValidationErrors(data).length === 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Collect all validation errors from a parsed object.
   * Returns an empty array if the data is valid.
   */
  private collectValidationErrors(data: unknown): string[] {
    const errors: string[] = [];

    if (data == null || typeof data !== 'object') {
      errors.push('Data must be a non-null object.');
      return errors;
    }

    const obj = data as Record<string, unknown>;

    // metadata
    if (!obj.metadata || typeof obj.metadata !== 'object') {
      errors.push('Missing or invalid "metadata" section.');
    }

    // timeline
    if (!obj.timeline || typeof obj.timeline !== 'object') {
      errors.push('Missing or invalid "timeline" section.');
    }

    // tracks
    if (!Array.isArray(obj.tracks)) {
      errors.push('Missing or invalid "tracks" array.');
    } else {
      for (let i = 0; i < obj.tracks.length; i++) {
        const track = obj.tracks[i] as Record<string, unknown> | undefined;
        if (!track || typeof track !== 'object') {
          errors.push(`tracks[${i}] is not a valid object.`);
          continue;
        }
        if (typeof track.id !== 'string') {
          errors.push(`tracks[${i}].id must be a string.`);
        }
        if (typeof track.type !== 'string') {
          errors.push(`tracks[${i}].type must be a string.`);
        } else if (!['video', 'image', 'audio', 'subtitle'].includes(track.type as string)) {
          errors.push(`tracks[${i}].type "${track.type}" is not a valid track type.`);
        }
        if (!Array.isArray(track.items)) {
          errors.push(`tracks[${i}].items must be an array.`);
        } else {
          for (let j = 0; j < (track.items as unknown[]).length; j++) {
            const item = (track.items as Record<string, unknown>[])[j];
            if (!item || typeof item !== 'object') {
              errors.push(`tracks[${i}].items[${j}] is not a valid object.`);
              continue;
            }
            if (typeof item.id !== 'string') {
              errors.push(`tracks[${i}].items[${j}].id must be a string.`);
            }
            if (typeof item.startTime !== 'number') {
              errors.push(`tracks[${i}].items[${j}].startTime must be a number.`);
            }
            if (typeof item.duration !== 'number') {
              errors.push(`tracks[${i}].items[${j}].duration must be a number.`);
            }
          }
        }
      }
    }

    // materials
    if (!Array.isArray(obj.materials)) {
      errors.push('Missing or invalid "materials" array.');
    } else {
      for (let i = 0; i < obj.materials.length; i++) {
        const material = obj.materials[i] as Record<string, unknown> | undefined;
        if (!material || typeof material !== 'object') {
          errors.push(`materials[${i}] is not a valid object.`);
          continue;
        }
        if (typeof material.id !== 'string') {
          errors.push(`materials[${i}].id must be a string.`);
        }
        if (typeof material.name !== 'string') {
          errors.push(`materials[${i}].name must be a string.`);
        }
        if (typeof material.type !== 'string') {
          errors.push(`materials[${i}].type must be a string.`);
        }
      }
    }

    return errors;
  }
}
