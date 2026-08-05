"""2D / 3D camera motion — export math + filter chain (camera-motion-2d-3d §9.1).

Three jobs:
  1. pin the FFmpeg chain SHAPE, above all the P0-1 regression gate — `rotate`
     has no `on` variable, and using it makes every roll clip fail to normalize;
  2. prove `build_video_filter` is byte-identical to its pre-feature output on
     BOTH return branches when there is no motion (the zero-regression promise);
  3. assert this module agrees with the TypeScript kernel via the committed
     golden vectors — that is what makes "preview == export" a regression gate
     instead of a hope.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import pytest

from app.services.composition.camera_motion import (
    CameraFilterCaps,
    CameraMotionConfig,
    DEGENERATE,
    build_camera_filter_chain,
    compute_crop_rect,
    cover_scale_for_quad,
    ease,
    is_identity_camera_motion,
    keyframe_at,
    project_3d_corners,
    resolve_window,
    roll_cover,
    roll_pad_for_motion,
    scale_quad,
)
from app.services.composition.video_scaling import build_video_filter

W, H = 1920, 1080
ASPECT = W / H


def motion(**overrides):
    base = {
        "version": 1,
        "mode": "2d",
        "preset_id": "custom",
        "intensity": 1.0,
        "easing": "linear",
        "start": {},
        "end": {},
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Math mirror
# ---------------------------------------------------------------------------


class TestMathMirror:
    def test_easing_endpoints_and_midpoints(self):
        for curve in ("linear", "easeIn", "easeOut", "easeInOut"):
            assert ease(0, curve) == pytest.approx(0, abs=1e-12)
            assert ease(1, curve) == pytest.approx(1, abs=1e-12)
        assert ease(0.5, "easeIn") == pytest.approx(0.125)
        assert ease(0.5, "easeOut") == pytest.approx(0.875)
        assert ease(0.5, "easeInOut") == pytest.approx(0.5)

    def test_window_defaults_to_whole_clip(self):
        assert resolve_window(motion(), 6.0) == (0.0, 6.0)

    def test_window_keeps_a_negative_offset_for_split_clips(self):
        assert resolve_window(motion(start_offset=-2, duration=6), 4.0) == (-2.0, 6.0)

    def test_window_does_not_clip_an_explicit_duration(self):
        # The left half of a split keeps the original 6s window on a 2s clip.
        assert resolve_window(motion(start_offset=0, duration=6), 2.0) == (0.0, 6.0)

    def test_window_never_degenerates_at_the_clip_end(self):
        start, duration = resolve_window(motion(start_offset=6), 6.0)
        assert math.isfinite(start) and math.isfinite(duration)
        assert duration >= 0.05

    def test_roll_cover_is_one_at_zero_and_matches_the_anchor(self):
        assert roll_cover(0, ASPECT) == 1.0
        assert roll_cover(10, ASPECT) == pytest.approx(1.293508, abs=1e-4)

    def test_roll_pad_is_one_in_3d(self):
        m = motion(mode="3d", start={"roll": 10}, end={"roll": 10})
        assert roll_pad_for_motion(m, ASPECT) == 1.0

    def test_crop_anchors(self):
        assert compute_crop_rect(keyframe_at(motion(), 0), 1.0) == {
            "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0,
        }
        crop = compute_crop_rect(keyframe_at(motion(start={"scale": 2}, end={"scale": 2}), 0), 1.0)
        assert crop["x"] * W == pytest.approx(480)
        assert crop["w"] * W == pytest.approx(960)

    def test_crop_clamps_at_the_frame_edge(self):
        m = motion(start={"scale": 2, "x": 0.9}, end={"scale": 2, "x": 0.9})
        crop = compute_crop_rect(keyframe_at(m, 0), 1.0)
        assert crop["x"] * W == pytest.approx(960)

    def test_3d_identity_projection(self):
        pts = project_3d_corners(keyframe_at(motion(mode="3d"), 0), ASPECT)
        assert pts is not None
        assert pts[0]["x"] * W == pytest.approx(0, abs=1e-6)
        assert pts[1]["x"] * W == pytest.approx(W, abs=1e-6)
        assert all(p["q"] == pytest.approx(1) for p in pts)
        assert cover_scale_for_quad(pts, ASPECT) == pytest.approx(1, abs=1e-9)

    def test_3d_rotate_y_anchor(self):
        m = motion(mode="3d", start={"rotate_y": 15}, end={"rotate_y": 15})
        pts = project_3d_corners(keyframe_at(m, 0), ASPECT)
        assert pts[0]["x"] * W == pytest.approx(118.47, abs=0.5)
        assert pts[0]["q"] == pytest.approx(0.90743, abs=1e-4)
        assert pts[1]["x"] * W == pytest.approx(1992.72, abs=0.5)
        assert cover_scale_for_quad(pts, ASPECT) == pytest.approx(1.14090, abs=1e-3)

    def test_cover_scale_actually_covers(self):
        m = motion(mode="3d", start={"rotate_y": 15}, end={"rotate_y": 15})
        pts = project_3d_corners(keyframe_at(m, 0), ASPECT)
        cover = cover_scale_for_quad(pts, ASPECT)
        assert cover != DEGENERATE
        assert cover_scale_for_quad(scale_quad(pts, cover), ASPECT) == pytest.approx(1, abs=1e-6)

    def test_identity_rules(self):
        assert is_identity_camera_motion(None) is True
        assert is_identity_camera_motion(motion()) is True
        # intensity 0 with a NON-default start is NOT identity (P1-2).
        assert is_identity_camera_motion(motion(intensity=0, start={"scale": 1.25})) is False
        # intensity 0 with a default start IS identity.
        assert is_identity_camera_motion(motion(intensity=0, end={"scale": 1.25})) is True


# ---------------------------------------------------------------------------
# build_video_filter — zero-regression on BOTH branches (P1-3 / C8)
# ---------------------------------------------------------------------------


class TestBuildVideoFilterZeroRegression:
    NO_PAD = {
        "scale_width": 1920, "scale_height": 1080,
        "pad_width": 1920, "pad_height": 1080,
        "pad_x": 0, "pad_y": 0, "needs_padding": False,
    }
    PAD = {
        "scale_width": 1920, "scale_height": 816,
        "pad_width": 1920, "pad_height": 1080,
        "pad_x": 0, "pad_y": 132, "needs_padding": True,
    }

    def test_no_padding_branch_is_character_identical_without_a_chain(self):
        assert build_video_filter(self.NO_PAD) == "scale=1920:1080,setsar=1:1"
        assert build_video_filter(self.NO_PAD, "") == "scale=1920:1080,setsar=1:1"

    def test_padding_branch_is_character_identical_without_a_chain(self):
        expected = "scale=1920:816,pad=1920:1080:0:132:black,setsar=1:1"
        assert build_video_filter(self.PAD) == expected
        assert build_video_filter(self.PAD, "") == expected

    def test_chain_lands_after_scale_and_before_pad_on_the_padding_branch(self):
        out = build_video_filter(self.PAD, "CAM")
        assert out == "scale=1920:816,CAM,pad=1920:1080:0:132:black,setsar=1:1"
        assert out.index("CAM") < out.index("pad=")

    def test_chain_is_injected_on_the_no_padding_branch_too(self):
        assert build_video_filter(self.NO_PAD, "CAM") == "scale=1920:1080,CAM,setsar=1:1"


# ---------------------------------------------------------------------------
# build_camera_filter_chain — shape + degrade matrix
# ---------------------------------------------------------------------------


class TestFilterChain:
    def chain(self, m, **kwargs):
        kwargs.setdefault("caps", CameraFilterCaps())
        kwargs.setdefault("config", CameraMotionConfig())
        return build_camera_filter_chain(m, W, H, 30, 6.0, **kwargs)

    def test_no_motion_and_identity_motion_produce_an_empty_chain(self):
        assert self.chain(None) == ("", [])
        assert self.chain(motion()) == ("", [])

    def test_plain_2d_emits_the_zoompan_segment_only(self):
        chain, warnings = self.chain(motion(start={"scale": 1}, end={"scale": 1.25}))
        assert warnings == []
        assert chain.startswith("setpts=PTS-STARTPTS,fps=30,")
        assert "zoompan=" in chain
        assert "rotate=" not in chain
        assert "perspective=" not in chain
        assert chain.endswith(f"scale={W}:{H}:flags=bicubic")

    def test_roll_uses_n_not_on_and_crops_back(self):
        """P0-1 + C2 regression gate.

        `rotate` has NO `on` variable — emitting it yields
        "Undefined constant ... 'on/30)*PI/180'" and the clip fails to
        normalize. And without the `crop=iw/RP` + `scale` crop-back the rotated
        corners stay black (P0-2, measured: white-frame corner YAVG 235 → 16).
        """
        chain, warnings = self.chain(motion(start={"roll": -2}, end={"roll": 2}))
        assert warnings == []
        assert "rotate=a='(on/" not in chain
        assert "on/" not in chain.split("rotate=")[1].split(",")[0]
        assert "rotate=a='(" in chain
        assert "(n/30" in chain
        assert "crop=iw/" in chain
        assert chain.endswith(f"scale={W}:{H}:flags=bicubic")

    def test_3d_emits_perspective_with_destination_sense_and_frame_eval(self):
        chain, warnings = self.chain(
            motion(mode="3d", start={"rotate_y": 10}, end={"rotate_y": -10})
        )
        assert warnings == []
        assert "perspective=" in chain
        assert "sense=destination" in chain
        assert "eval=frame" in chain
        # TL, TR, BL, BR
        for key in ("x0=", "y0=", "x1=", "y1=", "x2=", "y2=", "x3=", "y3="):
            assert key in chain

    def test_3d_with_a_scale_component_still_zooms(self):
        """Deviation from spec §4.4.3, recorded in spec §14.

        §4.4.3 annotates the zoompan segment as 2D-only, but §4.3.3 has the
        preview feeding `crop` into the WebGL uv rect for 3D as well. Gating
        zoompan on the mode would silently drop `parallax-push`'s scale
        1 → 1.08 from the export while the preview still shows it.
        """
        chain, _ = self.chain(
            motion(mode="3d", start={"scale": 1, "rotate_y": 6},
                   end={"scale": 1.08, "rotate_y": -6})
        )
        assert "zoompan=" in chain
        assert "perspective=" in chain
        assert chain.index("zoompan=") < chain.index("perspective=")

    def test_disabled_config_drops_the_chain_and_says_so(self):
        chain, warnings = self.chain(
            motion(start={"scale": 1}, end={"scale": 1.25}),
            config=CameraMotionConfig(enabled=False),
        )
        assert chain == ""
        assert any("disabled" in w for w in warnings)

    def test_missing_perspective_degrades_3d_to_its_2d_components(self):
        chain, warnings = self.chain(
            motion(mode="3d", start={"rotate_y": 10, "scale": 1},
                   end={"rotate_y": -10, "scale": 1.2}),
            caps=CameraFilterCaps(perspective=False),
        )
        assert "perspective=" not in chain
        assert "zoompan=" in chain
        assert any("perspective" in w for w in warnings)

    def test_missing_rotate_drops_only_the_roll_component(self):
        chain, warnings = self.chain(
            motion(start={"roll": -5, "scale": 1}, end={"roll": 5, "scale": 1.3}),
            caps=CameraFilterCaps(rotate=False),
        )
        assert "rotate=" not in chain
        assert "zoompan=" in chain
        assert any("roll" in w for w in warnings)

    def test_missing_zoompan_drops_only_the_zoom_component(self):
        chain, warnings = self.chain(
            motion(start={"scale": 1}, end={"scale": 1.4}),
            caps=CameraFilterCaps(zoompan=False),
        )
        assert "zoompan=" not in chain
        assert any("zoompan" in w for w in warnings)

    def test_an_impossible_fit_tolerance_degrades_3d_rather_than_shipping_it(self):
        chain, warnings = self.chain(
            motion(mode="3d", start={"rotate_y": 10}, end={"rotate_y": -10}),
            config=CameraMotionConfig(max_fit_error_px=1e-9),
        )
        assert "perspective=" not in chain
        assert any("fit error" in w for w in warnings)

    def test_supersample_1_skips_the_oversampled_intermediate(self):
        chain, _ = self.chain(
            motion(start={"scale": 1}, end={"scale": 1.25}),
            config=CameraMotionConfig(supersample=1),
        )
        assert f"scale={W}:{H}:flags=bicubic,zoompan=" in chain

    def test_supersample_defaults_to_1_on_measured_evidence(self):
        """§8 P6 / P2-9 gate.

        Measured on a 4K/30fps normalize: no motion 3.01s, 2D push-in 21.26s at
        supersample=2 (7.07x) vs 6.26s at 1 (2.08x). §8 P6 mandates dropping to
        1 once 2D exceeds 3x, so the DEFAULT — not just an opt-in — has to be 1.
        """
        assert CameraMotionConfig().supersample == 1
        chain, _ = self.chain(motion(start={"scale": 1}, end={"scale": 1.25}))
        assert f"scale={W}:{H}:flags=bicubic,zoompan=" in chain

    def test_supersample_2_still_oversamples_when_asked_for(self):
        chain, _ = self.chain(
            motion(start={"scale": 1}, end={"scale": 1.25}),
            config=CameraMotionConfig(supersample=2),
        )
        assert f"scale={W * 2}:{H * 2}:flags=bicubic" in chain

    def test_chain_contains_only_generated_numbers_no_user_strings(self):
        """R11: preset ids / names must never reach a filter expression."""
        chain, _ = self.chain(
            motion(preset_id="'; drop table --", start={"scale": 1}, end={"scale": 1.25})
        )
        assert "drop table" not in chain

    def test_forces_cfr_so_on_over_fps_is_exact_time(self):
        chain, _ = self.chain(motion(start={"scale": 1}, end={"scale": 1.25}))
        assert "fps=30" in chain


# ---------------------------------------------------------------------------
# Cross-language golden vectors (§9.3)
# ---------------------------------------------------------------------------

GOLDEN_PATH = (
    Path(__file__).resolve().parents[3]
    / "src" / "components" / "video" / "playback" / "camera"
    / "__tests__" / "fixtures" / "camera-golden.json"
)


def _load_golden():
    if not GOLDEN_PATH.exists():
        message = f"golden vectors not found at {GOLDEN_PATH}"
        # A permanently-skipped cross-language gate is not a gate. CI sets
        # CAMERA_GOLDEN_REQUIRED=1 so a missing fixture fails loudly there,
        # while a backend-only checkout still collects cleanly (P2-8).
        if os.environ.get("CAMERA_GOLDEN_REQUIRED") == "1":
            pytest.fail(message)
        pytest.skip(message)
    with open(GOLDEN_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _wire_from_camel(motion_camel):
    """Golden vectors are stored in the frontend's camelCase shape."""
    def keyframe(frame):
        return {
            "scale": frame["scale"], "x": frame["x"], "y": frame["y"], "roll": frame["roll"],
            "rotate_x": frame["rotateX"], "rotate_y": frame["rotateY"], "dolly": frame["dolly"],
        }

    return {
        "version": motion_camel["version"],
        "mode": motion_camel["mode"],
        "preset_id": motion_camel.get("presetId"),
        "intensity": motion_camel["intensity"],
        "easing": motion_camel["easing"],
        "start_offset": motion_camel.get("startOffset"),
        "duration": motion_camel.get("duration"),
        "start": keyframe(motion_camel["start"]),
        "end": keyframe(motion_camel["end"]),
    }


