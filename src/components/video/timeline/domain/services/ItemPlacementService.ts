/**
 * ItemPlacementService
 *
 * Extracted from TimelinePanel.tsx handleMaterialDrop (lines 500-695).
 *
 * Responsible for:
 *  - Calculating where a new item should be placed on a track.
 *  - Creating a TimelineItem from material metadata.
 *  - Assigning colors by material type.
 *  - Detecting time-range overlaps between items.
 *
 * Pure static methods — no external dependencies (React, DOM, etc.).
 */

import { Track } from '../entities/Track';
import { TimelineItem } from '../entities/TimelineItem';
import { TimePosition } from '../value-objects/TimePosition';
import { Duration } from '../value-objects/Duration';
import type {
  MaterialData,
  TrackType,
  TimelineItemData,
  TrackData,
} from '../types';

// ---------------------------------------------------------------------------
// Overlap detection types
// ---------------------------------------------------------------------------

/**
 * One overlap pair detected on a single track.
 *
 * `a` is always the item with the earlier (or equal) startTime per the
 * scan order, but consumers should not depend on that ordering — both
 * items participate symmetrically in the overlap.
 */
export interface OverlapReport {
  trackId: string;
  trackType: TrackType;
  a: { clipId: string; startTime: number; endTime: number };
  b: { clipId: string; startTime: number; endTime: number };
  /** Inclusive lower bound of the overlapping interval (seconds). */
  overlapStart: number;
  /** Exclusive upper bound of the overlapping interval (seconds). */
  overlapEnd: number;
}

export interface FindAllOverlapsOptions {
  /** Minimum positive overlap (seconds) treated as real. Default: 1e-6. */
  epsilon?: number;
  /** When provided, only these tracks are scanned. */
  trackIds?: ReadonlyArray<string>;
}

const DEFAULT_OVERLAP_EPSILON = 1e-6;

/**
 * Half-open interval intersection test, shared by all overlap helpers.
 *
 * Two intervals [aStart, aEnd) and [bStart, bEnd) intersect iff their
 * intersection has length > epsilon. Touching boundaries (aEnd === bStart)
 * are NOT considered an overlap.
 */
function intersects(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  epsilon: number,
): boolean {
  const overlapLow = Math.max(aStart, bStart);
  const overlapHigh = Math.min(aEnd, bEnd);
  return overlapHigh - overlapLow > epsilon;
}

// ---------------------------------------------------------------------------
// Color mapping — extracted from TimelinePanel.tsx getMaterialColor
// ---------------------------------------------------------------------------

/**
 * Color assignments per material type.
 *
 * Note: the spec defines one palette (#4A90D9, #50C878, #FFB347, #9B59B6) while
 * the actual TimelinePanel.tsx uses a different palette (#3b82f6, #10b981, #8b5cf6,
 * #6b7280). We preserve the **existing code's colors** to avoid visual regressions.
 * The spec colors are used by the entity's getDefaultColor (which operates on
 * TrackType, not MaterialType).
 */
const MATERIAL_TYPE_COLORS: Record<string, string> = {
  video: '#3b82f6',
  audio: '#10b981',
  image: '#8b5cf6',
};

const DEFAULT_COLOR = '#6b7280';

// ---------------------------------------------------------------------------
// ID generation — matches TimelinePanel.tsx generateId()
// ---------------------------------------------------------------------------

function generateItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// ---------------------------------------------------------------------------
// ItemPlacementService
// ---------------------------------------------------------------------------

export class ItemPlacementService {
  /** Prevent instantiation — all methods are static. */
  private constructor() {}

  /**
   * Calculate the next available placement position on a track.
   *
   * Returns the end time of the last item on the track, or TimePosition.zero()
   * if the track is empty. This matches the original getTrackEndTime() helper
   * in TimelinePanel.tsx (line 328): it takes the max endTime of all items.
   *
   * @param track  The target track.
   * @returns TimePosition representing the start time for the next item.
   */
  static calculatePlacementPosition(track: Track): TimePosition {
    const items = track.items;
    if (items.length === 0) {
      return TimePosition.zero();
    }

    // Find the maximum end time across all items on the track.
    // The original code uses Math.max(...items.map(i => i.startTime + i.duration)).
    let maxEnd = 0;
    for (const item of items) {
      const end = item.startTime.value + item.duration.value;
      if (end > maxEnd) {
        maxEnd = end;
      }
    }
    return TimePosition.create(maxEnd);
  }

