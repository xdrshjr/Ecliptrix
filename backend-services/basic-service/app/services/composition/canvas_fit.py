"""Canvas fit filter fragments shared by both export paths (spec r2 §3.9.3).

A video layer can be fitted to the canvas three ways (``contain`` is the
default and today's behaviour; its strings are NOT built here so they stay
character-identical to the pre-feature code):

  - ``cover``: scale up until the frame is covered, then centre-crop.
  - ``blur``: a blurred, darkened ``cover`` copy fills the frame and the
    ``contain`` picture is overlaid in the centre.

Both the per-clip ``-vf`` normalization (``video_scaling``) and the
``-filter_complex`` canvas (``filtergraph_builder``) use these helpers, so the
two paths cannot drift apart. PURE string construction.
"""

from __future__ import annotations

from typing import List, Tuple

FIT_CONTAIN = "contain"
FIT_COVER = "cover"
FIT_BLUR = "blur"
FIT_MODES: Tuple[str, ...] = (FIT_CONTAIN, FIT_COVER, FIT_BLUR)

#: Blur strength at a 1080-pixel-high output; scaled with the output height so
#: the preview (``videoFit.ts``) and the export agree at any resolution.
BLUR_SIGMA_AT_1080 = 20.0
#: Multiplicative brightness of the blurred background. ``colorchannelmixer``
#: multiplies like canvas ``brightness(0.6)``; ``eq=brightness`` would add an
#: offset and drift from the preview in highlights and shadows (RV2-14).
BLUR_BRIGHTNESS = "0.6"


class CanvasFitError(ValueError):
    """A fit filter could not be built.

    Raised instead of quietly rendering ``contain``: an export that differs
    from the preview without a word is the failure this feature must avoid.
    """


def require_fit_mode(fit_mode: str) -> str:
    """Return ``fit_mode`` if it is known, else raise :class:`CanvasFitError`."""
    if fit_mode not in FIT_MODES:
        raise CanvasFitError(f"Unknown canvas fit mode: {fit_mode!r}")
    return fit_mode


def _require_frame(width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        raise CanvasFitError(f"Invalid canvas size for fit: {width}x{height}")


def format_number(value: float) -> str:
    """Short, stable number for filter options (``20``, ``35.5556``)."""
    return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


def blur_sigma(height: int) -> str:
    """Gaussian sigma in output pixels: ``20 × H / 1080`` (same as preview)."""
    return format_number(BLUR_SIGMA_AT_1080 * height / 1080.0)


def cover_steps(width: int, height: int) -> List[str]:
    """Scale-to-cover then centre-crop to exactly ``width``×``height``."""
    _require_frame(width, height)
    return [
        f"scale={width}:{height}:force_original_aspect_ratio=increase",
        f"crop={width}:{height}:(iw-{width})/2:(ih-{height})/2",
    ]


def blur_graph(
    width: int,
    height: int,
    foreground_scale: str,
    camera_chain: str = "",
    labels: Tuple[str, str, str] = ("", "", ""),
) -> str:
    """The labelled ``split`` / ``overlay`` sub-graph of the ``blur`` fit.

    Args:
        width / height: canvas size.
        foreground_scale: the ``scale=…`` step that contain-fits the picture.
        camera_chain: camera motion, applied to the foreground content rect.
        labels: ``(input, output, prefix)``. Empty input/output leave the pads
            unlabelled so the string works as a ``-vf`` graph; the prefix keeps
            the internal labels unique inside one ``-filter_complex``.
    """
    _require_frame(width, height)
    if not foreground_scale:
        raise CanvasFitError("Blur fit needs a foreground scale step")
    in_label, out_label, prefix = labels
    source = f"[{in_label}]" if in_label else ""
    sink = f"[{out_label}]" if out_label else ""
    bg, fg = f"[{prefix}bg]", f"[{prefix}fg]"
    blurred, content = f"[{prefix}bgb]", f"[{prefix}fgs]"
    camera = f",{camera_chain}" if camera_chain else ""
    mix = BLUR_BRIGHTNESS
    background = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},gblur=sigma={blur_sigma(height)},"
        f"colorchannelmixer=rr={mix}:gg={mix}:bb={mix}"
    )
    return (
        f"{source}split=2{bg}{fg};"
        f"{bg}{background}{blurred};"
        f"{fg}{foreground_scale}{camera}{content};"
        f"{blurred}{content}overlay=(W-w)/2:(H-h)/2{sink}"
    )
