/** Extra time (in seconds) appended beyond the longest track item so the user always has room to scroll and place clips. */
export const TIMELINE_PADDING_SECONDS = 10;

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 200;
export const VOLUME_DEFAULT = 100;

/**
 * Clamp a volume value to the supported range [VOLUME_MIN, VOLUME_MAX].
 * Non-finite / non-number inputs fall back to VOLUME_DEFAULT. Intentional
 * 180% etc. gains are preserved — only bad data snaps to the default.
 */
export function clampVolume(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return VOLUME_DEFAULT;
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, v));
}

// ---------------------------------------------------------------------------
// Track heights (pixels). Single source of truth for default track height
// per semantic kind. image-tracks carry internal type='video' but a distinct
// height profile — keyed by kind, not type.
// ---------------------------------------------------------------------------
export const TRACK_HEIGHT = {
  video:    80,
  image:    60,
  audio:    60,
  subtitle: 50,
} as const;
export type TrackKind = keyof typeof TRACK_HEIGHT;
export function getDefaultTrackHeight(kind: TrackKind): number {
  return TRACK_HEIGHT[kind];
}

// ---------------------------------------------------------------------------
// Zoom (Timeline ruler)
// ---------------------------------------------------------------------------
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5.0;
export const ZOOM_STEP_BTN = 1.5;    // multiplicative step for zoom in/out buttons
export const ZOOM_STEP_WHEEL = 1.15; // multiplicative step for Ctrl+wheel
export const ZOOM_EPSILON = 1e-6;    // float comparison tolerance at boundaries