def _resolve(motion_wire, t_local, clip_duration, aspect):
    """The Python equivalent of the TS `resolveCameraDraw`."""
    if is_identity_camera_motion(motion_wire):
        return None
    w0, wd = resolve_window(motion_wire, clip_duration)
    u = 1.0 if wd <= 0.05 else min(1.0, max(0.0, (t_local - w0) / wd))
    e = ease(u, motion_wire["easing"])
    k = keyframe_at(motion_wire, e)
    roll_pad = roll_pad_for_motion(motion_wire, aspect)
    crop = compute_crop_rect(k, roll_pad)
    if motion_wire["mode"] != "3d":
        return {"mode": "2d", "crop": crop, "roll": k["roll"], "rollPad": roll_pad, "quad": None}

    from app.services.composition.camera_motion import cover_scale_for_motion

    cover = cover_scale_for_motion(motion_wire, aspect)
    pts = None if cover == DEGENERATE else project_3d_corners(k, aspect)
    if pts is None:
        return {"mode": "3d", "crop": crop, "roll": 0.0, "rollPad": 1.0, "quad": None,
                "degraded": True}
    return {"mode": "3d", "crop": crop, "roll": 0.0, "rollPad": 1.0,
            "quad": scale_quad(pts, cover)}


class TestGoldenVectors:
    def test_python_matches_the_typescript_kernel(self):
        golden = _load_golden()
        aspect = golden["frame"]["w"] / golden["frame"]["h"]
        assert len(golden["cases"]) >= 30

        for case in golden["cases"]:
            wire = _wire_from_camel(case["motion"])
            actual = _resolve(wire, case["t"], case["clipDuration"], aspect)
            expected = case["expect"]
            if expected is None:
                assert actual is None, f"{case['name']}: expected the identity fast path"
                continue
            assert actual is not None, case["name"]
            assert actual["mode"] == expected["mode"], case["name"]
            for index, key in enumerate(("x", "y", "w", "h")):
                assert actual["crop"][key] == pytest.approx(
                    expected["crop"][index], abs=1e-6
                ), f"{case['name']}.crop.{key}"
            assert actual["roll"] == pytest.approx(expected["roll"], abs=1e-6), case["name"]
            assert actual["rollPad"] == pytest.approx(expected["rollPad"], abs=1e-6), case["name"]
            if expected.get("quad"):
                assert actual["quad"] is not None, case["name"]
                for index, point in enumerate(expected["quad"]):
                    assert actual["quad"][index]["x"] == pytest.approx(point[0], abs=1e-6), \
                        f"{case['name']}.quad[{index}].x"
                    assert actual["quad"][index]["y"] == pytest.approx(point[1], abs=1e-6), \
                        f"{case['name']}.quad[{index}].y"
                    assert actual["quad"][index]["q"] == pytest.approx(point[2], abs=1e-6), \
                        f"{case['name']}.quad[{index}].q"
