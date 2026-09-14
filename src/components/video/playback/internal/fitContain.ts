/**
 * Letterbox / pillarbox computation for the canvas compositor.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2.5
 *
 * Pure function — easy to test without a DOM. Returns the rectangle that the
 * source frame should occupy inside the canvas, preserving aspect ratio and
 * centering the result.
 */

export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FitContainInput {
  /** Intrinsic source width in pixels (e.g. `<video>.videoWidth`). */
  sourceWidth: number;
  /** Intrinsic source height in pixels (e.g. `<video>.videoHeight`). */
  sourceHeight: number;
  /** Destination canvas width in device pixels. */
  destWidth: number;
  /** Destination canvas height in device pixels. */
  destHeight: number;
  /**
   * Optional override for the target aspect ratio. When omitted, the source's
   * own ratio is used. Pass e.g. `16 / 9` to letterbox into a 16:9 frame
   * regardless of source.
   */
  targetAspectRatio?: number;
}

const EPS = 1e-6;

/**
 * Compute the centered, aspect-preserving rectangle for the source.
 *
 * Returns a zero-size rect when any dimension is non-positive — callers
 * should treat that as "skip drawImage and keep last frame".
 */
export function fitContain(input: FitContainInput): FitRect {
  const { sourceWidth, sourceHeight, destWidth, destHeight } = input;
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    destWidth <= 0 ||
    destHeight <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const sourceRatio = input.targetAspectRatio ?? sourceWidth / sourceHeight;
  if (!Number.isFinite(sourceRatio) || sourceRatio <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const destRatio = destWidth / destHeight;
  let width: number;
  let height: number;

  if (sourceRatio - destRatio > EPS) {
    // Source is wider → letterbox top/bottom.
    width = destWidth;
    height = destWidth / sourceRatio;
  } else if (destRatio - sourceRatio > EPS) {
    // Source is taller → pillarbox left/right.
    height = destHeight;
    width = destHeight * sourceRatio;
  } else {
    width = destWidth;
    height = destHeight;
  }

  const x = (destWidth - width) / 2;
  const y = (destHeight - height) / 2;
  return { x, y, width, height };
}

/**
 * Export scales straight to the frame (no padding) when the source and frame
 * aspect ratios differ by less than this — `video_scaling.py` does the same.
 */
const FRAME_ASPECT_TOLERANCE = 0.01;

const ZERO_RECT: FitRect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * The output frame inside the canvas: the project aspect ratio contained in
 * the canvas. Every preview layer (video, image, subtitle) is laid out against
 * this rect, whether or not a video is ready (S11).
 */
export function outputFrameRect(
  destWidth: number,
  destHeight: number,
  targetAspect: number,
): FitRect {
  return fitContain({
    sourceWidth: destWidth,
    sourceHeight: destHeight,
    destWidth,
    destHeight,
    targetAspectRatio: targetAspect,
  });
}

/**
 * A source contained inside the output frame by its OWN aspect ratio, offset
 * by the frame origin — the preview mirror of export's scale-then-pad (PV3-01).
 * A non-positive size yields a zero rect; a ratio within
 * {@link FRAME_ASPECT_TOLERANCE} of the frame fills it, like export.
 */
export function fitSourceInFrame(
  sourceWidth: number,
  sourceHeight: number,
  frame: FitRect,
): FitRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || frame.width <= 0 || frame.height <= 0) {
    return ZERO_RECT;
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const frameRatio = frame.width / frame.height;
  if (Math.abs(sourceRatio - frameRatio) < FRAME_ASPECT_TOLERANCE) {
    return { ...frame };
  }
  const inner = fitContain({
    sourceWidth,
    sourceHeight,
    destWidth: frame.width,
    destHeight: frame.height,
  });
  return { ...inner, x: frame.x + inner.x, y: frame.y + inner.y };
}
