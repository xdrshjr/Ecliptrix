/**
 * EXPORT_RESOLUTIONS — the frontend twin of `video_scaling.py:_ASPECT_RATIO_MAP`,
 * which is the single source of truth for export resolution (DD-3).
 *
 * The preview needs this to quantise overlay boxes onto the export grid, and it
 * must NOT ask the backend at runtime: preview has to work while the composition
 * service is busy or offline. A second copy of a constant always drifts (this
 * repo already did it once — `DEFAULT_POSITION` was 0.8 on the frontend and 0.3
 * on the backend for two iterations), so `overlayBoxQuantise.test.ts` parses the
 * .py table and fails the moment the two disagree.
 *
 * Keys are the `id` strings from `VideoPlayerPanel/aspectRatios.ts`, verified to
 * match the backend `AspectRatio` enum values character for character.
 */

/** One export target: the pixel frame a given aspect ratio renders into. */
export interface ExportResolution {
  /** Aspect-ratio id, e.g. `'16:9'`. */
  id: string;
  width: number;
  height: number;
}

export const EXPORT_RESOLUTIONS: readonly ExportResolution[] = [
  { id: '16:9', width: 1920, height: 1080 },
  { id: '9:16', width: 1080, height: 1920 },
  { id: '4:3', width: 1440, height: 1080 },
  { id: '1:1', width: 1080, height: 1080 },
  { id: '21:9', width: 2560, height: 1080 },
];

/** The backend's fallback when an aspect ratio is unknown (`get_aspect_ratio_info`). */
const DEFAULT_EXPORT_RESOLUTION = EXPORT_RESOLUTIONS[0];

/**
 * Resolve the export frame for an aspect-ratio id, falling back to 16:9 exactly
 * as `get_aspect_ratio_info` does — so an id the frontend fails to recognise
 * still quantises onto the grid the backend will actually use.
 *
 * @param aspectRatioId Aspect-ratio id such as `'9:16'`.
 */
export function resolveExportResolution(
  aspectRatioId: string | null | undefined,
): ExportResolution {
  if (!aspectRatioId) return DEFAULT_EXPORT_RESOLUTION;
  return (
    EXPORT_RESOLUTIONS.find((entry) => entry.id === aspectRatioId) ??
    DEFAULT_EXPORT_RESOLUTION
  );
}
