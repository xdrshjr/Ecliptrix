"""FFmpeg filter emission for camera motion (2D / 3D 运镜).

Plan: docs/plans/timeline-camera-motion/experiment-plan.md §4.3.

Split out of :mod:`camera_motion`, which stayed the pure geometry kernel — the
half that must stay byte-compatible with the TypeScript twin and the golden
vectors. This half knows about FFmpeg: expression registers, the raster corner
order ``perspective`` names its points in, the transparent backdrop, and the
capability ladder. Nothing here is consumed by the parity tests, and nothing in
the kernel imports it, so the two can be reviewed independently.

PURE: string/maths only — no subprocess, no filesystem, no FFmpeg invocation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, List, Optional, Tuple

from .camera_motion import (
    PERSPECTIVE_FOCAL_RATIO,
    TIME_EPSILON,
    CameraMotionPlan,
    _MIN_DOLLY,
    _MIN_SCALE,
    _apply_intensity,
    backdrop_margin,
    ensure_coverage,
    state_at,
)

#: Fully transparent pad colour. RGB 0 means "black once alpha is dropped", so a
#: bottom track's revealed area matches the preview's black letterbox exactly.
TRANSPARENT_BACKDROP = "#00000000"

@dataclass(frozen=True)
class _Sym:
    """A scalar that is either known at build time or an FFmpeg expression.

    Folding constants is not an optimisation for its own sake: a 2D move with a
    fixed roll collapses to ``A + B*E`` per coordinate, which is both exact and
    an order of magnitude shorter than the general projective form. Short
    expressions are what keep the whole ``-filter_complex`` inside the Windows
    ``CreateProcess`` command-line limit (L7).
    """

    const: Optional[float]
    text: str


def _fmt(value: float) -> str:
    """Render a float compactly without scientific notation FFmpeg can't parse."""
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    rendered = f"{value:.6f}".rstrip("0").rstrip(".")
    return rendered if rendered not in ("", "-") else "0"


def _const(value: float) -> _Sym:
    return _Sym(const=value, text=_fmt(value))


def _expr(text: str) -> _Sym:
    return _Sym(const=None, text=text)


def _add(a: _Sym, b: _Sym) -> _Sym:
    if a.const is not None and b.const is not None:
        return _const(a.const + b.const)
    if a.const is not None and a.const == 0:
        return b
    if b.const is not None and b.const == 0:
        return a
    return _expr(f"({a.text}+{b.text})")


def _sub(a: _Sym, b: _Sym) -> _Sym:
    if a.const is not None and b.const is not None:
        return _const(a.const - b.const)
    if b.const is not None and b.const == 0:
        return a
    return _expr(f"({a.text}-{b.text})")


def _mul(a: _Sym, b: _Sym) -> _Sym:
    if a.const is not None and b.const is not None:
        return _const(a.const * b.const)
    for one, other in ((a, b), (b, a)):
        if one.const is not None and one.const == 0:
            return _const(0.0)
        if one.const is not None and one.const == 1:
            return other
    return _expr(f"({a.text}*{b.text})")


def _div(a: _Sym, b: _Sym) -> _Sym:
    if b.const is not None and b.const != 0:
        if a.const is not None:
            return _const(a.const / b.const)
        return _expr(f"({a.text}/{_fmt(b.const)})")
    return _expr(f"({a.text}/{b.text})")


def _sin(a: _Sym) -> _Sym:
    return _const(math.sin(a.const)) if a.const is not None else _expr(f"sin({a.text})")


def _cos(a: _Sym) -> _Sym:
    return _const(math.cos(a.const)) if a.const is not None else _expr(f"cos({a.text})")


def _linear(base: float, delta: float, progress_ref: str) -> _Sym:
    """A field that moves linearly with the eased progress: ``base + delta*E``."""
    if abs(delta) < 1e-12:
        return _const(base)
    term = f"{_fmt(delta)}*{progress_ref}"
    if abs(base) < 1e-12:
        return _expr(term)
    return _expr(f"({_fmt(base)}+{term})")


def _hoist(symbol: _Sym, register: int, setup: List[str]) -> _Sym:
    """Evaluate a non-constant sub-expression once into an FFmpeg register.

    Each of the eight point expressions is evaluated independently per frame, and
    the trig terms appear several times within each one. Storing them once turns
    ~48 sine/cosine evaluations per frame into 6, and shrinks the emitted string
    enough to keep even the busiest 3D preset comfortably inside the command-line
    budget (L7). Constants are returned untouched — there is nothing to hoist.
    """
    if symbol.const is not None:
        return symbol
    setup.append(f"st({register},{symbol.text})")
    return _expr(f"ld({register})")


