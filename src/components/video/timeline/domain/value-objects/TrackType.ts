/**
 * TrackType Value Object & Utilities
 *
 * Defines the TrackType union and provides static utility methods for
 * material compatibility checks, default colors, and default heights.
 *
 * The compatibility rules are extracted verbatim from
 * src/components/video/timeline/Track.tsx (lines 73-88).
 */

import type { TrackType } from '../types';

// Re-export for convenience — consumers can import from either location.
export type { TrackType };

// ---------------------------------------------------------------------------
// Default visual properties per track type
// ---------------------------------------------------------------------------

const DEFAULT_COLORS: Record<TrackType, string> = {
  video: '#4A90D9',
  audio: '#27AE60',
  subtitle: '#E67E22',
};

const DEFAULT_HEIGHTS: Record<TrackType, number> = {
  video: 80,
  audio: 48,
  subtitle: 32,
};

// ---------------------------------------------------------------------------
// TrackTypeUtils — static utility class
// ---------------------------------------------------------------------------

export class TrackTypeUtils {
  /** Prevent instantiation. */
  private constructor() {}

  /**
   * Check whether a material type is broadly compatible with a track type,
   * ignoring image-track special rules.
   *
   * Compatibility matrix:
   * - video track: accepts 'video' and 'image'
   * - audio track: accepts 'audio'
   * - subtitle track: accepts 'subtitle'
   */
  static isCompatibleWith(trackType: TrackType, materialType: string): boolean {
    switch (materialType) {
      case 'video':
        return trackType === 'video';
      case 'image':
        return trackType === 'video';
      case 'audio':
        return trackType === 'audio';
      case 'subtitle':
        return trackType === 'subtitle';
      default:
        return false;
    }
  }

  /** Return the default display color for a track type. */
  static getDefaultColor(trackType: TrackType): string {
    return DEFAULT_COLORS[trackType] ?? DEFAULT_COLORS.video;
  }

  /** Return the default height in pixels for a track type. */
  static getDefaultHeight(trackType: TrackType): number {
    return DEFAULT_HEIGHTS[trackType] ?? DEFAULT_HEIGHTS.video;
  }

  /**
   * Full compatibility check including the image-track special rule.
   *
   * Rules (from Track.tsx):
   * - 'video' material: accepted by video tracks EXCEPT those whose id
   *   starts with 'image-track'.
   * - 'image' material: accepted by any video track (including image-tracks).
   * - 'audio' material: accepted by audio tracks only.
   * - 'subtitle' material: accepted by subtitle tracks only.
   *
   * @param trackType The type of the target track.
   * @param materialType The type of the material being placed.
   * @param trackId The id of the target track (needed for image-track rule).
   */
  static canAcceptMaterial(
    trackType: TrackType,
    materialType: string,
    trackId: string
  ): boolean {
    switch (materialType) {
      case 'video':
        // Video materials go on video tracks, but NOT on image-tracks.
        return trackType === 'video' && !trackId.startsWith('image-track');
      case 'image':
        // Image materials can go on any video track (including image-tracks).
        return trackType === 'video';
      case 'audio':
        return trackType === 'audio';
      case 'subtitle':
        return trackType === 'subtitle';
      default:
        return false;
    }
  }

  /**
   * Validate that a string is a valid TrackType.
   */
  static isValidTrackType(value: string): value is TrackType {
    return value === 'video' || value === 'audio' || value === 'subtitle';
  }
}
