/**
 * drawWaveform — pure canvas waveform renderer (spec 04 — 本地音频波形).
 *
 * Renders an amplitude waveform from a precomputed `peaks` array. It NEVER
 * decodes audio (no AudioContext / wavesurfer) — the peaks are produced once
 * by the backend FFmpeg pipeline and persisted, so zoom/scroll only re-draw.
 *
 * Two pure helpers back the renderer and are exported for unit testing:
 *   - `slicePeaksForClip`: cut the peaks to a clip's [clipStart, clipEnd]
 *     interval using the spec-01 clip semantics.
 *   - `mapPeaksToColumns`: abs-peak downsample (or repeat-upsample) the sliced
 *     peaks to exactly one value per output pixel column.
 */

const TIME_EPSILON = 0.001;

export interface DrawWaveformOptions {
  /** Target draw width in CSS pixels. */
  width: number;
  /** Target draw height in CSS pixels. */
  height: number;
  /** Peaks-per-second resolution the peaks array was sampled at. */
  peaksPerSecond: number;
  /** Clip start in seconds (spec 01). Omitted → render from the beginning. */
  clipStart?: number;
  /** Clip end in seconds (spec 01). Omitted → render to the end. */
  clipEnd?: number;
  /** Bar fill color. Defaults to a translucent white suited to track clips. */
  color?: string;
  /** Width of each drawn bar in px. Defaults to 2. */
  barWidth?: number;
  /** Gap between bars in px. Defaults to 1. */
  barGap?: number;
}

const DEFAULT_COLOR = 'rgba(255, 255, 255, 0.7)';
const DEFAULT_BAR_WIDTH = 2;
const DEFAULT_BAR_GAP = 1;

/**
 * Slice a peaks array to the clip's source interval.
 *
 * @param peaks Full normalized peaks for the whole material.
 * @param peaksPerSecond Sampling resolution of `peaks`.
 * @param clipStart Clip start in seconds (inclusive). Undefined → 0.
 * @param clipEnd Clip end in seconds (exclusive). Undefined → end.
 * @returns The peaks subrange covering `[clipStart, clipEnd)`. Empty when the
 *   interval is zero-length or inverted; the whole array when bounds are
 *   absent or `peaksPerSecond` is non-positive.
 */
export function slicePeaksForClip(
  peaks: number[],
  peaksPerSecond: number,
  clipStart?: number,
  clipEnd?: number,
): number[] {
  if (!Array.isArray(peaks) || peaks.length === 0) return [];
  if (peaksPerSecond <= 0) return peaks;
  if (clipStart === undefined && clipEnd === undefined) return peaks;

  const total = peaks.length;
  const startSec = clipStart ?? 0;
  const endSec = clipEnd ?? total / peaksPerSecond;

  // Inverted or degenerate interval → nothing to draw.
  if (endSec - startSec <= TIME_EPSILON) return [];

  const startIdx = Math.max(0, Math.floor(startSec * peaksPerSecond));
  const endIdx = Math.min(total, Math.ceil(endSec * peaksPerSecond));
  if (endIdx <= startIdx) return [];
  return peaks.slice(startIdx, endIdx);
}

/**
 * Downsample (or repeat-upsample) `peaks` to exactly `columnCount` values,
 * taking the maximum absolute peak within each column's coverage.
 *
 * @param peaks Normalized peaks (already clip-sliced).
 * @param columnCount Desired number of output columns (≥ 1).
 * @returns A `columnCount`-length array; all-zero when `peaks` is empty.
 */
export function mapPeaksToColumns(
  peaks: number[],
  columnCount: number,
): number[] {
  if (columnCount <= 0) return [];
  if (!Array.isArray(peaks) || peaks.length === 0) {
    return new Array(columnCount).fill(0);
  }

  const total = peaks.length;
  const stride = total / columnCount;
  const columns: number[] = [];
  for (let col = 0; col < columnCount; col += 1) {
    const start = Math.floor(col * stride);
    let end = Math.floor((col + 1) * stride);
    if (end <= start) end = start + 1;
    let peak = 0;
    for (let i = start; i < end && i < total; i += 1) {
      const v = Math.abs(peaks[i]);
      if (v > peak) peak = v;
    }
    columns.push(peak);
  }
  return columns;
}

/**
 * Render the waveform onto a 2D canvas context.
 *
 * Safe to call with a null context (no-op) and with an empty peaks array
 * (draws a flat baseline placeholder rather than throwing) so callers can wire
 * it directly to loading / degraded states.
 *
 * @param ctx Canvas 2D context (or null while the ref is unmounted).
 * @param peaks Full normalized peaks for the material (NOT pre-sliced).
 * @param options Layout + clip-interval + style options.
 */
export function drawWaveform(
  ctx: CanvasRenderingContext2D | null,
  peaks: number[],
  options: DrawWaveformOptions,
): void {
  if (!ctx) return;

  const {
    width,
    height,
    peaksPerSecond,
    clipStart,
    clipEnd,
    color = DEFAULT_COLOR,
    barWidth = DEFAULT_BAR_WIDTH,
    barGap = DEFAULT_BAR_GAP,
  } = options;

  if (width <= 0 || height <= 0) return;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;

  const midY = height / 2;
  const sliced = slicePeaksForClip(
    peaks ?? [],
    peaksPerSecond,
    clipStart,
    clipEnd,
  );

  // Degraded / empty → flat baseline placeholder (1px center line).
  if (sliced.length === 0) {
    ctx.fillRect(0, midY - 0.5, width, 1);
    return;
  }

  const step = Math.max(1, barWidth + barGap);
  const columnCount = Math.max(1, Math.floor(width / step));
  const columns = mapPeaksToColumns(sliced, columnCount);

  for (let col = 0; col < columns.length; col += 1) {
    const amplitude = Math.min(1, Math.max(0, columns[col]));
    // At least 1px so even quiet columns remain visible.
    const barHeight = Math.max(1, amplitude * height);
    const x = col * step;
    const y = midY - barHeight / 2;
    ctx.fillRect(x, y, barWidth, barHeight);
  }
}
