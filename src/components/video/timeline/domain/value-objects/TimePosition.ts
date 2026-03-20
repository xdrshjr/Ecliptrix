/**
 * TimePosition Value Object
 *
 * Represents a point in time on the timeline (in seconds).
 * Immutable — all mutation methods return new instances.
 *
 * Invariant: value >= 0
 */

import type { Duration } from './Duration';
import type { ZoomLevel } from './ZoomLevel';

export class TimePosition {
  /** Time in seconds. Always >= 0. */
  readonly value: number;

  // ------------------------------------------------------------------
  // Construction (private — use static factory methods)
  // ------------------------------------------------------------------

  private constructor(seconds: number) {
    if (!Number.isFinite(seconds)) {
      throw new Error(`TimePosition: value must be a finite number, got ${seconds}`);
    }
    if (seconds < 0) {
      throw new Error(`TimePosition: value must be >= 0, got ${seconds}`);
    }
    this.value = seconds;
  }

  // ------------------------------------------------------------------
  // Static factory methods
  // ------------------------------------------------------------------

  /**
   * Create a TimePosition from a value in seconds.
   * @param seconds Must be >= 0.
   * @throws if seconds < 0 or not finite.
   */
  static create(seconds: number): TimePosition {
    return new TimePosition(seconds);
  }

  /** Convenience factory returning time 0. */
  static zero(): TimePosition {
    return new TimePosition(0);
  }

  /**
   * Convert a pixel offset to a TimePosition given a zoom level.
   * @param px Pixel offset (must be >= 0).
   * @param zoomLevel The current zoom level.
   */
  static fromPixels(px: number, zoomLevel: ZoomLevel): TimePosition {
    const pixelsPerSecond = zoomLevel.toPixelsPerSecond();
    if (pixelsPerSecond === 0) {
      return TimePosition.zero();
    }
    const seconds = Math.max(0, px / pixelsPerSecond);
    return new TimePosition(seconds);
  }

  // ------------------------------------------------------------------
  // Instance methods
  // ------------------------------------------------------------------

  /**
   * Add a duration to this position, returning a new TimePosition.
   */
  add(duration: Duration): TimePosition {
    return new TimePosition(this.value + duration.value);
  }

  /**
   * Subtract a duration from this position.
   * Returns null if the result would be negative.
   */
  subtract(duration: Duration): TimePosition | null {
    const result = this.value - duration.value;
    if (result < 0) {
      return null;
    }
    return new TimePosition(result);
  }

  /**
   * Convert this position to a pixel offset at the given zoom level.
   */
  toPixels(zoomLevel: ZoomLevel): number {
    return this.value * zoomLevel.toPixelsPerSecond();
  }

  /** Value equality check. */
  equals(other: TimePosition): boolean {
    return this.value === other.value;
  }

  /** True if this position is strictly after the other. */
  isAfter(other: TimePosition): boolean {
    return this.value > other.value;
  }

  /** True if this position is strictly before the other. */
  isBefore(other: TimePosition): boolean {
    return this.value < other.value;
  }

  /** String representation for debugging. */
  toString(): string {
    return `TimePosition(${this.value}s)`;
  }
}
