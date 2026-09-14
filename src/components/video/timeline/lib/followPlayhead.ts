/**
 * followPlayhead — page the timeline view along with a playing playhead.
 *
 * All values are lane coordinates (0 = time 0, header excluded). Paging —
 * jumping so the playhead sits a little in from the left — instead of
 * continuous scrolling keeps clips still while the user watches them.
 */

export interface FollowScrollInput {
  /** Playhead position in the lane, px. */
  playheadPx: number;
  scrollLeft: number;
  /** Visible lane width (viewport minus the sticky track header), px. */
  laneViewportWidth: number;
  maxScrollLeft: number;
  /** The page turns this many px before the right edge. */
  marginPx?: number;
  /** Fraction of the lane left visible before the playhead after a page turn. */
  leadRatio?: number;
}

const DEFAULT_MARGIN_PX = 48;
const DEFAULT_LEAD_RATIO = 0.1;

/** New scrollLeft, or null when the playhead is already comfortably in view. */
export function computeFollowScrollLeft({
  playheadPx,
  scrollLeft,
  laneViewportWidth,
  maxScrollLeft,
  marginPx = DEFAULT_MARGIN_PX,
  leadRatio = DEFAULT_LEAD_RATIO,
}: FollowScrollInput): number | null {
  const viewEnd = scrollLeft + laneViewportWidth - marginPx;
  if (playheadPx >= scrollLeft && playheadPx <= viewEnd) return null;
  const target = playheadPx - laneViewportWidth * leadRatio;
  return Math.min(Math.max(0, maxScrollLeft), Math.max(0, target));
}