def _progress_expression(plan: CameraMotionPlan, clip_duration: float, fps: int) -> str:
    """FFmpeg statements that leave the eased progress in register 0.

    Returns a ``;``-separated statement list to prepend to each coordinate
    expression; every field then reads the progress back through ``ld(0)``
    instead of re-deriving it. Registers are written at the TOP level rather
    than nested inside ``st(0, ...)``: a sequence inside a function argument
    evaluates correctly today, but flat statements leave nothing to reason about.

    Uses the same closed-form cubics as :func:`ease_progress`, so the rendered
    frame at time ``t`` matches what the preview drew at that time.
    """
    rate = fps if fps and fps > 0 else 30
    duration = clip_duration if clip_duration > 0 else 0.0
    window_start = plan.start_ratio * duration
    span = (plan.end_ratio - plan.start_ratio) * duration

    # `perspective` numbers its first output frame `on = 1` (measured against
    # ffmpeg 2025-05, by rendering a marker and solving for the frame index), so
    # clip-local time is `(on-1)/fps`. The surrounding `clip(...,0,1)` keeps this
    # safe on any build that numbers from 0 instead: the worst case is the first
    # frame holding the start framing for one extra frame.
    elapsed = f"(on-1)/{_fmt(float(rate))}"
    if window_start > TIME_EPSILON:
        elapsed = f"({elapsed}-{_fmt(window_start)})"
    if span <= TIME_EPSILON:
        linear = f"gte({elapsed},0)"
    else:
        linear = f"clip({elapsed}/{_fmt(span)},0,1)"

    if plan.easing == "linear":
        return f"st(0,{linear})"
    ref = "ld(1)"
    setup = f"st(1,{linear})"
    if plan.easing == "ease-in":
        return f"{setup};st(0,pow({ref},3))"
    if plan.easing == "ease-out":
        return f"{setup};st(0,1-pow(1-{ref},3))"
    if plan.easing == "ease-in-out":
        return f"{setup};st(0,if(lt({ref},0.5),4*pow({ref},3),1-pow(2-2*{ref},3)/2))"
    return f"st(0,{linear})"


def _floored(symbol: _Sym, floor: float, low: float, high: float) -> _Sym:
    """Mirror the kernel's ``max(value, floor)`` guard inside the expression.

    :func:`camera_homography` clamps ``scale`` and ``dolly`` away from their
    degenerate values; without the same clamp here, export and preview would
    disagree exactly where it hurts most — ``scale`` reaching 0 collapses the
    four ``perspective`` points onto one another and ``dolly`` going negative
    puts the plane behind the pinhole, so FFmpeg fails on input the preview
    renders happily. Both are reachable from the advanced panel once
    ``intensity`` amplifies an endpoint (scale 0.5 at intensity 2 → 0).

    The clamp is emitted ONLY when it can bind. Both fields are affine in the
    eased progress, which is itself clipped to [0,1], so the minimum over the
    whole move is the smaller endpoint; when that clears the floor the guard is
    unreachable and emitting it would lengthen all eight point expressions of
    every shipped preset for nothing.

    Args:
        symbol: The field's ``a + b*E`` symbol.
        floor: Smallest value the geometry kernel allows.
        low: The field's value at progress 0.
        high: The field's value at progress 1.

    Returns:
        The symbol, guarded only where an endpoint breaches ``floor``.
    """
    if min(low, high) >= floor:
        return symbol
    if symbol.const is not None:
        return _const(max(symbol.const, floor))
    return _expr(f"max({symbol.text},{_fmt(floor)})")


def _field_symbols(
    plan: CameraMotionPlan, canvas_aspect: float, progress_ref: str
) -> dict:
    """Per-field ``a + b*E`` symbols for the whole motion.

    ``apply_intensity`` and ``lerp`` are both affine, so applying intensity to
    the two endpoints FIRST is identical to applying it per sample — which is
    what lets every field stay linear in the eased progress and keeps the
    emitted expressions exact rather than approximated.
    """
    start = _apply_intensity(plan.from_state, plan.intensity)
    end = _apply_intensity(plan.to_state, plan.intensity)
    coverage = ensure_coverage(plan, canvas_aspect)
    scale_low = start.scale * coverage
    scale_high = end.scale * coverage
    return {
        "scale": _floored(
            _linear(scale_low, (end.scale - start.scale) * coverage, progress_ref),
            _MIN_SCALE,
            scale_low,
            scale_high,
        ),
        "offset_x": _linear(start.offset_x, end.offset_x - start.offset_x, progress_ref),
        "offset_y": _linear(start.offset_y, end.offset_y - start.offset_y, progress_ref),
        "roll": _linear(
            math.radians(start.roll), math.radians(end.roll - start.roll), progress_ref
        ),
        "yaw": _linear(
            math.radians(start.yaw), math.radians(end.yaw - start.yaw), progress_ref
        ),
        "pitch": _linear(
            math.radians(start.pitch), math.radians(end.pitch - start.pitch), progress_ref
        ),
        "dolly": _floored(
            _linear(start.dolly, end.dolly - start.dolly, progress_ref),
            _MIN_DOLLY,
            start.dolly,
            end.dolly,
        ),
    }


