"""Still-image camera motion — the export-side plan (camera-motion-stills §9.1).

Three properties are worth more than all the others here, and each has its own
class below:

  * **Zero regression.** An image with no camera motion must produce the exact
    string the two inline f-strings produced before this feature existed. Not
    "equivalent" — identical, character for character (D16 / C11). That is what
    makes "we only added a branch" a fact instead of a hope.
  * **The two gates are actually wired.** ``CameraFilterCaps()`` defaults every
    field to True, so a forgotten ``caps`` argument does not fail safe, it fails
    silently OPEN. The still path's failure costs a whole-file re-encode, an
    order of magnitude more than the video path's single clip, so the capability
    probe and the 0.1s dry-run are mandatory, not optional (D26 / C17).
  * **Input options stay next to their ``-i``.** ``-loop`` / ``-t`` /
    ``-framerate`` are INPUT options; one input's worth of drift and they modify
    the next input — or the output — and the command silently means something
    else entirely (D27 / C18).
"""

from __future__ import annotations

import inspect
import os

import pytest

from app.services.composition import camera_motion as cm
from app.services.composition.camera_motion import (
    CameraFilterCaps,
    CameraMotionConfig,
    build_still_overlay_plan,
    contain_fit,
    still_static_chain,
)

# The legacy string, hard-coded on purpose: reading it from `still_static_chain`
# would make this test agree with any future refactor of that function, which is
# precisely what it exists to prevent.
LEGACY_960x540 = (
    "scale=960:540:force_original_aspect_ratio=decrease,"
    "pad=960:540:(ow-iw)/2:(oh-ih)/2:black@0"
)

PUSH_IN = {
    "version": 1, "mode": "2d", "preset_id": "push-in",
    "intensity": 1.0, "easing": "easeInOut",
    "start": {"scale": 1.0, "x": 0.5, "y": 0.5},
    "end": {"scale": 1.25, "x": 0.5, "y": 0.5},
}

IDENTITY = {
    "version": 1, "mode": "2d", "preset_id": "custom",
    "intensity": 1.0, "easing": "linear",
    "start": {}, "end": {},
}


def _config(**overrides) -> CameraMotionConfig:
    """A config that never shells out — the dry-run has its own test."""
    base = {"dry_run_probe": False}
    base.update(overrides)
    return CameraMotionConfig(**base)


def _plan(motion=PUSH_IN, **overrides):
    kwargs = dict(
        nat_w=1600, nat_h=1200, box_w=960, box_h=540,
        fps=30, duration=8.0, start_time=1.6,
        caps=CameraFilterCaps(), label="storyboard-03.png",
        ffmpeg_path="ffmpeg", config=_config(),
    )
    kwargs.update(overrides)
    return build_still_overlay_plan(motion, **kwargs)


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


class TestContainFit:
    @pytest.mark.parametrize(
        "nat_w,nat_h,box_w,box_h,expected",
        [
            (1600, 1200, 960, 540, (720, 540)),   # height-bound 4:3
            (1080, 1920, 960, 540, (304, 540)),   # width-bound portrait, evened
            (960, 540, 960, 540, (960, 540)),     # exact fit — no scaling at all
            (0, 1200, 960, 540, (0, 0)),          # unreadable source
            (1600, 0, 960, 540, (0, 0)),
            (1600, 1200, 0, 540, (0, 0)),
            (1600, 1200, 960, 0, (0, 0)),
        ],
    )
    def test_anchors(self, nat_w, nat_h, box_w, box_h, expected):
        assert contain_fit(nat_w, nat_h, box_w, box_h) == expected

    def test_never_exceeds_the_box_even_when_rounding_up(self):
        """`_even` rounds UP, and a content rect larger than its box would make
        the following `pad` fail with "Padded dimensions cannot be smaller than
        input dimensions" — killing that image's branch outright (§4.2)."""
        for nat_w in range(1900, 1930):
            cw, ch = contain_fit(nat_w, 1080, 1920, 1080)
            assert cw <= 1920 and ch <= 1080, (nat_w, cw, ch)
        assert contain_fit(1919, 1080, 1920, 1080) == (1920, 1080)


# ---------------------------------------------------------------------------
# D16 / C11 — the zero-regression contract
# ---------------------------------------------------------------------------