  /**
   * Create a TimelineItem from material metadata.
   *
   * Extracted from TimelinePanel.tsx lines 543-580.
   *
   * Algorithm:
   *   1. Generate a unique ID.
   *   2. Determine startTime from the parameter, or calculatePlacementPosition(track).
   *   3. Duration comes from material.duration, falling back to 5 seconds.
   *   4. Color is assigned by material type.
   *   5. Type mapping: 'image' materials are placed on video tracks, so the
   *      item type becomes 'video', with originalMaterialType = 'image'.
   *   6. Copy media-specific properties (thumbnailUrl, sentenceSegments, etc.).
   *   7. Set default imagePosition for image materials.
   *   8. Generate random waveform data for audio materials (50 values).
   *
   * @param material  The material metadata.
   * @param track     The target track (used for placement calculation and trackId).
   * @param startTime Optional explicit start time. If omitted, appends to end of track.
   * @returns A plain TimelineItemData object ready to be used with TimelineItem.fromPlainObject().
   */
  static createItemFromMaterial(
    material: MaterialData,
    track: Track,
    startTime?: TimePosition,
  ): TimelineItemData {
    const placementTime = startTime ?? ItemPlacementService.calculatePlacementPosition(track);
    const duration = (material.duration && material.duration > 0) ? material.duration : 5;

    // Map material type to track-compatible item type.
    // Image materials are placed on video tracks; the item type becomes 'video'.
    const itemType: TrackType = material.type === 'image'
      ? 'video'
      : material.type as TrackType;

    const color = ItemPlacementService.getColorForType(material.type);

    const itemData: TimelineItemData = {
      id: generateItemId(),
      name: material.name,
      type: itemType,
      startTime: placementTime.value,
      duration,
      trackId: track.id,
      color,
      materialId: material.id,
      volume: 1.0,
      opacity: 1.0,
      thumbnailUrl: material.thumbnailUrl,

      // Clip properties — initialize to full range
      clipStart: 0,
      clipEnd: duration,
      originalDuration: duration,

      // Original material type for distinguishing image items on video tracks
      originalMaterialType: material.type,
    };

    // Audio-specific: generate random waveform data (50 samples)
    // Matches the original: Array.from({ length: 50 }, () => Math.random() * 0.8 + 0.2)
    if (material.type === 'audio') {
      itemData.waveformData = Array.from({ length: 50 }, () => Math.random() * 0.8 + 0.2);
      // Copy sentence segments for TTS audio visualization
      if (material.sentenceSegments) {
        itemData.sentenceSegments = material.sentenceSegments;
      }
    }

    // Image-specific: set default position overlay
    // Matches the original: { x: 0.1, y: 0.1, width: 0.3, height: 0.3, zIndex: 10 }
    if (material.type === 'image') {
      itemData.imagePosition = {
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.3,
        zIndex: 10,
      };
    }

    return itemData;
  }

  /**
   * Get the display color for a material type.
   *
   * Extracted from TimelinePanel.tsx getMaterialColor (lines 318-325).
   *
   * Color mapping:
   *   - 'video'    -> '#3b82f6'
   *   - 'audio'    -> '#10b981'
   *   - 'image'    -> '#8b5cf6'
   *   - 'subtitle' -> '#6b7280' (default — matches original source code)
   *   - other      -> '#6b7280'
   */
  static getColorForType(materialType: string): string {
    return MATERIAL_TYPE_COLORS[materialType] ?? DEFAULT_COLOR;
  }

