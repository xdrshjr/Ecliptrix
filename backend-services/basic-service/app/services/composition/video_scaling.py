"""Aspect-ratio resolution + per-clip scale/pad filter math (spec 05 §2.5).

Extracted verbatim (behaviour-preserving) from VideoCompositionService so the
orchestrator stays under the file-size cap. These are pure functions: given the
source/target dimensions they compute the letterbox/pillarbox geometry and the
FFmpeg ``-vf`` string. No I/O, no instance state — the only side effect is
logging, which mirrors the original method logging.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from app.logger import get_logger
from app.models import AspectRatio
from app.services.composition.canvas_fit import (
    FIT_BLUR,
    FIT_CONTAIN,
    FIT_COVER,
    CanvasFitError,
    blur_graph,
    cover_steps,
    require_fit_mode,
)

logger = get_logger(__name__)


# Canonical output resolution per aspect ratio. Mirrors the preview canvas so
# export geometry matches what the editor shows.
_ASPECT_RATIO_MAP: Dict[AspectRatio, Dict[str, Any]] = {
    AspectRatio.RATIO_16_9: {"width": 1920, "height": 1080, "ratio": 16 / 9, "name": "16:9"},
    AspectRatio.RATIO_9_16: {"width": 1080, "height": 1920, "ratio": 9 / 16, "name": "9:16"},
    AspectRatio.RATIO_4_3: {"width": 1440, "height": 1080, "ratio": 4 / 3, "name": "4:3"},
    AspectRatio.RATIO_1_1: {"width": 1080, "height": 1080, "ratio": 1 / 1, "name": "1:1"},
    AspectRatio.RATIO_21_9: {"width": 2560, "height": 1080, "ratio": 21 / 9, "name": "21:9"},
}


def get_aspect_ratio_info(aspect_ratio: AspectRatio) -> Dict[str, Any]:
    """Return resolution + ratio metadata for an aspect ratio (default 16:9)."""
    return _ASPECT_RATIO_MAP.get(aspect_ratio, _ASPECT_RATIO_MAP[AspectRatio.RATIO_16_9])


def ensure_even_dimensions(width: int, height: int) -> Tuple[int, int]:
    """Round dimensions up to the next even number (H.264 requires even)."""
    even_width = width if width % 2 == 0 else width + 1
    even_height = height if height % 2 == 0 else height + 1
    return even_width, even_height


def _direct_scale_params(target_width: int, target_height: int) -> Dict[str, Any]:
    """Scale params when source and target share an aspect ratio (no padding)."""
    even_target_width, even_target_height = ensure_even_dimensions(target_width, target_height)
    return {
        "scale_width": even_target_width,
        "scale_height": even_target_height,
        "pad_width": even_target_width,
        "pad_height": even_target_height,
        "pad_x": 0,
        "pad_y": 0,
        "needs_padding": False,
    }


def calculate_video_scaling(
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
    fit_mode: str = FIT_CONTAIN,
) -> Dict[str, Any]:
    """Compute scale + pad params preserving aspect ratio (letter/pillarbox).

    Args:
        source_width: Original video width.
        source_height: Original video height.
        target_width: Target output width.
        target_height: Target output height.
        fit_mode: canvas fit (spec r2 §3.9). ``contain`` returns exactly the
            pre-feature dict; ``cover`` / ``blur`` add the ``cover_*`` rect
            and ``fit_mode`` keys on top of it.

    Returns:
        Dict of scale/pad parameters consumed by :func:`build_video_filter`.
    """
    require_fit_mode(fit_mode)
    params = _contain_scaling(
        source_width, source_height, target_width, target_height
    )
    if fit_mode == FIT_CONTAIN:
        return params
    cover = _cover_rect(
        source_width, source_height,
        params["pad_width"], params["pad_height"],
    )
    return {**params, **cover, "fit_mode": fit_mode}


def _rescale(value: int, numerator: int, denominator: int) -> int:
    """``value × numerator / denominator`` rounded half up (``av_rescale``)."""
    return (value * numerator + denominator // 2) // denominator


def _cover_rect(
    source_width: int, source_height: int, frame_width: int, frame_height: int
) -> Dict[str, int]:
    """The enlarged rect ``scale=…:force_original_aspect_ratio=increase`` makes.

    Mirrors FFmpeg's own arithmetic so the geometry the tests compare against
    the preview is the geometry the export really renders. The offsets are
    negative: the rect overhangs the frame and ``crop`` centres it.
    """
    cover_width = max(
        _rescale(frame_height, source_width, source_height), frame_width
    )
    cover_height = max(
        _rescale(frame_width, source_height, source_width), frame_height
    )
    return {
        "cover_width": cover_width,
        "cover_height": cover_height,
        "cover_x": -((cover_width - frame_width) // 2),
        "cover_y": -((cover_height - frame_height) // 2),
    }


def _contain_scaling(
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
) -> Dict[str, Any]:
    """Today's letter/pillarbox geometry, unchanged (the ``contain`` fit)."""
    source_ratio = source_width / source_height
    target_ratio = target_width / target_height

    logger.info(
        f"Calculating scaling: source={source_width}x{source_height} (ratio={source_ratio:.3f}), "
        f"target={target_width}x{target_height} (ratio={target_ratio:.3f})"
    )

    if abs(source_ratio - target_ratio) < 0.01:  # Same aspect ratio
        # Direct scaling - ensure dimensions are even
        return _direct_scale_params(target_width, target_height)

    return _boxed_scale_params(
        source_ratio, target_ratio, target_width, target_height
    )


