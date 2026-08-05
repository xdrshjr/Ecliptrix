"""Export-side mirror of the preview camera-motion geometry (2D / 3D 运镜).

Plan: docs/plans/timeline-camera-motion/experiment-plan.md §3 / §4.3.

This module is the Python twin of
``src/components/video/playback/CameraMotionLayer.ts``. Both compute the SAME
canvas-space homography ``H``; the preview applies it to the video's fit-rect,
while export applies it to the whole canvas rect because the normalization pass
already scaled + letterboxed every clip to canvas size (R-P0-5). Keeping one
geometry with two application rects is what makes export what-you-see-is-what-
you-get.

Any change here MUST be mirrored in the TypeScript module and re-locked by
``scripts/gen-camera-motion-golden.mjs``; ``tests/test_camera_motion_geometry.py``
reads those golden vectors and fails on any drift.

Scope: geometry ONLY. Turning a move into FFmpeg filter text lives in
:mod:`camera_motion_filters`, which imports this module and never the other way
round — so nothing FFmpeg-shaped can leak into the surface the parity tests
compare.

PURE: maths only — no subprocess, no filesystem, no FFmpeg invocation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, List, Optional, Sequence, Tuple

#: Identity state. ``intensity`` scales the offset FROM this point (§3.3).
NEUTRAL_STATE = {
    "scale": 1.0,
    "offset_x": 0.0,
    "offset_y": 0.0,
    "roll": 0.0,
    "yaw": 0.0,
    "pitch": 0.0,
    "dolly": 1.0,
}

#: Pinhole focal length as a multiple of the canvas' longer edge. MUST equal the
#: TypeScript ``PERSPECTIVE_FOCAL_RATIO``.
PERSPECTIVE_FOCAL_RATIO = 1.6

#: Samples used to scan a motion window for coverage / backdrop margin.
MOTION_SAMPLE_COUNT = 21

#: Minimum transparent border once a pad is needed at all (see backdrop_margin).
BACKDROP_MIN_PAD = 16

#: Mirrors ``TransitionLayer.TIME_EPSILON``.
TIME_EPSILON = 0.001

_MIN_HOMOGENEOUS_W = 1e-6
_MIN_DOLLY = 0.05
_MIN_SCALE = 1e-4

Mat3 = Tuple[float, float, float, float, float, float, float, float, float]


@dataclass(frozen=True)
class CameraState:
    """One sampled camera state — the Python mirror of ``CameraMotionState``."""

    scale: float = 1.0
    offset_x: float = 0.0
    offset_y: float = 0.0
    roll: float = 0.0
    yaw: float = 0.0
    pitch: float = 0.0
    dolly: float = 1.0


def _clamp(value: float, low: float, high: float) -> float:
    if value != value:  # NaN
        return low
    return max(low, min(high, value))


def _clamp01(value: float) -> float:
    return _clamp(value, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Stage 1 — time
# ---------------------------------------------------------------------------


def ease_progress(easing: str, p: float) -> float:
    """Apply an easing curve to a linear progress value.

    Closed-form cubics, not a Bézier root solver — an iterative solver would
    diverge from the JavaScript implementation in its final iteration and break
    the golden-vector parity.

    Args:
        easing: One of ``linear`` / ``ease-in`` / ``ease-out`` / ``ease-in-out``.
        p: Linear progress; clamped to [0,1].

    Returns:
        Eased progress in [0,1].
    """
    x = _clamp01(p)
    if easing == "ease-in":
        return x * x * x
    if easing == "ease-out":
        inv = 1.0 - x
        return 1.0 - inv * inv * inv
    if easing == "ease-in-out":
        if x < 0.5:
            return 4.0 * x * x * x
        inv = -2.0 * x + 2.0
        return 1.0 - (inv * inv * inv) / 2.0
    return x


def _lerp_state(a: CameraState, b: CameraState, p: float) -> CameraState:
    return CameraState(
        scale=a.scale + (b.scale - a.scale) * p,
        offset_x=a.offset_x + (b.offset_x - a.offset_x) * p,
        offset_y=a.offset_y + (b.offset_y - a.offset_y) * p,
        roll=a.roll + (b.roll - a.roll) * p,
        yaw=a.yaw + (b.yaw - a.yaw) * p,
        pitch=a.pitch + (b.pitch - a.pitch) * p,
        dolly=a.dolly + (b.dolly - a.dolly) * p,
    )


def _apply_intensity(raw: CameraState, intensity: float) -> CameraState:
    """Scale the state's offset from the neutral state (§3.3 / R-P1-7)."""
    k = _clamp(intensity, 0.0, 2.0)
    return CameraState(
        scale=1.0 + (raw.scale - 1.0) * k,
        offset_x=raw.offset_x * k,
        offset_y=raw.offset_y * k,
        roll=raw.roll * k,
        yaw=raw.yaw * k,
        pitch=raw.pitch * k,
        dolly=1.0 + (raw.dolly - 1.0) * k,
    )


