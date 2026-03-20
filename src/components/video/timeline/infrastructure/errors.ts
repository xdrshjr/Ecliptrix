/**
 * Infrastructure Layer — Error Types
 *
 * Custom error classes for the infrastructure adapters.
 * These provide structured error information that the Store layer
 * can catch and convert to user-facing notifications.
 */

// ---------------------------------------------------------------------------
// TimelineExportError
// ---------------------------------------------------------------------------

/**
 * Thrown when exporting timeline data to JSON fails.
 * Examples: serialization failure, metadata validation error.
 */
export class TimelineExportError extends Error {
  readonly name = 'TimelineExportError';

  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, TimelineExportError.prototype);
  }
}

// ---------------------------------------------------------------------------
// TimelineImportError
// ---------------------------------------------------------------------------

/**
 * Thrown when importing timeline data from a JSON file fails.
 * Carries structured validation errors so the UI can display specifics.
 */
export class TimelineImportError extends Error {
  readonly name = 'TimelineImportError';

  constructor(
    message: string,
    /** List of specific validation failures found in the file. */
    public readonly validationErrors: string[],
    public readonly cause?: unknown
  ) {
    super(message);
    Object.setPrototypeOf(this, TimelineImportError.prototype);
  }
}

// ---------------------------------------------------------------------------
// VideoCacheError
// ---------------------------------------------------------------------------

/**
 * Thrown when a video cache operation fails (preload timeout,
 * network error, etc.).
 */
export class VideoCacheError extends Error {
  readonly name = 'VideoCacheError';

  constructor(
    message: string,
    /** The material ID the error relates to. */
    public readonly materialId: string,
    public readonly cause?: unknown
  ) {
    super(message);
    Object.setPrototypeOf(this, VideoCacheError.prototype);
  }
}
