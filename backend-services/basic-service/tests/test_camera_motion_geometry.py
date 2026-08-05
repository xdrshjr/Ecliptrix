"""Cross-implementation geometry parity for camera motion (M1).

Plan: docs/plans/timeline-camera-motion/experiment-plan.md §2.2 M1 / §7.5.

THIS is the real parity check. The TypeScript suite asserts against golden
vectors generated from itself, so it can only catch regressions; here a
completely independent implementation reads the SAME frozen artefact. If the two
kernels ever drift — a different focal ratio, a different easing curve, a
different composition order — the export stops matching the preview, and this is
the test that says so.

The vectors are produced only by ``scripts/gen-camera-motion-golden.mjs``.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from app.services.composition.camera_motion import (
    CameraState,
    CameraMotionPlan,
    apply_homography_to_rect,
    camera_homography,
    ease_progress,
    quad_to_perspective_points,
    state_at,
)

#: Max allowed deviation, in canvas pixels, between the two implementations.
TOLERANCE_PX = 0.5

GOLDEN_PATH = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "plans"
    / "timeline-camera-motion"
    / "fixtures"
    / "camera-motion-golden.json"
)


def _load_golden() -> dict:
    if not GOLDEN_PATH.exists():
        pytest.skip(f"golden vectors not found at {GOLDEN_PATH}")
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


GOLDEN = _load_golden()


def _plan_from_case(case: dict) -> CameraMotionPlan:
    """Rebuild the motion a case was generated from.

    The preset table lives in TypeScript, so the endpoints are recovered from the
    frozen samples' own metadata plus the shared preset constants below. Keeping
    the constants here in one dict — rather than re-deriving them — makes any
    future preset edit fail loudly instead of silently comparing a stale move.
    """
    endpoints = PRESET_ENDPOINTS[case["presetId"]]
    return CameraMotionPlan(
        preset_id=case["presetId"],
        space=case["space"],
        from_state=CameraState(**endpoints["from"]),
        to_state=CameraState(**endpoints["to"]),
        easing=case["easing"],
        start_ratio=0.0,
        end_ratio=1.0,
        intensity=1.0,
    )


def _state(**overrides) -> dict:
    base = dict(scale=1.0, offset_x=0.0, offset_y=0.0, roll=0.0, yaw=0.0, pitch=0.0, dolly=1.0)
    base.update(overrides)
    return base


#: Mirror of ``src/components/video/playback/cameraMotionPresets.ts``. A preset
#: changed on one side and not the other fails the parity assertions below.
PRESET_ENDPOINTS = {
    "zoom-in": {"from": _state(scale=1.0), "to": _state(scale=1.25)},
    "zoom-out": {"from": _state(scale=1.25), "to": _state(scale=1.0)},
    "pan-left": {
        "from": _state(scale=1.15, offset_x=-0.06),
        "to": _state(scale=1.15, offset_x=0.06),
    },
    "pan-right": {
        "from": _state(scale=1.15, offset_x=0.06),
        "to": _state(scale=1.15, offset_x=-0.06),
    },
    "tilt-up": {
        "from": _state(scale=1.15, offset_y=-0.06),
        "to": _state(scale=1.15, offset_y=0.06),
    },
    "tilt-down": {
        "from": _state(scale=1.15, offset_y=0.06),
        "to": _state(scale=1.15, offset_y=-0.06),
    },
    "rotate-in": {"from": _state(scale=1.0, roll=-3), "to": _state(scale=1.2, roll=0)},
    "ken-burns": {
        "from": _state(scale=1.05, offset_x=0.03, offset_y=-0.02),
        "to": _state(scale=1.28, offset_x=-0.04, offset_y=0.035),
    },
    "orbit-left": {"from": _state(scale=1.1, yaw=-10), "to": _state(scale=1.1, yaw=10)},
    "orbit-right": {"from": _state(scale=1.1, yaw=10), "to": _state(scale=1.1, yaw=-10)},
    "dive": {
        "from": _state(scale=1.06, pitch=-12, dolly=1.12),
        "to": _state(scale=1.06, pitch=0, dolly=1.0),
    },
    "crane-up": {
        "from": _state(scale=1.1, pitch=0, offset_y=0),
        "to": _state(scale=1.1, pitch=10, offset_y=-0.03),
    },
    "swing-in": {"from": _state(scale=1.0, yaw=22), "to": _state(scale=1.06, yaw=0)},
    "dolly-in-3d": {
        "from": _state(scale=1.02, pitch=3, dolly=1.25),
        "to": _state(scale=1.02, pitch=0, dolly=0.92),
    },
    "boom": {
        "from": _state(scale=1.14, pitch=-8, offset_y=0.04),
        "to": _state(scale=1.14, pitch=8, offset_y=-0.04),
    },
    "spiral": {
        "from": _state(scale=1.14, yaw=-12, pitch=6, roll=-4),
        "to": _state(scale=1.14, yaw=12, pitch=-6, roll=4),
    },
}


def test_golden_vectors_cover_every_preset():
    """A preset added on the TS side without regenerating is caught here."""
    frozen = {case["presetId"] for case in GOLDEN["cases"]}
    assert frozen == set(PRESET_ENDPOINTS), (
        "golden vectors and the Python preset mirror disagree; "
        "run `node scripts/gen-camera-motion-golden.mjs` and update PRESET_ENDPOINTS"
    )


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: c["presetId"])
def test_python_geometry_matches_typescript_golden_vectors(case):
    """Python and TypeScript map the canvas rect to the same quad (M1)."""
    canvas = GOLDEN["canvas"]
    clip = GOLDEN["clip"]
    aspect = canvas["width"] / canvas["height"]
    plan = _plan_from_case(case)

    for sample in case["samples"]:
        local_time = float(sample["t"]) - clip["startTime"]
        state = state_at(plan, clip["duration"], local_time, aspect)
        matrix = camera_homography(state, canvas["width"], canvas["height"])
        quad = apply_homography_to_rect(matrix, 0.0, 0.0, canvas["width"], canvas["height"])
        for index, expected in enumerate(sample["quad"]):
            deviation = abs(quad[index] - float(expected))
            assert deviation <= TOLERANCE_PX, (
                f"{case['presetId']} t={sample['t']} coord {index}: "
                f"python={quad[index]:.6f} typescript={expected} delta={deviation:.6f}px"
            )


def test_easing_matches_the_typescript_closed_forms():
    """Both ends pinned and the midpoints identical to the TS cubics."""
    for easing in ("linear", "ease-in", "ease-out", "ease-in-out"):
        assert ease_progress(easing, 0.0) == 0.0
        assert ease_progress(easing, 1.0) == 1.0
        assert ease_progress(easing, -2.0) == 0.0
        assert ease_progress(easing, 5.0) == 1.0
    assert ease_progress("ease-in", 0.5) == pytest.approx(0.125)
    assert ease_progress("ease-out", 0.5) == pytest.approx(0.875)
    assert ease_progress("ease-in-out", 0.5) == pytest.approx(0.5)
    assert ease_progress("ease-in-out", 0.25) == pytest.approx(4 * 0.25 ** 3)


def test_neutral_state_is_the_identity():
    matrix = camera_homography(CameraState(), 1920, 1080)
    quad = apply_homography_to_rect(matrix, 0.0, 0.0, 1920.0, 1080.0)
    assert quad == pytest.approx([0, 0, 1920, 0, 1920, 1080, 0, 1080], abs=1e-9)


def test_two_d_states_produce_an_exactly_affine_matrix():
    matrix = camera_homography(CameraState(scale=1.3, offset_x=0.1, roll=8), 1920, 1080)
    assert matrix[6] == 0.0
    assert matrix[7] == 0.0
    assert matrix[8] == pytest.approx(1.0)


def test_perspective_point_order_transposes_to_raster_order():
    """FFmpeg point order is raster, not clockwise (R-P0-2 / L12).

    ``perspective`` names x2/y2 BOTTOM-LEFT and x3/y3 bottom-right, while the
    shared quad contract is clockwise [TL, TR, BR, BL]. Passing the clockwise
    array through positionally folds the image into a bow tie — which still
    "looks like an effect" and so would not be spotted by eye. This is the
    single assertion standing between that bug and a shipped release.
    """
    clockwise = [10.0, 11.0, 20.0, 21.0, 30.0, 31.0, 40.0, 41.0]  # TL TR BR BL
    raster = quad_to_perspective_points(clockwise)

    assert raster[0:2] == [10.0, 11.0], "x0/y0 must stay top-left"
    assert raster[2:4] == [20.0, 21.0], "x1/y1 must stay top-right"
    assert raster[4:6] == [40.0, 41.0], "x2/y2 must be BOTTOM-LEFT, not bottom-right"
    assert raster[6:8] == [30.0, 31.0], "x3/y3 must be bottom-right"


def test_intensity_zero_is_the_identity_for_every_preset():
    """R-P1-7: even presets whose ``from`` is not neutral (Zoom Out)."""
    for preset_id, endpoints in PRESET_ENDPOINTS.items():
        plan = CameraMotionPlan(
            preset_id=preset_id,
            space="2d",
            from_state=CameraState(**endpoints["from"]),
            to_state=CameraState(**endpoints["to"]),
            easing="linear",
            start_ratio=0.0,
            end_ratio=1.0,
            intensity=0.0,
        )
        for local_time in (0.0, 2.0, 6.0):
            state = state_at(plan, 6.0, local_time, 16 / 9)
            assert state.scale == pytest.approx(1.0), preset_id
            assert state.offset_x == pytest.approx(0.0), preset_id
            assert state.offset_y == pytest.approx(0.0), preset_id
            assert state.roll == pytest.approx(0.0), preset_id
            assert state.dolly == pytest.approx(1.0), preset_id


def test_progress_holds_the_end_framing_past_the_window():
    plan = CameraMotionPlan(
        preset_id="t", space="2d",
        from_state=CameraState(scale=1.0), to_state=CameraState(scale=1.5),
        easing="linear", start_ratio=0.25, end_ratio=0.75, intensity=1.0,
    )
    assert state_at(plan, 8.0, 0.0, 16 / 9).scale == pytest.approx(1.0)
    assert state_at(plan, 8.0, 4.0, 16 / 9).scale == pytest.approx(1.25)
    # Past the window the framing HOLDS rather than snapping back.
    assert state_at(plan, 8.0, 8.0, 16 / 9).scale == pytest.approx(1.5)
    assert state_at(plan, 8.0, 99.0, 16 / 9).scale == pytest.approx(1.5)


def test_zero_duration_clip_does_not_produce_nan():
    plan = CameraMotionPlan(
        preset_id="t", space="2d",
        from_state=CameraState(), to_state=CameraState(scale=1.5),
        easing="linear", start_ratio=0.0, end_ratio=1.0, intensity=1.0,
    )
    state = state_at(plan, 0.0, 0.0, 16 / 9)
    assert math.isfinite(state.scale)
