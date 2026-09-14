/**
 * DragCalculationService
 *
 * Extracted from TimelineItem.tsx (lines 28-237).
 *
 * Responsible for all drag-and-resize math:
 *  - Converting between pixels and time.
 *  - Calculating new positions during move operations.
 *  - Calculating new start/duration during resize operations.
 *  - Detecting whether a mouse click is a move or resize interaction.
 *  - Snapping time values to a grid.
 *
 * Pure static methods — no DOM, no React, no side effects.
 */

import { TimePosition } from '../value-objects/TimePosition';
import { Duration, MIN_CLIP_DURATION_SECONDS } from '../value-objects/Duration';
import { ZoomLevel } from '../value-objects/ZoomLevel';
import type { TrackData } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Width of the resize handle in pixels. If a mouse-down occurs within this
 * many pixels of either edge of an item, it is treated as a resize interaction.
 * Extracted from TimelineItem.tsx line 60: `const resizeThreshold = 8`.
 */
const RESIZE_HANDLE_WIDTH = 8;

/**
 * Default center-region ratio for swap hit detection. Kept in sync with
 * the SWAP_TARGET_CENTER_RATIO constant in `constants.ts`; this copy keeps
 * the domain layer free of outward imports.
 */
const DEFAULT_SWAP_CENTER_RATIO = 0.6;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result of a resize calculation. */
export interface ResizeResult {
  startTime: TimePosition;
  duration: Duration;
}

/** The type of mouse interaction detected. */
export type InteractionType = 'move' | 'resize-start' | 'resize-end';

// ---------------------------------------------------------------------------
// DragCalculationService
// ---------------------------------------------------------------------------

export class DragCalculationService {
  /** Prevent instantiation — all methods are static. */
  private constructor() {}

  // -----------------------------------------------------------------------
  // Constants (exposed for consumers)
  // -----------------------------------------------------------------------

  static readonly RESIZE_HANDLE_WIDTH = RESIZE_HANDLE_WIDTH;

  // -----------------------------------------------------------------------
  // Core conversion helpers
  // -----------------------------------------------------------------------

  /**
   * Convert a pixel distance to a time delta (in seconds).
   *
   * Formula: px / (zoomLevel.value * 50)
   *
   * This matches the original code: `const deltaTime = deltaX / pixelsPerSecond`
   * where pixelsPerSecond = zoomLevel * 50.
   *
   * @param px  Pixel distance (can be negative for leftward motion).
   * @param zoomLevel  Current zoom level.
   * @returns Time delta in seconds.
   */
  static pixelsToTime(px: number, zoomLevel: ZoomLevel): number {
    const pps = zoomLevel.toPixelsPerSecond();
    if (pps === 0) return 0;
    return px / pps;
  }

  /**
   * Convert a time value (in seconds) to a pixel offset.
   *
   * Formula: time * (zoomLevel.value * 50)
   *
   * @param time  Time in seconds.
   * @param zoomLevel  Current zoom level.
   * @returns Pixel offset.
   */
  static timeToPixels(time: number, zoomLevel: ZoomLevel): number {
    return time * zoomLevel.toPixelsPerSecond();
  }

  /**
   * Snap a time value to the nearest grid line.
   *
   * Formula: Math.round(time / gridSize) * gridSize
   *
   * @param time     Time in seconds.
   * @param gridSize Grid interval in seconds (must be > 0).
   * @returns Snapped time value.
   */
  static snapToGrid(time: number, gridSize: number): number {
    if (gridSize <= 0) return time;
    return Math.round(time / gridSize) * gridSize;
  }

  // -----------------------------------------------------------------------
  // Move calculation
  // -----------------------------------------------------------------------

  /**
   * Calculate the new start position of an item during a drag-move operation.
   *
   * Extracted from TimelineItem.tsx lines 112-127:
   *   deltaTime = deltaX / pixelsPerSecond
   *   newStartTime = max(0, dragStart.startTime + deltaTime)
   *
   * Optionally snaps to grid.
   *
   * @param originalStartTime  The item's start time when the drag began.
   * @param deltaX             Mouse movement in pixels since drag start.
   * @param zoomLevel          Current zoom level.
   * @param snapEnabled        Whether to snap to grid.
   * @param gridSize           Grid interval in seconds (only used if snapEnabled).
   * @returns New TimePosition for the item's start time.
   */
  static calculateMovePosition(
    originalStartTime: TimePosition,
    deltaX: number,
    zoomLevel: ZoomLevel,
    snapEnabled: boolean = false,
    gridSize: number = 1,
  ): TimePosition {
    const deltaTime = DragCalculationService.pixelsToTime(deltaX, zoomLevel);
    let newStartTime = Math.max(0, originalStartTime.value + deltaTime);

    if (snapEnabled && gridSize > 0) {
      newStartTime = DragCalculationService.snapToGrid(newStartTime, gridSize);
    }

    return TimePosition.create(newStartTime);
  }

  // -----------------------------------------------------------------------
  // Resize calculation
  // -----------------------------------------------------------------------