def _corner_expressions(terms: dict, geometry: dict, du: float, dv: float) -> Tuple[str, str]:
    """Destination expressions for ONE source corner, offset ``(du, dv)`` from
    the canvas centre.

    Evaluates the same composition :func:`camera_homography` builds — pinhole
    projection, then roll/scale/pan in screen space — but symbolically, so the
    constant parts fold away and only the animated parts survive as FFmpeg
    expressions. ``terms`` carries the already-hoisted trig and field symbols.
    """
    focal = _const(geometry["focal"])
    du_sym = _const(du)
    dv_sym = _const(dv)

    shear = _mul(_mul(terms["cos_yaw"], terms["sin_pitch"]), dv_sym)
    x_h = _mul(
        focal,
        _add(_mul(terms["cos_yaw"], du_sym), _mul(_mul(terms["sin_yaw"], terms["sin_pitch"]), dv_sym)),
    )
    y_h = _mul(focal, _mul(terms["cos_pitch"], dv_sym))
    w_h = _add(_sub(shear, _mul(terms["sin_yaw"], du_sym)), _mul(focal, terms["dolly"]))

    projected_x = _div(x_h, w_h)
    projected_y = _div(y_h, w_h)

    scale = terms["scale"]
    rolled_x = _mul(
        scale,
        _sub(_mul(terms["cos_roll"], projected_x), _mul(terms["sin_roll"], projected_y)),
    )
    rolled_y = _mul(
        scale,
        _add(_mul(terms["sin_roll"], projected_x), _mul(terms["cos_roll"], projected_y)),
    )

    origin_x = _add(_const(geometry["origin_x"]), _mul(terms["offset_x"], _const(geometry["width"])))
    origin_y = _add(_const(geometry["origin_y"]), _mul(terms["offset_y"], _const(geometry["height"])))
    return _add(origin_x, rolled_x).text, _add(origin_y, rolled_y).text


def _hoisted_terms(fields: dict, animated: bool) -> Tuple[dict, str]:
    """Derive the per-corner terms, hoisting the animated ones into registers.

    Returns ``(terms, prefix)`` where ``prefix`` is the ``;``-terminated setup to
    prepend to every point expression (empty when nothing is animated).
    """
    setup: List[str] = []
    terms = {
        "sin_yaw": _sin(fields["yaw"]),
        "cos_yaw": _cos(fields["yaw"]),
        "sin_pitch": _sin(fields["pitch"]),
        "cos_pitch": _cos(fields["pitch"]),
        "sin_roll": _sin(fields["roll"]),
        "cos_roll": _cos(fields["roll"]),
        "scale": fields["scale"],
        "dolly": fields["dolly"],
        "offset_x": fields["offset_x"],
        "offset_y": fields["offset_y"],
    }
    if animated:
        # Registers 0 and 1 are taken by the progress computation.
        for register, key in enumerate(
            ("sin_yaw", "cos_yaw", "sin_pitch", "cos_pitch", "sin_roll", "cos_roll", "scale"),
            start=2,
        ):
            terms[key] = _hoist(terms[key], register, setup)
    return terms, (";".join(setup) + ";" if setup else "")


@dataclass(frozen=True)
class MotionFilters:
    """Emitted filter steps for one clip, plus any user-visible degradation."""

    #: Filter strings to splice into the clip chain, in order.
    filters: List[str]
    #: Non-fatal degradations to surface to the user. NEVER swallow these.
    warnings: List[str]


class CameraMotionUnsupportedError(RuntimeError):
    """FFmpeg cannot render camera motion at all — export must fail loudly.

    Raised instead of quietly dropping the effect: an export that "succeeds"
    without the effect the user asked for is the worst failure mode this feature
    has (L11), so it is not an option.
    """


def _quote(expression: str) -> str:
    """Wrap an expression as a quoted FFmpeg filter argument.

    Quoting (rather than backslash-escaping every ``,`` and ``;``) is what makes
    the emitted expressions readable and reviewable. Verified against
    ``ffmpeg -filter_complex`` with commas and semicolons inside the expression.
    """
    return "'" + expression.replace("\\", "\\\\").replace("'", r"\'") + "'"