@dataclass(frozen=True)
class CameraMotionPlan:
    """A validated camera move, normalised out of the wire model."""

    preset_id: str
    space: str
    from_state: CameraState
    to_state: CameraState
    easing: str
    start_ratio: float
    end_ratio: float
    intensity: float

    @property
    def is_3d(self) -> bool:
        return self.space == "3d"


def _state_from_wire(raw: Any) -> CameraState:
    def read(name: str, fallback: float) -> float:
        value = getattr(raw, name, None)
        if value is None and isinstance(raw, dict):
            value = raw.get(name)
        try:
            return float(value) if value is not None else fallback
        except (TypeError, ValueError):
            return fallback

    return CameraState(
        scale=read("scale", 1.0),
        offset_x=read("offset_x", 0.0),
        offset_y=read("offset_y", 0.0),
        roll=read("roll", 0.0),
        yaw=read("yaw", 0.0),
        pitch=read("pitch", 0.0),
        dolly=read("dolly", 1.0),
    )


def plan_from_spec(spec: Any) -> Optional[CameraMotionPlan]:
    """Normalise a ``CameraMotionSpec`` (or equivalent dict) into a plan.

    Args:
        spec: The pydantic model / mapping carried on a composition item.

    Returns:
        The plan, or ``None`` when ``spec`` is absent — the "no camera motion"
        path, which must leave the filtergraph byte-identical to before (M5).
    """
    if spec is None:
        return None

    def read(name: str, fallback: Any) -> Any:
        value = getattr(spec, name, None)
        if value is None and isinstance(spec, dict):
            value = spec.get(name)
        return fallback if value is None else value

    space = str(read("space", "2d"))
    if space not in ("2d", "3d"):
        space = "2d"
    return CameraMotionPlan(
        preset_id=str(read("preset_id", "custom")),
        space=space,
        from_state=_state_from_wire(read("from_state", {})),
        to_state=_state_from_wire(read("to_state", {})),
        easing=str(read("easing", "linear")),
        start_ratio=_clamp01(float(read("start_ratio", 0.0))),
        end_ratio=_clamp01(float(read("end_ratio", 1.0))),
        intensity=_clamp(float(read("intensity", 1.0)), 0.0, 2.0),
    )


def ensure_coverage(plan: CameraMotionPlan, canvas_aspect: float) -> float:
    """Minimum uniform scale keeping a pure 2D move covering the canvas.

    See the TypeScript ``ensureCoverage`` for the derivation. Only the canvas
    ASPECT matters, never its pixel size, which is why the preview can compute
    the identical value without knowing the export resolution.

    Args:
        plan: The camera move.
        canvas_aspect: Canvas width / height.

    Returns:
        A multiplier >= 1 to fold into ``scale``. Always 1.0 for 3D moves, which
        are allowed to reveal the backdrop (§3.2).
    """
    if plan.space != "2d":
        return 1.0
    aspect = canvas_aspect if canvas_aspect and canvas_aspect > 0 else 16.0 / 9.0
    height_over_width = 1.0 / aspect
    required = 1.0
    for index in range(MOTION_SAMPLE_COUNT):
        p = ease_progress(plan.easing, index / (MOTION_SAMPLE_COUNT - 1))
        state = _apply_intensity(
            _lerp_state(plan.from_state, plan.to_state, p), plan.intensity
        )
        scale = max(state.scale, _MIN_SCALE)
        roll = math.radians(state.roll)
        cos_r = math.cos(roll)
        sin_r = math.sin(roll)
        for sx in (-0.5, 0.5):
            for sy in (-0.5, 0.5):
                a = sx - state.offset_x
                b = sy - state.offset_y
                gx = cos_r * a + sin_r * b * height_over_width
                gy = -sin_r * a * aspect + cos_r * b
                required = max(required, 2.0 * abs(gx) / scale, 2.0 * abs(gy) / scale)
    return required