  /**
   * Calculate the new start time and duration when resizing an item.
   *
   * Extracted from TimelineItem.tsx lines 144-237.
   *
   * The method accepts the **initial** (drag-start) values for startTime and
   * duration to avoid cumulative floating-point drift, matching the original
   * code which always computes relative to `dragStart.startTime` / `dragStart.duration`.
   *
   * ## Edge = 'end' (adjusting the right edge)
   *
   * - The start time is unchanged.
   * - newDuration = max(minDuration, initialDuration + deltaTime)
   * - Constrained by: originalDuration - clipStart (cannot exceed remaining
   *   source media).
   *
   * ## Edge = 'start' (adjusting the left edge)
   *
   * - The end time (initialStartTime + initialDuration) is fixed.
   * - newStartTime = initialStartTime + deltaTime, clamped to [minAllowed, maxAllowed].
   * - minAllowed is constrained by clipStart (cannot extend before source start).
   * - newDuration = fixedEndTime - newStartTime, clamped to <= originalDuration.
   *
   * @param initialStartTime    The start time at drag start.
   * @param initialDuration     The duration at drag start.
   * @param edge                Which edge is being resized.
   * @param deltaX              Mouse movement in pixels since drag start.
   * @param zoomLevel           Current zoom level.
   * @param originalDuration    Full duration of the source media (for clamping).
   *                            Defaults to initialDuration if not provided.
   * @param clipStart           Current clip start offset within the source media.
   *                            Defaults to 0.
   * @param clipEnd             Current clip end offset within the source media.
   *                            Defaults to originalDuration.
   * @param minDuration         Minimum allowed duration in seconds. Defaults to 0.1.
   * @returns The resulting { startTime, duration }.
   */
  static calculateResizePosition(
    initialStartTime: TimePosition,
    initialDuration: Duration,
    edge: 'start' | 'end',
    deltaX: number,
    zoomLevel: ZoomLevel,
    originalDuration?: number,
    clipStart?: number,
    clipEnd?: number,
    minDuration: number = MIN_CLIP_DURATION_SECONDS,
  ): ResizeResult {
    const deltaTime = DragCalculationService.pixelsToTime(deltaX, zoomLevel);
    const origDur = originalDuration ?? initialDuration.value;
    const curClipStart = clipStart ?? 0;

    if (edge === 'end') {
      return DragCalculationService.calculateResizeEnd(
        initialStartTime,
        initialDuration,
        deltaTime,
        origDur,
        curClipStart,
        minDuration,
      );
    } else {
      return DragCalculationService.calculateResizeStart(
        initialStartTime,
        initialDuration,
        deltaTime,
        origDur,
        curClipStart,
        clipEnd ?? origDur,
        minDuration,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Interaction type detection
  // -----------------------------------------------------------------------

  /**
   * Determine whether a mouse-down event should be treated as a move or
   * a resize operation, based on the click position relative to the item.
   *
   * Extracted from TimelineItem.tsx lines 57-93.
   *
   * @param relativeX  Horizontal distance from the left edge of the item (px).
   * @param itemWidth  Width of the item in pixels.
   * @returns The interaction type: 'resize-start', 'resize-end', or 'move'.
   */
  static detectInteractionType(
    relativeX: number,
    itemWidth: number,
  ): InteractionType {
    if (relativeX <= RESIZE_HANDLE_WIDTH) {
      return 'resize-start';
    }
    if (relativeX >= itemWidth - RESIZE_HANDLE_WIDTH) {
      return 'resize-end';
    }
    return 'move';
  }

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

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Resize from the 'end' edge (right side).
   *
   * Extracted from TimelineItem.tsx lines 144-177.
   */
  private static calculateResizeEnd(
    initialStartTime: TimePosition,
    initialDuration: Duration,
    deltaTime: number,
    originalDuration: number,
    clipStart: number,
    minDuration: number,
  ): ResizeResult {
    const requestedDuration = initialDuration.value + deltaTime;

    // Maximum allowed duration based on remaining source media
    const maxAllowedDuration = originalDuration - clipStart;

    // Apply constraints: at least minDuration, at most maxAllowedDuration
    const constrainedDuration = Math.max(
      minDuration,
      Math.min(requestedDuration, maxAllowedDuration),
    );

    return {
      startTime: initialStartTime,
      duration: Duration.create(constrainedDuration),
    };
  }

  /**
   * Resize from the 'start' edge (left side).
   *
   * Extracted from TimelineItem.tsx lines 178-237.
   */
  private static calculateResizeStart(
    initialStartTime: TimePosition,
    initialDuration: Duration,
    deltaTime: number,
    originalDuration: number,
    clipStart: number,
    clipEnd: number,
    minDuration: number,
  ): ResizeResult {
    const originalEndTime = initialStartTime.value + initialDuration.value;

    // Requested new start time
    const requestedStartTime = initialStartTime.value + deltaTime;

    // Maximum start time: must leave at least minDuration
    const maxAllowedStartTime = originalEndTime - minDuration;

    // Maximum leftward extension: limited by clipStart (can't go before source start)
    const maxLeftExtension = clipStart;
    const minAllowedStartTime = Math.max(0, initialStartTime.value - maxLeftExtension);

    // Apply all constraints
    const constrainedStartTime = Math.max(
      minAllowedStartTime,
      Math.min(requestedStartTime, maxAllowedStartTime),
    );

    // Compute duration from the fixed end time
    const constrainedDuration = originalEndTime - constrainedStartTime;

    // Final check: duration must not exceed originalDuration
    const finalDuration = Math.min(constrainedDuration, originalDuration);
    const finalStartTime = originalEndTime - finalDuration;

    return {
      startTime: TimePosition.create(Math.max(0, finalStartTime)),
      duration: Duration.create(Math.max(minDuration, finalDuration)),
    };
  }
}
