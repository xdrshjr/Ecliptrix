/**
 * DragCalculationService
 *
 * Swap hit detection for drag-move previews. The drag maths (pixel ↔ time,
 * move / trim previews, trim hot zones) lives in the drag state machine
 * (`machines/dragMachine.ts`), which is the single source for it (N-17).
 *
 * Pure static methods — no DOM, no React, no side effects.
 */

import type { TrackData } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default center-region ratio for swap hit detection. Kept in sync with
 * the SWAP_TARGET_CENTER_RATIO constant in `constants.ts`; this copy keeps
 * the domain layer free of outward imports.
 */
const DEFAULT_SWAP_CENTER_RATIO = 0.6;

// ---------------------------------------------------------------------------
// DragCalculationService
// ---------------------------------------------------------------------------

export class DragCalculationService {
  /** Prevent instantiation — all methods are static. */
  private constructor() {}

  // -----------------------------------------------------------------------
  // Swap hit detection
  // -----------------------------------------------------------------------

  /**
   * Find the peer item on the dragged item's own track whose center-region
   * the drag preview is hovering over.
   *
   * Hit rule (single AND condition): for the target item with
   * `[t0, t0 + D)` and preview center `c = preview.startTime + preview.duration/2`,
   *   `t0 + (1 - R)/2 · D  ≤  c  <  t0 + (1 + R)/2 · D`
   * where R defaults to 0.6 (middle 60%). The dragged item itself is
   * skipped. Subtitle tracks and locked tracks are excluded — audio/caption
   * alignment is load-bearing, and locked tracks must refuse all mutations.
   *
   * @returns The id of the first hit, or null if no peer qualifies.
   */
  static findSwapTarget(
    tracks: ReadonlyArray<TrackData>,
    draggedItemId: string,
    preview: { startTime: number; duration: number },
    centerRatio: number = DEFAULT_SWAP_CENTER_RATIO,
  ): string | null {
    // 1. Locate the dragged item's own track.
    let hostTrack: TrackData | null = null;
    for (const track of tracks) {
      if (track.items.some(i => i.id === draggedItemId)) {
        hostTrack = track;
        break;
      }
    }
    if (!hostTrack) return null;
    if (hostTrack.isLocked) return null;
    if (hostTrack.type === 'subtitle') return null;

    // 2. Compute the preview center.
    const c = preview.startTime + preview.duration / 2;

    // 3. Half-width of the center band on each side of the item center.
    const halfCenterRatio = centerRatio / 2;

    // 4. Scan peers on the same track.
    for (const peer of hostTrack.items) {
      if (peer.id === draggedItemId) continue;
      const t0 = peer.startTime;
      const D = peer.duration;
      if (D <= 0) continue;
      const peerCenter = t0 + D / 2;
      const halfBand = D * halfCenterRatio;
      const lo = peerCenter - halfBand;
      const hi = peerCenter + halfBand;
      if (c >= lo && c < hi) {
        return peer.id;
      }
    }
    return null;
  }
}