  /**
   * Check whether a new item overlaps with any existing items on the same track.
   *
   * Two items overlap if their time intervals (startTime, endTime) share any
   * non-zero-length intersection:
   *   overlap iff itemA.startTime < itemB.endTime AND itemB.startTime < itemA.endTime
   *
   * @param items      Existing items to check against.
   * @param newItem    The item being placed / moved.
   * @param excludeId  Optional ID to exclude from comparison (used when moving
   *                   an existing item to avoid self-collision).
   * @returns true if the newItem overlaps with any item (excluding excludeId).
   */
  static hasOverlap(
    items: ReadonlyArray<TimelineItem>,
    newItem: TimelineItem,
    excludeId?: string,
  ): boolean {
    const newStart = newItem.startTime.value;
    const newEnd = newItem.endTime().value;

    for (const existing of items) {
      if (excludeId && existing.id === excludeId) {
        continue;
      }

      const existingStart = existing.startTime.value;
      const existingEnd = existing.endTime().value;

      if (intersects(newStart, newEnd, existingStart, existingEnd, DEFAULT_OVERLAP_EPSILON)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Overload: check overlap using plain item data objects instead of entity instances.
   * Convenient when working with serialized state.
   *
   * @param items      Existing items as plain objects.
   * @param newStart   Start time of the new item (seconds).
   * @param newEnd     End time of the new item (seconds).
   * @param excludeId  Optional ID to exclude from comparison.
   * @returns true if the time range overlaps with any item.
   */
  static hasOverlapRaw(
    items: ReadonlyArray<TimelineItemData>,
    newStart: number,
    newEnd: number,
    excludeId?: string,
  ): boolean {
    for (const existing of items) {
      if (excludeId && existing.id === excludeId) {
        continue;
      }

      const existingEnd = existing.startTime + existing.duration;

      if (intersects(newStart, newEnd, existing.startTime, existingEnd, DEFAULT_OVERLAP_EPSILON)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Scan every track and report all pairwise overlaps.
   *
   * Algorithm: per-track sort by startTime, then linear scan with an
   * "active interval frontier" (current max endTime). For each item, compare
   * against all earlier items whose endTime exceeds the new item's startTime.
   *
   * Complexity: O(N log N) per track for the sort, then O(N + K) for the scan
   * where K is the number of overlapping pairs returned. For typical
   * timelines (≤ a few hundred clips) this is well under 5 ms.
   *
   * The function is pure: it does not mutate `tracks`. Touching boundaries
   * are not treated as overlaps (half-open intervals + epsilon tolerance).
   *
   * @param tracks  Plain-object track array (compatible with both
   *   `TrackData` from the domain layer and the legacy `Track` type from
   *   `@/types`). Items lacking `startTime`/`duration` are ignored.
   * @param opts    Optional epsilon and trackId filter.
   */
  static findAllOverlaps(
    tracks: ReadonlyArray<Pick<TrackData, 'id' | 'type'> & { items: ReadonlyArray<Pick<TimelineItemData, 'id' | 'startTime' | 'duration'>> }>,
    opts?: FindAllOverlapsOptions,
  ): OverlapReport[] {
    const epsilon = opts?.epsilon ?? DEFAULT_OVERLAP_EPSILON;
    const trackFilter = opts?.trackIds ? new Set(opts.trackIds) : null;

    const reports: OverlapReport[] = [];

    for (const track of tracks) {
      if (trackFilter && !trackFilter.has(track.id)) continue;
      const items = track.items;
      if (!items || items.length < 2) continue;

      const sorted = [...items]
        .filter(it => typeof it.startTime === 'number' && typeof it.duration === 'number')
        .sort((a, b) => a.startTime - b.startTime);

      // Active list contains items whose endTime is still ahead of the
      // current scan frontier. Pruned each iteration to keep linear cost.
      const active: Array<{ id: string; start: number; end: number }> = [];

      for (const item of sorted) {
        const start = item.startTime;
        const end = start + item.duration;

        // Drop active items that end before this one starts.
        for (let i = active.length - 1; i >= 0; i--) {
          if (active[i].end <= start + epsilon) {
            active.splice(i, 1);
          }
        }

        // Anyone still active whose end exceeds `start + epsilon` overlaps.
        for (const prev of active) {
          if (intersects(prev.start, prev.end, start, end, epsilon)) {
            const overlapStart = Math.max(prev.start, start);
            const overlapEnd = Math.min(prev.end, end);
            reports.push({
              trackId: track.id,
              trackType: track.type,
              a: { clipId: prev.id, startTime: prev.start, endTime: prev.end },
              b: { clipId: item.id, startTime: start, endTime: end },
              overlapStart,
              overlapEnd,
            });
          }
        }

        active.push({ id: item.id, start, end });
      }
    }

    return reports;
  }
}
