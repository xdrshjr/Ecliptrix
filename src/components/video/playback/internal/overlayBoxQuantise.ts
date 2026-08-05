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
 * Round DOWN to an even number — the landing grid FFmpeg's `overlay` snaps its
 * origin to.
 *
 * Measured, not read from documentation (L-Q4): `results/ffmpeg-overlay-
 * alignment.json` records 144/144 agreement on the dev build AND the packaged
 * 8.1.1, including 72 negative-origin samples. `overlay=5:5` of an 11×11 rect
 * lands at 4,4 and is still 11×11 — the ORIGIN snaps, the SIZE does not. The
 * negative branch floors AWAY from zero (-5 → -6), which is why this cannot be
 * `Math.trunc`.
 *
 * `Math.floor(v / 2) * 2` rather than `v & ~1`: equivalent over this domain, but
 * `&` coerces to int32, and a cross-language contract should not rest on two
 * languages' integer models agreeing. Python twin: `_floor_even`.
 */
function floorEven(value: number): number {
  return Math.floor(value / 2) * 2;
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
 * The truncated origin is then snapped DOWN to even (`floorEven`), because that
 * is where `overlay` actually renders it. Q1 showed both sides already agreed on
 * the numbers in the command; Q2 rendered that command and still found the
 * picture 1px away, because "the command says 537" and "the pixels are at 536"
 * were two different statements. Folding the snap in makes the command state
 * where the picture really lands, so the preview can draw on the same pixel.
 * Exported pixels do not move — FFmpeg was already snapping.
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
    x: floorEven(Math.trunc(pos.x * outW)) / outW,
    y: floorEven(Math.trunc(pos.y * outH)) / outH,
    w: boxW / outW,
    h: boxH / outH,
  };
}

/**
 * Contain-fit a natural-sized picture inside a box, reproducing FFmpeg's
 * `scale=…:force_original_aspect_ratio=decrease` + `pad=…:(ow-iw)/2:(oh-ih)/2`
 * integer arithmetic **as the production pixel-format chain resolves it**.
 *
 * The rule is MEASURED, not read from documentation (L-Q4), and it was measured
 * TWICE because the first measurement used the wrong chain. E0-b had to append
 * `format=gray` to make `bbox` readable, and gray has no chroma subsampling; the
 * production chain is a PNG negotiated to `yuva420p` overlaid on a `yuv420p`
 * frame, where `hsub = vsub = 1`. Under subsampling both the scaled size and the
 * centring offset floor to the even grid, so the gray table is off by up to 1px
 * per axis on exactly the boxes this round exists to fix. `results/e0b-pad-snap-
 * {dev,packaged}.json` records 15/15 agreement with the rule below on both FFmpeg
 * majors, with 12 of the 15 discriminating against the gray table.
 *
 * Three results are counter-intuitive enough to be worth stating: a box with the
 * SAME ratio as the picture still loses pixels (1920×1080 into 634×356 yields
 * 632×356, not 634 and not the gray table's 633); centring is `floor`, not
 * rounding; and the floored offset is then floored AGAIN to even, so a 149px
 * centring offset lands at 148.
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
  const rawW = Math.min(boxW, roundHalfAway((boxH * natW) / natH));
  const rawH = Math.min(boxH, roundHalfAway((boxW * natH) / natW));
  // The offset is centred on the RAW size and only then snapped — not centred on
  // the snapped size. The two readings differ by 2px exactly when the raw offset
  // is odd, which is why 20 probe combinations were needed to tell them apart and
  // why Q2's two vertically-clipped fixtures found it when 16 could not.
  return {
    x: floorEven(Math.floor((boxW - rawW) / 2)),
    y: floorEven(Math.floor((boxH - rawH) / 2)),
    w: floorEven(rawW),
    h: floorEven(rawH),
  };
}