def state_at(
    plan: CameraMotionPlan,
    clip_duration: float,
    local_time: float,
    canvas_aspect: float,
    enforce_coverage: bool = True,
) -> CameraState:
    """Sample a camera move at ``local_time`` seconds into its clip.

    Args:
        plan: The camera move.
        clip_duration: Clip duration in seconds.
        local_time: Seconds since the clip's own start (NOT composition time —
            export chains are reset with ``setpts=PTS-STARTPTS``).
        canvas_aspect: Aspect ratio the coverage guarantee is judged against —
            the CANVAS ratio for a full-frame clip, the BOX ratio for a still
            overlay.
        enforce_coverage: Whether the 2D coverage guarantee applies at all.
            ``True`` (default) for full-frame clips, where exposing the canvas
            edge is a defect; ``False`` for a still overlay, whose box is padded
            with transparency and is MEANT to reveal the layer below. Mirrors
            the TypeScript ``motionStateAt``'s fifth parameter, including its
            default, so the video path stays bit-identical.

    Returns:
        The sampled state, ready for :func:`camera_homography`.
    """
    duration = clip_duration if clip_duration > 0 else 0.0
    window_start = plan.start_ratio * duration
    window_end = plan.end_ratio * duration
    span = window_end - window_start
    if span <= TIME_EPSILON:
        p = ease_progress(plan.easing, 1.0 if local_time >= window_start else 0.0)
    else:
        p = ease_progress(plan.easing, _clamp01((local_time - window_start) / span))

    state = _apply_intensity(_lerp_state(plan.from_state, plan.to_state, p), plan.intensity)
    coverage = ensure_coverage(plan, canvas_aspect) if enforce_coverage else 1.0
    if coverage > 1.0:
        return CameraState(
            scale=state.scale * coverage,
            offset_x=state.offset_x,
            offset_y=state.offset_y,
            roll=state.roll,
            yaw=state.yaw,
            pitch=state.pitch,
            dolly=state.dolly,
        )
    return state


# ---------------------------------------------------------------------------
# Stage 2 — geometry
# ---------------------------------------------------------------------------


def _multiply(a: Mat3, b: Mat3) -> Mat3:
    return (
        a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
        a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
        a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
        a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
        a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
        a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
        a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
        a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
        a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    )


def camera_homography(state: CameraState, width: int, height: int) -> Mat3:
    """Canvas-space homography for one camera state.

    Byte-for-byte the same composition as the TypeScript ``cameraHomography``:
    centre → 3D rotate + pinhole project → roll → scale → pan → un-centre, then
    normalised so ``H[8] == 1``.

    Args:
        state: Sampled camera state.
        width: Canvas width in pixels.
        height: Canvas height in pixels.

    Returns:
        The 3×3 row-major homography, canvas pixels → canvas pixels.
    """
    w = float(width if width > 0 else 1)
    h = float(height if height > 0 else 1)
    cx = w / 2.0
    cy = h / 2.0
    focal = PERSPECTIVE_FOCAL_RATIO * max(w, h)

    pitch = math.radians(state.pitch)
    yaw = math.radians(state.yaw)
    cos_p = math.cos(pitch)
    sin_p = math.sin(pitch)
    cos_y = math.cos(yaw)
    sin_y = math.sin(yaw)
    distance = focal * max(state.dolly, _MIN_DOLLY)
    project: Mat3 = (
        focal * cos_y, focal * (sin_y * sin_p), 0.0,
        0.0, focal * cos_p, 0.0,
        -sin_y, cos_y * sin_p, distance,
    )

    roll = math.radians(state.roll)
    cos_r = math.cos(roll)
    sin_r = math.sin(roll)
    scale = max(state.scale, _MIN_SCALE)
    roll_scale: Mat3 = (
        scale * cos_r, -scale * sin_r, 0.0,
        scale * sin_r, scale * cos_r, 0.0,
        0.0, 0.0, 1.0,
    )

    centre: Mat3 = (1.0, 0.0, -cx, 0.0, 1.0, -cy, 0.0, 0.0, 1.0)
    pan_restore: Mat3 = (
        1.0, 0.0, cx + state.offset_x * w,
        0.0, 1.0, cy + state.offset_y * h,
        0.0, 0.0, 1.0,
    )

    composed = _multiply(pan_restore, _multiply(roll_scale, _multiply(project, centre)))
    divisor = composed[8]
    if not math.isfinite(divisor) or abs(divisor) < _MIN_HOMOGENEOUS_W:
        return composed
    return tuple(value / divisor for value in composed)  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Stage 3 — pixels
# ---------------------------------------------------------------------------


def _project_point(H: Mat3, x: float, y: float) -> Tuple[float, float, float]:
    w = H[6] * x + H[7] * y + H[8]
    safe = w if abs(w) >= _MIN_HOMOGENEOUS_W else _MIN_HOMOGENEOUS_W
    return (
        (H[0] * x + H[1] * y + H[2]) / safe,
        (H[3] * x + H[4] * y + H[5]) / safe,
        w,
    )