class TestZeroRegression:
    @pytest.mark.parametrize(
        "motion,overrides",
        [
            (None, {}),                                        # no motion at all
            (IDENTITY, {}),                                    # motion that does nothing
            (PUSH_IN, {"config": _config(stills_enabled=False)}),
            (PUSH_IN, {"nat_w": 0, "nat_h": 0}),               # probe failed
        ],
        ids=["no-motion", "identity", "stills-disabled", "probe-failed"],
    )
    def test_chain_is_character_identical_to_the_legacy_string(self, motion, overrides):
        plan = _plan(motion, **overrides)
        assert plan.chain == LEGACY_960x540
        assert plan.input_args == []
        assert plan.overlay_suffix == ""
        assert plan.animated is False

    def test_the_helper_and_the_plan_agree(self):
        assert still_static_chain(960, 540) == LEGACY_960x540

    def test_no_motion_is_silent(self):
        """A user who never asked for motion gets no warning to read."""
        assert _plan(None).warnings == []
        assert _plan(IDENTITY).warnings == []

    def test_opaque_still_chain_is_byte_identical(self):
        assert still_static_chain(960, 540, opacity=1.0) == LEGACY_960x540
        assert _plan(None, opacity=1.0).chain == LEGACY_960x540

    def test_translucent_still_chain_multiplies_alpha(self):
        """Round 2 EXO-02: image opacity used to be dropped on export."""
        assert _plan(None, opacity=0.5).chain == (
            "scale=960:540:force_original_aspect_ratio=decrease,format=rgba,"
            "pad=960:540:(ow-iw)/2:(oh-ih)/2:color=black@0,colorchannelmixer=aa=0.5000"
        )

    def test_translucent_animated_still_multiplies_alpha_before_placement(self):
        plan = _plan(PUSH_IN, opacity=0.5)
        assert plan.animated is True
        assert "format=rgba,colorchannelmixer=aa=0.5000,setpts=PTS-STARTPTS+" in plan.chain


# ---------------------------------------------------------------------------
# D18 / D17 / D25 — the animated branch
# ---------------------------------------------------------------------------


class TestAnimatedBranch:
    def test_chain_order_is_scale_camera_pad_setpts(self):
        chain = _plan().chain
        # Relative positions only: pinning the whole string would freeze
        # `build_camera_filter_chain`'s internals, which are v1's business.
        i_scale = chain.index("scale=720:540:flags=bicubic")
        i_head = chain.index("setpts=PTS-STARTPTS,fps=30")
        i_zoom = chain.index("zoompan=")
        i_pad = chain.index("pad=960:540:")
        i_shift = chain.index("setpts=PTS-STARTPTS+")
        assert i_scale < i_head < i_zoom < i_pad < i_shift

    def test_camera_acts_on_the_content_rect_not_the_box(self):
        """D18: the motion must run before `pad`, on the 720x540 content rect —
        running it on the padded 960x540 box would dilute the motion by the
        transparent margin and break WYSIWYG against the preview."""
        chain = _plan().chain
        assert "s=720x540" in chain
        assert "s=960x540" not in chain

    def test_input_args_turn_the_still_into_a_stream(self):
        plan = _plan()
        assert plan.animated is True
        assert plan.input_args == ["-loop", "1", "-t", "8.000", "-framerate", "30"]
        assert plan.overlay_suffix == ":eof_action=pass"

    def test_a_static_image_keeps_a_single_frame_input(self):
        plan = _plan(None)
        assert "-loop" not in plan.input_args
        assert "-t" not in plan.input_args
        assert "-framerate" not in plan.input_args
        assert plan.overlay_suffix == ""

    def test_the_timeline_shift_carries_the_start_time(self):
        assert "setpts=PTS-STARTPTS+1.6/TB" in _plan(start_time=1.6).chain


# ---------------------------------------------------------------------------
# D26 / C17 — capability probe and dry-run pre-flight
# ---------------------------------------------------------------------------


class TestGates:
    def test_missing_zoompan_degrades_to_the_static_string(self):
        plan = _plan(caps=CameraFilterCaps(zoompan=False))
        assert plan.animated is False
        assert plan.chain == LEGACY_960x540
        assert len(plan.warnings) == 1
        assert "zoompan" in plan.warnings[0]

    def test_a_failing_dry_run_degrades_to_the_static_string(self, monkeypatch):
        monkeypatch.setattr(
            cm, "dry_run_chain", lambda chain, ffmpeg_path: (False, "Undefined constant"),
        )
        plan = _plan(config=_config(dry_run_probe=True))
        assert plan.animated is False
        assert plan.chain == LEGACY_960x540
        assert len(plan.warnings) == 1
        assert "filter check failed" in plan.warnings[0]

    def test_a_passing_dry_run_keeps_the_motion(self, monkeypatch):
        monkeypatch.setattr(cm, "dry_run_chain", lambda chain, ffmpeg_path: (True, ""))
        plan = _plan(config=_config(dry_run_probe=True))
        assert plan.animated is True
        assert plan.warnings == []

    @pytest.mark.parametrize("name", ["caps", "label", "ffmpeg_path"])
    def test_the_dangerous_arguments_have_no_defaults(self, name):
        """Type-level enforcement of D26 / P1-6. `caps=None` would silently mean
        "assume every filter exists"; `label="image"` would make every warning
        read the same. Neither mistake may be possible to make by omission."""
        parameter = inspect.signature(build_still_overlay_plan).parameters[name]
        assert parameter.default is inspect.Parameter.empty
        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY


