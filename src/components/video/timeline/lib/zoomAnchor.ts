/**
 * zoomAnchor — keep one time under a fixed viewport offset across a zoom.
 *
 * Both scroll containers (ruler ticks, track lanes) place time `t` at
 * `t * pixelsPerSecond - scrollLeft` from the lane origin, so the scrollLeft
 * that keeps `timeAtAnchor` under `anchorOffsetPx` at the new scale follows
 * directly. The browser clamps the upper bound; the lower one is clamped here.
 */
export interface ZoomAnchorInput {
  timeAtAnchor: number;
  anchorOffsetPx: number;
  pixelsPerSecond: number;
}

export function computeAnchoredScrollLeft({
  timeAtAnchor,
  anchorOffsetPx,
  pixelsPerSecond,
}: ZoomAnchorInput): number {
  return Math.max(0, timeAtAnchor * pixelsPerSecond - anchorOffsetPx);
}
