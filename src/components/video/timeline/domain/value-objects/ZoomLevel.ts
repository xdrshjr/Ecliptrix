/**
 * ZoomLevel Value Object
 *
 * Represents the timeline zoom level.
 * Immutable — all mutation methods return new instances.
 *
 * Invariant: value is in [MIN, MAX] (0.1 to 5.0)
 */

/** Base ratio: at zoom 1.0 there are 50 pixels per second. */
const PIXELS_PER_SECOND_BASE = 50;
const MIN = 0.1;
const MAX = 5.0;
const DEFAULT_STEP = 0.1;

export class ZoomLevel {
  /** Zoom multiplier, clamped to [0.1, 5.0]. */
  readonly value: number;

  // ------------------------------------------------------------------
  // Constants (exposed as static readonly for external consumers)
  // ------------------------------------------------------------------

  static readonly PIXELS_PER_SECOND_BASE = PIXELS_PER_SECOND_BASE;
  static readonly MIN = MIN;
  static readonly MAX = MAX;

  // ------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------

  private constructor(value: number) {
    if (!Number.isFinite(value)) {
      this.value = 1.0;
      return;
    }
    this.value = Math.min(MAX, Math.max(MIN, value));
  }

  // ------------------------------------------------------------------
  // Static factory methods
  // ------------------------------------------------------------------

  /**
   * Create a ZoomLevel, clamping the input to [0.1, 5.0].
   * Non-finite values default to 1.0.
   */
  static create(value: number): ZoomLevel {
    return new ZoomLevel(value);
  }

  /** Default zoom level: 1.0. */
  static default(): ZoomLevel {
    return new ZoomLevel(1.0);
  }

  // ------------------------------------------------------------------
  // Instance methods
  // ------------------------------------------------------------------

  /**
   * Zoom in by the given step (default 0.1).
   * Returns a new ZoomLevel clamped to MAX.
   */
  zoomIn(step: number = DEFAULT_STEP): ZoomLevel {
    return new ZoomLevel(this.value + step);
  }

  /**
   * Zoom out by the given step (default 0.1).
   * Returns a new ZoomLevel clamped to MIN.
   */
  zoomOut(step: number = DEFAULT_STEP): ZoomLevel {
    return new ZoomLevel(this.value - step);
  }

  /**
   * Convert to pixels per second at this zoom level.
   * Formula: value * PIXELS_PER_SECOND_BASE
   */
  toPixelsPerSecond(): number {
    return this.value * PIXELS_PER_SECOND_BASE;
  }

  /** Value equality check. */
  equals(other: ZoomLevel): boolean {
    return this.value === other.value;
  }

  /** String representation for debugging. */
  toString(): string {
    return `ZoomLevel(${this.value}, ${this.toPixelsPerSecond()}px/s)`;
  }
}