def apply_homography_to_rect(
    H: Mat3, x: float, y: float, width: float, height: float
) -> List[float]:
    """Map a rect's corners through ``H``.

    Args:
        H: Canvas-space homography.
        x: Rect left edge.
        y: Rect top edge.
        width: Rect width.
        height: Rect height.

    Returns:
        ``[x_TL, y_TL, x_TR, y_TR, x_BR, y_BR, x_BL, y_BL]`` — CLOCKWISE. FFmpeg
        wants raster order; use :func:`quad_to_perspective_points` to transpose,
        never positional indexing (R-P0-2 / L12).
    """
    x1 = x + width
    y1 = y + height
    tl = _project_point(H, x, y)
    tr = _project_point(H, x1, y)
    br = _project_point(H, x1, y1)
    bl = _project_point(H, x, y1)
    return [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]]


def quad_to_perspective_points(quad: Sequence[float]) -> List[float]:
    """Transpose a clockwise quad into FFmpeg ``perspective`` raster order.

    ``perspective`` names its points ``x0/y0`` = top-left, ``x1/y1`` = top-RIGHT,
    ``x2/y2`` = bottom-LEFT, ``x3/y3`` = bottom-right (verified against
    ``ffmpeg -h filter=perspective``). Our canonical order is clockwise
    [TL, TR, BR, BL], so points 2 and 3 must swap. Feeding the clockwise array
    straight through produces a bow-tie fold that still "looks like an effect",
    which is exactly why this transposition has its own regression test.

    Args:
        quad: Eight floats in clockwise [TL, TR, BR, BL] order.

    Returns:
        Eight floats ordered ``[x0,y0, x1,y1, x2,y2, x3,y3]`` for the filter.
    """
    tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y = quad
    return [tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y]


def _quad_covers_canvas(quad: Sequence[float], width: float, height: float) -> bool:
    points = [
        (quad[0], quad[1]),
        (quad[2], quad[3]),
        (quad[4], quad[5]),
        (quad[6], quad[7]),
    ]
    for px, py in ((0.0, 0.0), (width, 0.0), (width, height), (0.0, height)):
        sign = 0
        for index in range(4):
            ax, ay = points[index]
            bx, by = points[(index + 1) % 4]
            cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
            if abs(cross) < 1e-9:
                continue
            current = 1 if cross > 0 else -1
            if sign == 0:
                sign = current
            elif sign != current:
                return False
    return True


def _to_even_margin(overflow: float, cap: float) -> int:
    if not overflow > 0:
        return 0
    even = 2 * math.ceil(overflow / 2.0)
    return max(0, min(even, 2 * int(cap // 2)))


def backdrop_margin(
    plan: CameraMotionPlan, clip_duration: float, width: int, height: int, fps: int
) -> Tuple[int, int]:
    """Transparent padding the whole clip needs, scanned across its window.

    ``pad`` is emitted once and is static, while ``perspective`` re-evaluates
    every frame — so the margin must be the WORST case over the motion, not the
    value at one instant.

    The trigger is COVERAGE, not overflow: a move that shrinks entirely inside
    the canvas overflows by zero yet exposes the most backdrop, and without a
    transparent border FFmpeg would smear replicated edge pixels across the
    whole exposed ring.

    Args:
        plan: The camera move.
        clip_duration: Clip duration in seconds.
        width: Canvas width in pixels.
        height: Canvas height in pixels.
        fps: Output frame rate (only used to align samples to real frames).

    Returns:
        ``(mx, my)`` even margins; ``(0, 0)`` means skip the pad/crop pair.
    """
    aspect = width / height if height else 16.0 / 9.0
    needs_pad = False
    overflow_x = 0.0
    overflow_y = 0.0
    for local_time in _sample_times(clip_duration, fps):
        state = state_at(plan, clip_duration, local_time, aspect)
        H = camera_homography(state, width, height)
        quad = apply_homography_to_rect(H, 0.0, 0.0, float(width), float(height))
        if _quad_covers_canvas(quad, float(width), float(height)):
            continue
        needs_pad = True
        for index in range(4):
            px = quad[index * 2]
            py = quad[index * 2 + 1]
            if not (math.isfinite(px) and math.isfinite(py)):
                continue
            overflow_x = max(overflow_x, -px, px - width)
            overflow_y = max(overflow_y, -py, py - height)
    if not needs_pad:
        return (0, 0)
    return (
        _to_even_margin(max(float(BACKDROP_MIN_PAD), overflow_x), width / 2.0),
        _to_even_margin(max(float(BACKDROP_MIN_PAD), overflow_y), height / 2.0),
    )


def _sample_times(clip_duration: float, fps: int) -> List[float]:
    """Evenly spaced sample times across the clip, snapped to real frames."""
    duration = clip_duration if clip_duration > 0 else 0.0
    if duration <= 0:
        return [0.0]
    rate = fps if fps and fps > 0 else 30
    frames = max(1, int(round(duration * rate)))
    step = max(1, frames // (MOTION_SAMPLE_COUNT - 1))
    times = [min(frame, frames) / rate for frame in range(0, frames + 1, step)]
    if times[-1] < duration:
        times.append(duration)
    return times
