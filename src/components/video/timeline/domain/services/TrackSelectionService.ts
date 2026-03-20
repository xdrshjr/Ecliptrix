/**
 * TrackSelectionService
 *
 * Extracted from TimelinePanel.tsx handleMaterialDrop (lines 394-513).
 *
 * Responsible for selecting the appropriate track for a given material type.
 * Implements the image-track priority logic: image materials prefer tracks
 * whose id starts with 'image-track', then fall back to any video track.
 *
 * Pure static methods — no external dependencies (React, DOM, etc.).
 */

import { Track } from '../entities/Track';

export class TrackSelectionService {
  /** Prevent instantiation — all methods are static. */
  private constructor() {}

  /**
   * Select the best track for placing a material.
   *
   * Algorithm (extracted from TimelinePanel.tsx):
   *   1. If targetTrackId is specified and that track exists, return it.
   *   2. If targetTrackId is specified but not found, fall through to
   *      automatic selection (fallback behavior from original code).
   *   3. Automatic selection by materialType:
   *      - 'image': prefer tracks with id starting 'image-track', then
   *                 any video-type track.
   *      - 'video': video-type tracks excluding image-tracks.
   *      - 'audio': audio-type tracks.
   *      - 'subtitle': subtitle-type tracks.
   *   4. Return the first compatible track, or null if none found.
   *
   * @param tracks   All available tracks (read-only — not mutated).
   * @param materialType  The type of material being placed (e.g. 'video', 'image', 'audio', 'subtitle').
   * @param targetTrackId  Optional explicit target track ID.
   * @returns The selected Track, or null if no compatible track exists.
   */
  static selectTrackForMaterial(
    tracks: ReadonlyArray<Track>,
    materialType: string,
    targetTrackId?: string,
  ): Track | null {
    // 1. If an explicit target track was specified, try to find it.
    if (targetTrackId) {
      const explicitTrack = tracks.find(t => t.id === targetTrackId) ?? null;
      if (explicitTrack) {
        return explicitTrack;
      }
      // Explicit track not found — fall through to automatic selection
      // (matches the original fallback behavior in TimelinePanel.tsx lines 448-482).
    }

    // 2. Automatic selection: find compatible tracks and return the first one.
    const compatible = TrackSelectionService.getCompatibleTracks(tracks, materialType);
    return compatible.length > 0 ? compatible[0] : null;
  }

  /**
   * Return all tracks compatible with the given material type.
   *
   * Compatibility rules (extracted from TimelinePanel.tsx lines 455-498):
   *   - 'image': tracks with id === 'image-track-1' OR type === 'video'
   *              (image-track-1 first due to filter ordering in original code)
   *   - 'video': type === 'video' AND id does NOT start with 'image-track'
   *   - 'audio': type === 'audio'
   *   - 'subtitle': type === 'subtitle'
   *
   * The returned array preserves the order of the input tracks array,
   * which matches the original behavior (first compatible track is selected).
   *
   * @param tracks  All available tracks.
   * @param materialType  The material type to check compatibility for.
   * @returns Array of compatible tracks (may be empty).
   */
  static getCompatibleTracks(
    tracks: ReadonlyArray<Track>,
    materialType: string,
  ): Track[] {
    return tracks.filter(track => {
      switch (materialType) {
        case 'image':
          // Image materials: prefer image-track-*, but accept any video track.
          // image-track-* IS a video track, and filter preserves order,
          // so image-tracks will naturally appear first if they come first in the array.
          return track.id.startsWith('image-track') || track.type === 'video';

        case 'video':
          // Video materials: video tracks, excluding image-tracks.
          return track.type === 'video' && !track.id.startsWith('image-track');

        case 'audio':
          return track.type === 'audio';

        case 'subtitle':
          return track.type === 'subtitle';

        default:
          return false;
      }
    });
  }
}
