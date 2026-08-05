"""Camera motion for the IMAGE-OVERLAY pass (stills / Ken Burns).

Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §3.3.

Two things make the overlay pass different from the video filtergraph, and
nothing else does:

1. **The box.** A video clip's move acts on the whole canvas; a still's acts on
   its placement box. Before the overlay, FFmpeg has already turned the picture
   into a box-sized frame (``scale:force_original_aspect_ratio=decrease`` +
   a transparent ``pad``), so ``perspective`` receives a frame whose origin IS
   the box's top-left. The four corners are therefore emitted in BOX space —
   exactly what the preview's ``cameraBoxHomography`` produces.
2. **The clock.** The overlay pass runs over the FINISHED video, so its time
   origin is the composition's 0s rather than the clip's. Progress is
   ``clip(((on-1)/fps - start_time) / duration, 0, 1)`` — the same kernel with
   one extra constant subtracted (H2).

Everything else — the easing cubics, the symbolic constant folding, the register
hoisting, the raster corner order, the ``max(scale, …)`` / ``max(dolly, …)``
guards — is REUSED from :mod:`camera_motion_filters`. A second implementation of
any of it is how "preview and export disagree" starts.

Deliberately NOT emitted (proven redundant on real FFmpeg during review, P1-8):
``pad(margin)`` + ``crop`` around ``perspective`` (a no-op under scheme A —
revealing the layer below is done by ALPHA, not by margin) and ``format=yuva420p``
(the existing ``pad=…:black@0`` already yields a genuinely transparent border and
``overlay`` negotiates an alpha format regardless). Dropping them also removes an
entire class of coordinate-system bug: with a pad, every corner would have to
carry a ``+margin`` offset, and forgetting it shifts the whole picture by 16px —
a defect that reads as "slightly blurry" in SSIM and is nearly unattributable.

PURE: string/maths only — no subprocess, no filesystem, no FFmpeg invocation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, List, Optional, Tuple

from .camera_motion import (
    PERSPECTIVE_FOCAL_RATIO,
    CameraMotionPlan,
    plan_from_spec,
    state_at,
)
from .camera_motion_filters import (
    CameraMotionUnsupportedError,
    _const,
    _corner_expressions,
    _field_symbols,
    _fmt,
    _hoisted_terms,
    _progress_expression,
    _quote,
)


@dataclass(frozen=True)
class OverlayBox:
    """The still's placement box in output pixels (already made even)."""

    width: int
    height: int


@dataclass(frozen=True)
class OverlayTiming:
    """Where the still sits on the COMPOSITION timeline, in seconds."""

    start_time: float
    duration: float

    @property
    def end_time(self) -> float:
        return self.start_time + max(self.duration, 0.0)


@dataclass(frozen=True)
class OverlayMotion:
    """One still's emitted motion, ready to splice into the overlay chain."""

    #: Filter text to append after the ``pad`` (empty string when there is none).
    filter_text: str = ""
    #: Input options to prepend before this image's ``-i`` (empty when none).
    input_options: List[str] = field(default_factory=list)
    #: Non-fatal degradations to surface to the user. NEVER swallow these.
    warnings: List[str] = field(default_factory=list)

    @property
    def is_animated(self) -> bool:
        return bool(self.input_options)


def _resolve_caps(caps: Any) -> Tuple[bool, bool]:
    """(has_perspective, supports per-frame evaluation). ``None`` = full support."""
    if caps is None:
        return True, True
    return (
        bool(getattr(caps, "has_perspective", True)),
        bool(getattr(caps, "perspective_supports_eval_frame", True)),
    )


