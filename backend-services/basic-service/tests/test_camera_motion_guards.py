"""Degenerate-state guards for the export-side camera-motion emitter.

The geometry kernel clamps ``scale`` and ``dolly`` away from the values that
break a pinhole projection. Those clamps have to survive the trip into FFmpeg
expression text, or preview and export diverge exactly where the maths falls
apart: a zero scale folds the four ``perspective`` points onto one another
(FFmpeg then solves a singular system) and a negative dolly puts the clip plane
behind the camera. Both are reachable from the panel's advanced sliders once
``intensity`` amplifies an endpoint — scale 0.5 at intensity 2 lands on 0,
dolly 0.4 at intensity 2 lands on −0.2.

These tests pin two things at once: that the guard fires when it must, and that
it stays invisible when it must not. A guard emitted unconditionally would
lengthen all eight point expressions of every shipped preset and churn the
filter strings the other suites freeze.
"""

import math

import pytest

from app.services.composition.camera_motion import (
    _MIN_DOLLY,
    _MIN_SCALE,
    CameraMotionPlan,
    CameraState,
    apply_homography_to_rect,
    backdrop_margin,
    camera_homography,
    state_at,
)
from app.services.composition.camera_motion_filters import build_motion_filters

CANVAS = (1920, 1080)
FPS = 30
DURATION = 6.0
ASPECT = CANVAS[0] / CANVAS[1]


def _plan(space: str = "2d", intensity: float = 1.0, **endpoints) -> CameraMotionPlan:
    """Build a plan from ``field=(from_value, to_value)`` pairs."""
    return CameraMotionPlan(
        preset_id="custom",
        space=space,
        from_state=CameraState(**{k: v[0] for k, v in endpoints.items()}),
        to_state=CameraState(**{k: v[1] for k, v in endpoints.items()}),
        easing="linear",
        start_ratio=0.0,
        end_ratio=1.0,
        intensity=intensity,
    )


def _perspective_options(filters) -> dict:
    """Split the emitted ``perspective=`` step into its ``name=value`` options."""
    step = next(f for f in filters if f.startswith("perspective="))
    options = {}
    for token in step[len("perspective=") :].split(":"):
        name, _, value = token.partition("=")
        options[name] = value.strip("'")
    return options


def _emitted_quad(options: dict):
    """Read x0..y3 back as floats, in the emitted raster order [TL, TR, BL, BR].

    Valid only when every field folded to a constant. The progress prefix is
    emitted regardless, so the number is the last ``;``-separated statement.
    """
    return [
        float(options[f"{axis}{slot}"].split(";")[-1])
        for slot in range(4)
        for axis in ("x", "y")
    ]


def _expected_quad(plan: CameraMotionPlan, local_time: float = 0.0):
    """The quad the geometry kernel produces, in the emitter's padded frame.

    ``perspective`` maps the corners of whatever frame it receives — the PADDED
    one when a transparent backdrop was added — and its coordinates are relative
    to that padded frame's own origin. So the expectation maps the padded rect
    (which starts at ``-margin`` in canvas space) and then shifts by the margin.
    Returned in raster order to match :func:`_emitted_quad`.
    """
    width, height = CANVAS
    margin_x, margin_y = backdrop_margin(plan, DURATION, width, height, FPS)
    state = state_at(plan, DURATION, local_time, ASPECT)
    homography = camera_homography(state, width, height)
    tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y = apply_homography_to_rect(
        homography,
        -float(margin_x),
        -float(margin_y),
        float(width + 2 * margin_x),
        float(height + 2 * margin_y),
    )
    clockwise = [tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y]
    return [
        value + (margin_x if index % 2 == 0 else margin_y)
        for index, value in enumerate(clockwise)
    ]


def test_shipped_range_emits_no_clamp():
    """A normal move must not pay for a guard it can never trigger."""
    emitted = build_motion_filters(
        _plan(scale=(1.0, 1.25), offset_x=(0.0, 0.05)), DURATION, CANVAS, FPS
    )
    assert not any("max(" in step for step in emitted.filters)
    assert emitted.warnings == []


def test_animated_scale_crossing_zero_carries_the_floor_into_the_expression():
    """An animated scale that starts at 0 keeps the floor as a live max()."""
    plan = _plan(scale=(0.5, 1.5), intensity=2.0)
    options = _perspective_options(build_motion_filters(plan, DURATION, CANVAS, FPS).filters)
    assert "max(" in options["x0"], options["x0"]


def test_static_zero_scale_folds_to_the_floor_and_matches_the_kernel():
    """scale 0.5 at intensity 2 is exactly 0 — export must land where preview does."""
    plan = _plan(scale=(0.5, 0.5), intensity=2.0)
    state = state_at(plan, DURATION, 0.0, ASPECT)
    assert state.scale == pytest.approx(0.0, abs=1e-12)

    quad = _emitted_quad(_perspective_options(build_motion_filters(plan, DURATION, CANVAS, FPS).filters))
    assert quad == pytest.approx(_expected_quad(plan), abs=1e-6)
    # Distinct corners: four identical points make `perspective` singular.
    assert quad[0] != quad[2]
    assert _MIN_SCALE > 0


def test_negative_dolly_is_floored_so_the_projection_stays_finite():
    """dolly 0.4 at intensity 2 is −0.2 — behind the pinhole without the floor."""
    plan = _plan(space="3d", dolly=(0.4, 0.4), yaw=(12.0, 12.0), intensity=2.0)
    state = state_at(plan, DURATION, 0.0, ASPECT)
    assert state.dolly == pytest.approx(-0.2, abs=1e-9)
    assert state.dolly < _MIN_DOLLY

    quad = _emitted_quad(_perspective_options(build_motion_filters(plan, DURATION, CANVAS, FPS).filters))
    assert all(math.isfinite(value) for value in quad)
    assert quad == pytest.approx(_expected_quad(plan), abs=1e-6)