# ---------------------------------------------------------------------------
# Degrade paths — never silent, never fatal (G4)
# ---------------------------------------------------------------------------


class TestDegradePaths:
    @pytest.mark.parametrize(
        "overrides,fragment",
        [
            ({"config": _config(stills_enabled=False)}, "disabled on the server"),
            ({"nat_w": 0, "nat_h": 0}, "could not read the image dimensions"),
            ({"nat_w": 8000, "nat_h": 6000,
              "config": _config(stills_max_source_pixels=33_177_600 // 2)}, "limit"),
            ({"caps": CameraFilterCaps(zoompan=False)}, "zoompan"),
            ({"box_w": 0, "box_h": 0}, "too small"),
        ],
        ids=["stills-off", "probe-failed", "too-many-source-pixels", "no-zoompan", "no-box"],
    )
    def test_each_path_produces_exactly_one_named_warning(self, overrides, fragment):
        plan = _plan(**overrides)
        assert plan.animated is False
        assert len(plan.warnings) == 1
        assert fragment in plan.warnings[0]
        # §6.1: the clip name comes first, so a multi-image export says WHICH one.
        assert plan.warnings[0].startswith("storyboard-03.png: ")

    def test_the_brake_gates_the_source_image_not_the_content_rect(self):
        """C19 / D28. The content rect here is a tiny 320x240 — the old
        `max_content_pixels` design would sail straight through, because the
        content rect is bounded by the output resolution by construction. The
        cost that actually hurts is decoding the 48-megapixel original."""
        plan = _plan(nat_w=8000, nat_h=6000, box_w=320, box_h=240,
                     config=_config(stills_max_source_pixels=33_177_600))
        assert plan.animated is False
        assert len(plan.warnings) == 1
        assert "8000x6000" in plan.warnings[0]

    def test_a_source_under_the_brake_still_animates(self):
        plan = _plan(nat_w=7680, nat_h=4320, config=_config())
        assert plan.animated is True
        assert plan.warnings == []


# ---------------------------------------------------------------------------
# D27 / C18 — single-pass assembly in the service layer
# ---------------------------------------------------------------------------


class _Position:
    def __init__(self, x=0.0, y=0.0, width=1.0, height=1.0):
        self.x, self.y, self.width, self.height = x, y, width, height
        self.z_index = 10


class _Item:
    def __init__(self, name, url, motion=None, start_time=1.6, duration=8.0):
        self.id = name
        self.name = name
        self.url = url
        self.start_time = start_time
        self.duration = duration
        self.position = _Position()
        self.camera_motion = motion


@pytest.fixture
def service(monkeypatch, tmp_path):
    """A bare service instance with only the I/O seams stubbed."""
    from app.services.video_composition_service import VideoCompositionService

    instance = object.__new__(VideoCompositionService)
    monkeypatch.setattr(
        type(instance), "_convert_url_to_local_path", lambda self, url: url, raising=True,
    )
    monkeypatch.setattr(
        type(instance), "_probe_image_size", lambda self, path: (1600, 1200), raising=True,
    )
    monkeypatch.setattr(
        type(instance), "_get_camera_caps", lambda self, p: CameraFilterCaps(), raising=True,
    )
    monkeypatch.setattr(
        type(instance), "_get_camera_config", lambda self: _config(), raising=True,
    )
    return instance


@pytest.fixture
def two_images(tmp_path):
    paths = []
    for name in ("moving.png", "static.png"):
        path = tmp_path / name
        path.write_bytes(b"not-a-real-png")
        paths.append(str(path))
    return paths


class TestSinglePassAssembly:
    def test_input_options_sit_immediately_before_their_own_input(self, service, two_images):
        moving, static = two_images
        items = [_Item("moving.png", moving, PUSH_IN), _Item("static.png", static)]

        cmd, entries, warnings, skipped = service._build_still_overlay_inputs(
            items, "base.mp4", os.path.dirname(moving),
            {"width": 1920, "height": 1080}, 30, "ffmpeg",
        )

        assert [e['plan'].animated for e in entries] == [True, False]
        assert warnings == []
        assert skipped == []

        for entry, path in zip(entries, (moving, static)):
            k = cmd.index(path)
            assert cmd[k - 1] == '-i'
            args = entry['plan'].input_args
            if args:
                assert cmd[k - 1 - len(args):k - 1] == args
            else:
                # The image with no motion must have NOTHING extra in front of
                # its `-i` — that is the zero-regression face of D17.
                assert cmd[k - 2] == 'ffmpeg' or cmd[k - 2].endswith('.png') or cmd[k - 2].endswith('.mp4')

        # And the base video input is untouched by any of it.
        assert cmd[:4] == ["ffmpeg", "-y", "-i", "base.mp4"]

    def test_labels_follow_input_order(self, service, two_images):
        moving, static = two_images
        items = [_Item("moving.png", moving, PUSH_IN), _Item("static.png", static)]
        _, entries, _, _ = service._build_still_overlay_inputs(
            items, "base.mp4", os.path.dirname(moving),
            {"width": 1920, "height": 1080}, 30, "ffmpeg",
        )
        parts, final = service._build_still_overlay_filters(entries)
        assert parts[0].startswith("[1:v]")
        assert parts[0].endswith("[img0]")
        assert parts[1].startswith("[0:v][img0]")
        assert ":eof_action=pass[v0]" in parts[1]
        assert parts[2].startswith("[2:v]")
        assert parts[3].startswith("[v0][img1]")
        assert ":eof_action=pass" not in parts[3]
        assert final == "[v1]"

    def test_disable_camera_reproduces_the_pre_feature_command(self, service, two_images):
        moving, static = two_images
        items = [_Item("moving.png", moving, PUSH_IN), _Item("static.png", static)]
        cmd, entries, _, _ = service._build_still_overlay_inputs(
            items, "base.mp4", os.path.dirname(moving),
            {"width": 1920, "height": 1080}, 30, "ffmpeg", disable_camera=True,
        )
        assert cmd == ["ffmpeg", "-y", "-i", "base.mp4", "-i", moving, "-i", static]
        parts, _ = service._build_still_overlay_filters(entries)
        assert all(p.animated is False for p in (e['plan'] for e in entries))
        assert parts[0] == (
            "[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black@0[img0]"
        )
        # Round 2 RV-09: half-open window, adjacent images never share a frame.
        assert parts[1] == "[0:v][img0]overlay=0:0:enable='gte(t,1.6)*lt(t,9.6)'[v0]"

    def test_an_unresolvable_image_is_skipped_without_shifting_labels(self, service, two_images):
        moving, _ = two_images
        items = [_Item("gone.png", "/nope/gone.png", PUSH_IN), _Item("moving.png", moving, PUSH_IN)]
        cmd, entries, _, skipped = service._build_still_overlay_inputs(
            items, "base.mp4", os.path.dirname(moving),
            {"width": 1920, "height": 1080}, 30, "ffmpeg",
        )
        assert len(entries) == 1
        # Reported to the caller as a degradation, never downloaded (EXO-04 / EXO-18).
        assert [s.item.url for s in skipped] == ["/nope/gone.png"]
        k = cmd.index(moving)
        assert cmd[k - 1] == '-i'
        assert cmd[k - 1 - 6:k - 1] == entries[0]['plan'].input_args


# ---------------------------------------------------------------------------
# Service wiring (source-level, matching test_camera_motion_warnings' style)
# ---------------------------------------------------------------------------


class TestServiceWiring:
    def test_both_overlay_branches_use_the_single_constructor(self):
        from app.services import video_composition_service as module

        for name in ("_process_image_overlays", "_process_overlays_and_subtitles_combined"):
            source = inspect.getsource(getattr(module.VideoCompositionService, name))
            # H3 / R17: motion in only one branch means "add a subtitle and the
            # camera motion disappears" — an almost undiagnosable bug report.
            assert "_build_still_overlay_inputs" in source, name
            assert "_build_still_overlay_filters" in source, name
            # D22: the retry rebuilds the whole command, input args included.
            assert "disable_camera=True" in source, name

    def test_the_fallback_path_returns_its_warnings(self):
        from app.services import video_composition_service as module

        signature = inspect.signature(module.VideoCompositionService._process_overlays_sequential)
        assert signature.return_annotation != inspect.Signature.empty
        source = inspect.getsource(module.VideoCompositionService._process_overlays_sequential)
        assert "return warnings" in source

    def test_the_compose_loop_records_overlay_warnings(self):
        from app.services import video_composition_service as module

        source = inspect.getsource(module.VideoCompositionService._compose_video_sync)
        # Three call sites: merged, image-only, and the sequential fallback.
        assert source.count("_record_composition_warnings") == 4
