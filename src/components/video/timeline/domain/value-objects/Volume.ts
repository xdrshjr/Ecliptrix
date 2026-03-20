/**
 * Volume Value Object
 *
 * Represents a volume level in the range [0, 2.0] (0% to 200%).
 * Immutable — all mutation methods return new instances.
 *
 * Invariant: value is in [0, 2.0]
 */

const MIN_VOLUME = 0;
const MAX_VOLUME = 2.0;

export class Volume {
  /** Volume as a multiplier. 1.0 = 100%, clamped to [0, 2.0]. */
  readonly value: number;

  // ------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------

  private constructor(value: number) {
    if (!Number.isFinite(value)) {
      this.value = 1.0;
      return;
    }
    this.value = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, value));
  }

  // ------------------------------------------------------------------
  // Static factory methods
  // ------------------------------------------------------------------

  /**
   * Create a Volume, clamping the input to [0, 2.0].
   * Non-finite values default to 1.0.
   */
  static create(value: number): Volume {
    return new Volume(value);
  }

  /**
   * Create a Volume from a percentage value (0-200).
   * @param percent 0 to 200 (e.g. 100 = normal volume).
   */
  static fromPercentage(percent: number): Volume {
    return new Volume(percent / 100);
  }

  /** Default volume: 1.0 (100%). */
  static default(): Volume {
    return new Volume(1.0);
  }

  /** Muted volume: 0. */
  static muted(): Volume {
    return new Volume(0);
  }

  // ------------------------------------------------------------------
  // Instance methods
  // ------------------------------------------------------------------

  /**
   * Multiply two volumes (e.g. track volume x item volume).
   * The result is clamped to [0, 2.0].
   */
  multiply(other: Volume): Volume {
    return new Volume(this.value * other.value);
  }

  /** Convert to a percentage (0-200). */
  toPercentage(): number {
    return this.value * 100;
  }

  /** True if the volume is effectively zero. */
  isMuted(): boolean {
    return this.value === 0;
  }

  /** Value equality check. */
  equals(other: Volume): boolean {
    return this.value === other.value;
  }

  /** String representation for debugging. */
  toString(): string {
    return `Volume(${this.toPercentage()}%)`;
  }
}