def build_overlay_motion_filter(
    plan: CameraMotionPlan,
    box: OverlayBox,
    timing: OverlayTiming,
    fps: float,
    caps: Any = None,
) -> OverlayMotion:
    """Build the ``perspective`` step that reproduces ``plan`` on a still.

    Args:
        plan: The camera move.
        box: The still's placement box in output pixels.
        timing: The still's window on the composition timeline.
        fps: Frames per second of the overlay pass — the MEASURED rate of its
            input file, not the requested one. ``on`` counts frames of this
            branch, so a wrong divisor makes the whole move run uniformly fast
            or slow, which a per-frame SSIM barely registers (L3).
        caps: FFmpeg capability probe. ``None`` assumes full support.

    Returns:
        The filter text, the input options that make the still a per-frame
        stream, and any warnings.

    Raises:
        CameraMotionUnsupportedError: this FFmpeg has no ``perspective`` filter,
            so the move cannot be rendered at all and the export must fail
            loudly rather than ship a motionless still.
    """
    width, height = int(box.width), int(box.height)
    if width <= 0 or height <= 0:
        return OverlayMotion()

    has_perspective, animated = _resolve_caps(caps)
    if not has_perspective:
        raise CameraMotionUnsupportedError(
            "This FFmpeg build has no 'perspective' filter, which camera motion "
            "requires. Install FFmpeg 4.0+ with the standard filter set, or "
            "remove the camera motion from the affected image clips."
        )

    rate = float(fps) if fps and fps > 0 else 30.0
    warnings: List[str] = []
    box_aspect = width / height if height else 16.0 / 9.0

    if animated:
        prefix = (
            _progress_expression(plan, timing.duration, rate, timing.start_time) + ";"
        )
        # `enforce_coverage=False`: the box is an overlay, and the transparent
        # ring around a panned still is the intended result (§3.1.1).
        fields = _field_symbols(plan, box_aspect, "ld(0)", enforce_coverage=False)
    else:
        midpoint = state_at(
            plan, timing.duration, timing.duration / 2.0, box_aspect, enforce_coverage=False
        )
        prefix = ""
        fields = {
            "scale": _const(midpoint.scale),
            "offset_x": _const(midpoint.offset_x),
            "offset_y": _const(midpoint.offset_y),
            "roll": _const(math.radians(midpoint.roll)),
            "yaw": _const(math.radians(midpoint.yaw)),
            "pitch": _const(math.radians(midpoint.pitch)),
            "dolly": _const(midpoint.dolly),
        }
        warnings.append(
            "camera_motion_static: this FFmpeg build cannot evaluate filter "
            "expressions per frame (perspective lacks eval=frame), so the image "
            "camera move was rendered as a single fixed framing."
        )

    geometry = {
        "focal": PERSPECTIVE_FOCAL_RATIO * float(max(width, height)),
        "width": float(width),
        "height": float(height),
        # Box space: the origin of the frame `perspective` receives is the box's
        # own top-left, so the centre is simply half the box. No margin term —
        # see the module docstring.
        "origin_x": width / 2.0,
        "origin_y": height / 2.0,
    }
    corners = (
        (-(width / 2.0), -(height / 2.0)),
        (width / 2.0, -(height / 2.0)),
        (width / 2.0, height / 2.0),
        (-(width / 2.0), height / 2.0),
    )

    terms, trig_prefix = _hoisted_terms(fields, animated)
    prefix += trig_prefix

    points = [_corner_expressions(terms, geometry, du, dv) for du, dv in corners]
    # Clockwise [TL,TR,BR,BL] -> FFmpeg raster order [TL,TR,BL,BR] (R-P0-2/L12).
    raster = [points[0], points[1], points[3], points[2]]
    options: List[str] = []
    for slot, (x_expr, y_expr) in enumerate(raster):
        options.append(f"x{slot}={_quote(prefix + x_expr)}")
        options.append(f"y{slot}={_quote(prefix + y_expr)}")
    options.append("sense=destination")
    options.append(f"eval={'frame' if animated else 'init'}")
    options.append("interpolation=cubic")

    return OverlayMotion(
        filter_text="perspective=" + ":".join(options),
        input_options=_input_options(timing, rate) if animated else [],
        warnings=warnings,
    )


def _input_options(timing: OverlayTiming, fps: float) -> List[str]:
    """Turn a single still image into a per-frame stream at ``fps``.

    Without this the image branch carries exactly ONE frame, so ``on`` never
    advances, ``eval=frame`` evaluates once and the "animation" is a single
    frozen framing — the same silent-no-op class of bug this whole feature
    exists to remove. ``-t`` bounds the generated frames at the still's own end
    (plus one frame of slack, so the last visible frame exists), which keeps a
    long timeline from decoding frames nobody will ever see.
    """
    end = timing.end_time + 2.0 / max(fps, 1.0)
    return ["-loop", "1", "-framerate", _fmt(fps), "-t", _fmt(end)]


def overlay_motion_for_item(
    item: Any,
    box: OverlayBox,
    timing: OverlayTiming,
    fps: float,
    caps: Any = None,
) -> OverlayMotion:
    """The overlay motion for one composition item, or an empty one.

    This is the SINGLE emitter both overlay assembly points call. They are two
    near-identical copies of the same chain-building code (with subtitles /
    without), and the failure mode of emitting from each of them separately is
    "the move works only when the timeline happens to have a subtitle" — the
    hardest kind of bug to even reproduce (L1).

    Args:
        item: The composition item; its ``camera_motion`` is read reflectively so
            both pydantic models and plain mappings work.
        box: The still's placement box in output pixels.
        timing: The still's window on the composition timeline.
        fps: Measured frame rate of the overlay pass input.
        caps: FFmpeg capability probe. ``None`` assumes full support.

    Returns:
        An empty :class:`OverlayMotion` when the item carries no move — which is
        what keeps a motionless timeline's command line byte-identical to the
        pre-feature output (N4-②).
    """
    spec = getattr(item, "camera_motion", None)
    if spec is None and isinstance(item, dict):
        spec = item.get("camera_motion")
    plan: Optional[CameraMotionPlan] = plan_from_spec(spec)
    if plan is None:
        return OverlayMotion()
    return build_overlay_motion_filter(plan, box, timing, fps, caps)
