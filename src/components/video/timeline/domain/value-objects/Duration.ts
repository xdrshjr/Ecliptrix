/**
 * Duration Value Object
 *
 * Represents a span of time (in seconds).
 * Immutable — all mutation methods return new instances.
 *
 * Invariant: value > 0
 */

import type { TimePosition } from './TimePosition';

/** Default duration in seconds for items without an explicit duration. */
const DEFAULT_DURATION_SECONDS = 5;

/**
 * Shortest clip the editor produces — split halves, trims and drag previews.
 * A shorter piece is a sliver nobody can see or grab again at normal zoom.
 */
export const MIN_CLIP_DURATION_SECONDS = 0.1;

export class Duration {
  /** Duration in seconds. Always > 0. */
  readonly value: number;

  // ------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------

  private constructor(seconds: number) {
    if (!Number.isFinite(seconds)) {
      throw new Error(`Duration: value must be a finite number, got ${seconds}`);
    }
    if (seconds <= 0) {
      throw new Error(`Duration: value must be > 0, got ${seconds}`);
    }
    this.value = seconds;
  }

  // ------------------------------------------------------------------
  // Static factory methods
  // ------------------------------------------------------------------

  /**
   * Create a Duration from seconds.
   * @param seconds Must be > 0.
   * @throws if seconds <= 0 or not finite.
   */
  static create(seconds: number): Duration {
    return new Duration(seconds);
  }

  /**
   * Compute a Duration from two TimePositions.
   * @throws if end is not after start.
   */
  static fromRange(start: TimePosition, end: TimePosition): Duration {
    const diff = end.value - start.value;
    if (diff <= 0) {
      throw new Error(
        `Duration.fromRange: end (${end.value}) must be after start (${start.value})`
      );
    }
    return new Duration(diff);
  }

  /** Default duration (5 seconds). */
  static default(): Duration {
    return new Duration(DEFAULT_DURATION_SECONDS);
  }

  // ------------------------------------------------------------------
  // Instance methods
  // ------------------------------------------------------------------

  /** Add another duration, returning a new Duration. */
  add(other: Duration): Duration {
    return new Duration(this.value + other.value);
  }

  /**
   * Subtract another duration.
   * Returns null if the result would be <= 0.
   */
  subtract(other: Duration): Duration | null {
    const result = this.value - other.value;
    if (result <= 0) {
      return null;
    }
    return new Duration(result);
  }

  /**
   * Multiply by a factor.
   * @param factor Must be > 0.
   * @throws if factor <= 0.
   */
  multiply(factor: number): Duration {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`Duration.multiply: factor must be > 0, got ${factor}`);
    }
    return new Duration(this.value * factor);
  }

  /** Value equality check. */
  equals(other: Duration): boolean {
    return this.value === other.value;
  }

  /** True if this duration is strictly longer than the other. */
  isLongerThan(other: Duration): boolean {
    return this.value > other.value;
  }

  /** String representation for debugging. */
  toString(): string {
    return `Duration(${this.value}s)`;
  }
}
