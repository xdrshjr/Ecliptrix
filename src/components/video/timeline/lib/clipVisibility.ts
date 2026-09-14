/**
 * clipVisibility — is a clip fully readable in the track viewport?
 *
 * The track header column is sticky, so it covers the first `headerWidth`
 * px of the viewport: a clip under it is not visible even though it lies
 * inside the scroll container's box. Coordinates are scroll-content px.
 */
export interface ClipVisibilityInput {
  elLeft: number;
  elRight: number;
  scrollLeft: number;
  clientWidth: number;
  headerWidth: number;
}

export function isClipVisibleInLane({
  elLeft,
  elRight,
  scrollLeft,
  clientWidth,
  headerWidth,
}: ClipVisibilityInput): boolean {
  return elLeft >= scrollLeft + headerWidth && elRight <= scrollLeft + clientWidth;
}