def _boxed_scale_params(
    source_ratio: float,
    target_ratio: float,
    target_width: int,
    target_height: int,
) -> Dict[str, Any]:
    """Scale + pad params for letterboxing (wider source) / pillarboxing."""
    if source_ratio > target_ratio:
        # Source is wider - need horizontal letterboxing (black bars top/bottom)
        scale_width = target_width
        scale_height = int(target_width / source_ratio)
    else:
        # Source is taller - need vertical pillarboxing (black bars left/right)
        scale_height = target_height
        scale_width = int(target_height * source_ratio)

    # Ensure all dimensions are even for H.264 encoding
    even_scale_width, even_scale_height = ensure_even_dimensions(scale_width, scale_height)
    even_target_width, even_target_height = ensure_even_dimensions(target_width, target_height)

    # Recalculate padding with even dimensions
    if source_ratio > target_ratio:
        pad_x = 0
        pad_y = (even_target_height - even_scale_height) // 2
    else:
        pad_x = (even_target_width - even_scale_width) // 2
        pad_y = 0

    logger.info(
        f"Scaling result: scale={even_scale_width}x{even_scale_height}, "
        f"pad=({pad_x},{pad_y}), final={even_target_width}x{even_target_height}"
    )

    return {
        "scale_width": even_scale_width,
        "scale_height": even_scale_height,
        "pad_width": even_target_width,
        "pad_height": even_target_height,
        "pad_x": pad_x,
        "pad_y": pad_y,
        "needs_padding": True,
    }


def build_video_filter(
    scaling_params: Dict[str, Any],
    camera_chain: str = "",
    fit_mode: str = FIT_CONTAIN,
) -> str:
    """Build the FFmpeg ``-vf`` string for the given scale/pad params.

    ``fit_mode`` (spec r2 §3.9.3): ``contain`` takes the pre-feature code path
    below untouched. ``cover`` / ``blur`` need ``scaling_params`` computed with
    the same mode and raise :class:`CanvasFitError` otherwise — never a quiet
    ``contain`` render. A same-aspect source fills the frame in every mode, so
    it keeps the plain scale string (``contain`` stretches a <1% mismatch).

    ``camera_chain`` (camera-motion-2d-3d D4) is injected immediately AFTER
    ``scale`` and BEFORE ``pad``/``setsar``. That position is the whole WYSIWYG
    guarantee: at that point the frame is the "content rect", exactly what the
    preview's fit-rect is, so the motion acts on the picture rather than on a
    canvas that already has black bars baked in.

    BOTH return branches inject it (review P1-3) — the no-padding branch is the
    common case for a same-aspect source and would otherwise silently drop the
    motion. With ``camera_chain == ""`` both branches produce output that is
    CHARACTER-IDENTICAL to the pre-feature function (the zero-regression
    guarantee, asserted per-branch in the tests).
    """
    require_fit_mode(fit_mode)
    if fit_mode != FIT_CONTAIN and scaling_params["needs_padding"]:
        return _build_fill_filter(scaling_params, camera_chain, fit_mode)

    camera_part = f",{camera_chain}" if camera_chain else ""

    if not scaling_params["needs_padding"]:
        # Simple scaling
        return (
            f'scale={scaling_params["scale_width"]}:{scaling_params["scale_height"]}'
            f'{camera_part},setsar=1:1'
        )

    # Scale + pad for letterboxing/pillarboxing
    scale_filter = f'scale={scaling_params["scale_width"]}:{scaling_params["scale_height"]}'
    pad_filter = (
        f'pad={scaling_params["pad_width"]}:{scaling_params["pad_height"]}:'
        f'{scaling_params["pad_x"]}:{scaling_params["pad_y"]}:black'
    )

    return f"{scale_filter}{camera_part},{pad_filter},setsar=1:1"


