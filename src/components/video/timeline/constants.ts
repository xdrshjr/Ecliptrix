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