def build_motion_filters(
    plan: CameraMotionPlan,
    clip_duration: float,
    canvas: Tuple[int, int],
    fps: int,
    caps: Any = None,
) -> MotionFilters:
    """Build the FFmpeg filter steps that reproduce ``plan`` for one clip.

    Emits, in order:
      1. ``format=yuva420p`` — the pad below needs an alpha-capable format, and
         the whole track is normalised to it so ``concat``/``xfade`` still see
         matching inputs (L14).
      2. ``pad`` with a FULLY TRANSPARENT colour, only when the move exposes the
         backdrop. ``perspective`` replicates edge pixels for out-of-bounds
         samples, so a transparent border makes it replicate transparency and
         the lower track shows through — matching the preview exactly. A BLACK
         pad would occlude the lower track, because tracks are overlaid whole
         (R-P0-3).
      3. ``perspective`` with per-frame expressions.
      4. ``crop`` back to the canvas, paired with the pad.

    Args:
        plan: The camera move.
        clip_duration: Clip duration in seconds.
        canvas: ``(width, height)`` of the output canvas.
        fps: Output frame rate; frame index ``on`` is divided by it to get time.
        caps: FFmpeg capability probe (``has_perspective`` /
            ``perspective_supports_eval_frame``). ``None`` assumes full support.

    Returns:
        The filter steps plus any warnings.

    Raises:
        CameraMotionUnsupportedError: when FFmpeg has no ``perspective`` filter.
    """
    width, height = int(canvas[0]), int(canvas[1])
    warnings: List[str] = []

    has_perspective = True if caps is None else bool(getattr(caps, "has_perspective", True))
    animated = (
        True if caps is None else bool(getattr(caps, "perspective_supports_eval_frame", True))
    )
    if not has_perspective:
        raise CameraMotionUnsupportedError(
            "This FFmpeg build has no 'perspective' filter, which camera motion "
            "requires. Install FFmpeg 4.0+ with the standard filter set, or "
            "remove the camera motion from the affected clips."
        )

    aspect = width / height if height else 16.0 / 9.0
    focal = PERSPECTIVE_FOCAL_RATIO * float(max(width, height))
    margin_x, margin_y = backdrop_margin(plan, clip_duration, width, height, fps)

    if animated:
        # Leaves the eased progress in register 0, evaluated once per point
        # instead of once per field that needs it.
        prefix = _progress_expression(plan, clip_duration, fps) + ";"
        fields = _field_symbols(plan, aspect, "ld(0)")
    else:
        # No per-frame evaluation available: freeze the framing at the midpoint
        # of the move. Degraded but honest — and loudly reported.
        midpoint = state_at(plan, clip_duration, clip_duration / 2.0, aspect)
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
            "expressions per frame (perspective lacks eval=frame), so the camera "
            "move was rendered as a single fixed framing."
        )

    geometry = {
        "focal": focal,
        "width": float(width),
        "height": float(height),
        # The padded frame's own origin: the perspective points are expressed in
        # PADDED coordinates, and `crop` shifts the window back afterwards.
        "origin_x": width / 2.0 + margin_x,
        "origin_y": height / 2.0 + margin_y,
    }

    # Corner offsets from the canvas centre. With a pad the SOURCE rect is the
    # padded frame, so its corners sit `margin` outside the canvas — mapping the
    # un-padded rect instead would shrink the picture by the pad width.
    left = -(width / 2.0) - margin_x
    right = (width / 2.0) + margin_x
    top = -(height / 2.0) - margin_y
    bottom = (height / 2.0) + margin_y
    corners = ((left, top), (right, top), (right, bottom), (left, bottom))

    terms, trig_prefix = _hoisted_terms(fields, animated)
    prefix += trig_prefix

    points: List[tuple] = []
    for index, (du, dv) in enumerate(corners):
        x_expr, y_expr = _corner_expressions(terms, geometry, du, dv)
        points.append((index, prefix + x_expr, prefix + y_expr))

    filters: List[str] = ["format=yuva420p"]
    if margin_x > 0 or margin_y > 0:
        filters.append(
            f"pad={width + 2 * margin_x}:{height + 2 * margin_y}"
            f":{margin_x}:{margin_y}:color={TRANSPARENT_BACKDROP}"
        )

    # Clockwise [TL,TR,BR,BL] -> FFmpeg raster order [TL,TR,BL,BR] (R-P0-2/L12).
    raster = [points[0], points[1], points[3], points[2]]
    options = []
    for slot, (_, x_expr, y_expr) in enumerate(raster):
        options.append(f"x{slot}={_quote(x_expr)}")
        options.append(f"y{slot}={_quote(y_expr)}")
    options.append("sense=destination")
    options.append(f"eval={'frame' if animated else 'init'}")
    options.append("interpolation=cubic")
    filters.append("perspective=" + ":".join(options))

    if margin_x > 0 or margin_y > 0:
        filters.append(f"crop={width}:{height}:{margin_x}:{margin_y}")

    return MotionFilters(filters=filters, warnings=warnings)
