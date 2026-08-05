/**
 * overlayBoxQuantise — the ONE TypeScript implementation of the export-side
 * overlay-box grid (camera-motion-box-parity plan §4.1, DD-1/DD-2/DD-4/DD-9).
 *
 * Python twin: `backend-services/basic-service/app/services/composition/
 * overlay_box.py`. Both are pinned to the same golden vectors in
 * `docs/plans/camera-motion-box-parity-and-desktop-walkthrough/fixtures/
 * overlay-box-golden.json`, so a change to one that is not mirrored in the other
 * turns both test suites red rather than drifting silently.
 *
 * WHY the preview quantises at all: export cannot go floating-point (FFmpeg
 * arguments are integers and H.264 wants even dimensions), so the export grid is
 * the truth and the preview aligns to it (DD-1). Doing this in NORMALISED space
 * against the OUTPUT resolution — never the preview canvas, which is a display
 * size like 853×480 and cannot reproduce a 1920×1080 grid — makes the two sides
 * identical by construction instead of identical on a hand-picked fixture (DD-2).
 */

/** Normalized [0,1]-ish overlay position; `x + width` may exceed 1 (DD-9). */
export interface OverlayBoxPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box in normalized space, already snapped to the output pixel grid. */
export interface NormalisedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rect in OUTPUT pixels, relative to the box's top-left corner. */
export interface ContainRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Round up to the next even number — the twin of `video_scaling
 * .ensure_even_dimensions` (odd → +1). Kept branch-identical for negatives too:
 * JS `-95 % 2 === -1` and Python `-95 % 2 == 1` both test truthy, so both yield
 * -94 and the languages agree even on inputs production never produces.
 */
function ensureEven(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}

/** `av_rescale` semantics: round half away from zero. */
function roundHalfAway(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
}

/**
 * Snap a normalized overlay position onto the export pixel grid.
 *
 * Mirrors `_overlay_placement` exactly, INCLUDING its asymmetry: the origin is
 * truncated (`int()`), while the size is truncated and then rounded UP to even.
 * Those two round in opposite directions, so the error does not cancel — which
 * is precisely why the preview has to replay the rule rather than approximate it.
 *
 * `Math.trunc` (not `Math.floor`) is required: Python's `int()` truncates toward
 * zero, and negative origins are a real case (an image dragged off the left
 * edge). The multiplication order `pos.x * outW` is also part of the contract —
 * both sides are IEEE754 doubles, so the same expression yields the same double
 * and the truncation agrees bit-for-bit.
 *
 * DD-9 — the output is deliberately NOT clamped: no `clamp01`, no
 * `Math.min(w, 1 - x)`. Clamping is a preview-only habit; export lets `overlay`
 * crop at the frame edge. Clamping here would put the preview back at odds with
 * the shipped file by up to ~295px on a box dragged past the right edge.
 *
 * @param pos  Normalized position (may be out of bounds or negative).
 * @param outW Output frame width in pixels (e.g. 1920).
 * @param outH Output frame height in pixels (e.g. 1080).
 * @returns The same box in normalized space, snapped to the output grid.
 */
export function quantiseOverlayBoxNormalised(
  pos: OverlayBoxPosition,
  outW: number,
  outH: number,
): NormalisedBox {
  if (!(outW > 0) || !(outH > 0)) {
    return { x: pos.x, y: pos.y, w: pos.width, h: pos.height };
  }
  const boxW = ensureEven(Math.trunc(pos.width * outW));
  const boxH = ensureEven(Math.trunc(pos.height * outH));
  return {
    x: Math.trunc(pos.x * outW) / outW,
    y: Math.trunc(pos.y * outH) / outH,
    w: boxW / outW,
    h: boxH / outH,
  };
}

/**
 * Contain-fit a natural-sized picture inside a box, reproducing FFmpeg's
 * `scale=…:force_original_aspect_ratio=decrease` + `pad=…:(ow-iw)/2:(oh-ih)/2`
 * integer arithmetic.
 *
 * The rule is MEASURED, not read from documentation (L-Q4): E0-b ran 16 real
 * FFmpeg combinations on both the dev build and the packaged 8.1.1 and got the
 * same table (`results/e0b-contain-*.json`). Two results are counter-intuitive
 * enough to be worth stating: a box with the SAME ratio as the picture still
 * loses a pixel (1920×1080 into 634×356 yields 633×356), and centring is `floor`,
 * not rounding, so a 1px gap sits entirely on the right (`pad_x = 0`).
 *
 * EVALUATION SPACE (contract — violating it silently breaks parity): `boxW` and
 * `boxH` MUST be OUTPUT pixel integers, and the returned rect is in OUTPUT pixel
 * space relative to the box origin. Callers drawing on the preview canvas scale
 * the result by `previewW / outW` AFTER this call. Passing preview-pixel sizes in
 * would round on the wrong grid and put the image off by whole pixels.
 *
 * @param natW Natural (decoded) picture width.
 * @param natH Natural picture height.
 * @param boxW Box width in OUTPUT pixels.
 * @param boxH Box height in OUTPUT pixels.
 * @returns Contain rect in OUTPUT pixels, relative to the box's top-left.
 */
export function containRectInBox(
  natW: number,
  natH: number,
  boxW: number,
  boxH: number,
): ContainRect {
  if (!(natW > 0) || !(natH > 0) || !(boxW > 0) || !(boxH > 0)) {
    return { x: 0, y: 0, w: boxW, h: boxH };
  }
  const w = Math.min(boxW, roundHalfAway((boxH * natW) / natH));
  const h = Math.min(boxH, roundHalfAway((boxW * natH) / natW));
  return { x: Math.floor((boxW - w) / 2), y: Math.floor((boxH - h) / 2), w, h };
}