def camera_frame_size(scaling_params: Dict[str, Any]) -> Tuple[int, int]:
    """Size of the picture the camera motion acts on (its "content rect").

    ``contain`` / ``blur``: the scaled picture, as before the feature.
    ``cover``: the cropped frame — motion runs after ``crop`` (RV2-08), the
    same rect the preview moves.
    """
    if scaling_params.get("fit_mode") == FIT_COVER and (
        scaling_params["needs_padding"]
    ):
        return scaling_params["pad_width"], scaling_params["pad_height"]
    return scaling_params["scale_width"], scaling_params["scale_height"]


def fit_content_rect(
    scaling_params: Dict[str, Any],
) -> Tuple[int, int, int, int]:
    """``(x, y, width, height)`` of the picture on the canvas.

    For ``cover`` the rect overhangs the canvas (negative offsets).
    """
    if scaling_params.get("fit_mode") == FIT_COVER and (
        scaling_params["needs_padding"]
    ):
        return _cover_tuple(scaling_params)
    return (
        scaling_params["pad_x"], scaling_params["pad_y"],
        scaling_params["scale_width"], scaling_params["scale_height"],
    )


def fit_background_rect(
    scaling_params: Dict[str, Any],
) -> Optional[Tuple[int, int, int, int]]:
    """The blurred background rect of ``blur``; ``None`` in other modes."""
    if scaling_params.get("fit_mode") != FIT_BLUR:
        return None
    if not scaling_params["needs_padding"]:
        return None
    return _cover_tuple(scaling_params)


def _cover_tuple(scaling_params: Dict[str, Any]) -> Tuple[int, int, int, int]:
    return (
        scaling_params["cover_x"], scaling_params["cover_y"],
        scaling_params["cover_width"], scaling_params["cover_height"],
    )


def _build_fill_filter(
    scaling_params: Dict[str, Any], camera_chain: str, fit_mode: str
) -> str:
    """``-vf`` string of a ``cover`` / ``blur`` fit (spec r2 §3.9.3).

    ``-vf`` accepts a single-input, single-output graph with internal labels,
    so ``blur`` stays a plain string and the "retry without camera" path of
    the caller keeps working unchanged.
    """
    if scaling_params.get("fit_mode") != fit_mode:
        raise CanvasFitError(
            f"Scaling params were computed for "
            f"{scaling_params.get('fit_mode', FIT_CONTAIN)!r}, "
            f"not {fit_mode!r}"
        )
    width = scaling_params["pad_width"]
    height = scaling_params["pad_height"]
    camera_part = f",{camera_chain}" if camera_chain else ""
    if fit_mode == FIT_COVER:
        return ",".join(cover_steps(width, height)) + (
            f"{camera_part},setsar=1:1"
        )
    foreground = (
        f'scale={scaling_params["scale_width"]}:'
        f'{scaling_params["scale_height"]}'
    )
    graph = blur_graph(width, height, foreground, camera_chain)
    return f"{graph},setsar=1:1"
