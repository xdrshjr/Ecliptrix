/**
 * effectiveVolume — the single volume rule shared by preview and export.
 *
 * A clip's audible level is its item volume (a multiplier, default 1) times
 * its track volume (a percentage 0-200, default 100). The backend composition
 * models accept `volume` in [0, 2] (`le=2`), so the product is clamped here;
 * sending an unclamped 4.0 used to fail the whole export with a 422.
 */

/** Upper bound the backend composition models accept for `volume`. */
export const MAX_EFFECTIVE_VOLUME = 2;

const DEFAULT_ITEM_VOLUME = 1;
const DEFAULT_TRACK_VOLUME_PERCENT = 100;

/**
 * item volume (multiplier, default 1) × track volume (percent, default 100),
 * clamped to [0, MAX_EFFECTIVE_VOLUME]. Non-finite inputs fall back to the
 * defaults; a 0% track is silent (it is NOT treated as "unset").
 */
export function computeEffectiveVolume(
  itemVolume: number | undefined,
  trackVolume: number | undefined,
): number {
  const item = Number.isFinite(itemVolume)
    ? (itemVolume as number)
    : DEFAULT_ITEM_VOLUME;
  const track = Number.isFinite(trackVolume)
    ? (trackVolume as number)
    : DEFAULT_TRACK_VOLUME_PERCENT;
  return Math.max(0, Math.min(item * (track / 100), MAX_EFFECTIVE_VOLUME));
}
