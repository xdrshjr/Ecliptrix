"""The still-overlay camera-motion emitter, checked against the geometry kernel.

Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §3.3 / §7.5-27.

The emitter turns a camera move into FFmpeg `perspective` expressions. Reading
those expressions proves nothing — so this module EVALUATES them the way FFmpeg
would (a tiny interpreter for the `st`/`ld`/`clip`/`if` register dialect) and
compares the result, frame by frame, against the same kernel the preview calls.
Anything beyond the emitter's own six-decimal constant rounding fails.

It also pins the three things review flagged as most likely to be quietly wrong:
  * the raster transposition (a straight-through clockwise quad still "looks like
    an effect" — it is a bow-tie fold);
  * the fps divisor (`on` counts the OVERLAY branch's frames, so a wrong divisor
    runs the whole move uniformly fast — nearly invisible per frame);
  * that BOTH overlay assembly points emit a byte-identical motion segment, so
    the move cannot work only when the timeline happens to have a subtitle.
"""

from __future__ import annotations

import math
import re
import subprocess

import pytest

from app.models.video_models import (
    CameraMotionSpec,
    CameraMotionState,
    ImageCompositionItem,
    ImagePosition,
    SubtitleCompositionItem,
)
from app.services.composition.camera_motion import (
    apply_homography_to_rect,
    camera_homography,
    plan_from_spec,
    quad_to_perspective_points,
    state_at,
)
from app.services.composition.camera_motion_overlay import (
    OverlayBox,
    OverlayTiming,
    build_overlay_motion_filter,
    overlay_motion_for_item,
)
from app.services import video_composition_service as service_module
from app.services.video_composition_service import (
    OverlayPassContext,
    VideoCompositionService,
)

# ---------------------------------------------------------------------------
# A minimal evaluator for the FFmpeg expression dialect the emitter uses.
# ---------------------------------------------------------------------------

_POINT_RE = re.compile(r"(?P<axis>[xy])(?P<slot>\d)='(?P<expr>[^']*)'")


def evaluate(expression: str, frame: int) -> float:
    """Evaluate one emitted coordinate expression at output frame ``frame``.

    Mirrors FFmpeg's semantics for the subset the emitter produces: `;`-separated
    statements sharing numbered registers, `st`/`ld`, `clip`, `gte`/`lt`, `if`,
    `pow`, `max`, `sin`/`cos` and the `on` frame counter.
    """
    registers: dict = {}

    def store(index, value):
        registers[int(index)] = value
        return value

    namespace = {
        "st": store,
        "ld": lambda index: registers[int(index)],
        "clip": lambda value, low, high: max(low, min(high, value)),
        "gte": lambda a, b: 1.0 if a >= b else 0.0,
        "lt": lambda a, b: 1.0 if a < b else 0.0,
        "if_": lambda condition, a, b: a if condition else b,
        "pow": lambda a, b: math.pow(a, b),
        "max": max,
        "sin": math.sin,
        "cos": math.cos,
        "on": float(frame),
    }
    value = 0.0
    for statement in expression.split(";"):
        if not statement:
            continue
        value = eval(statement.replace("if(", "if_("), {"__builtins__": {}}, namespace)  # noqa: S307
    return float(value)


def emitted_points(filter_text: str, frame: int) -> list:
    """The eight `perspective` point values at ``frame``, in slot order."""
    slots: dict = {}
    for match in _POINT_RE.finditer(filter_text):
        slots[f"{match.group('axis')}{match.group('slot')}"] = evaluate(
            match.group("expr"), frame
        )
    return [slots[f"{axis}{slot}"] for slot in range(4) for axis in ("x", "y")]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

PRESETS = {
    "ken-burns": CameraMotionSpec(
        preset_id="ken-burns",
        space="2d",
        from_state=CameraMotionState(scale=1.0, offset_x=-0.04, offset_y=0.03),
        to_state=CameraMotionState(scale=1.18, offset_x=0.05, offset_y=-0.02),
        easing="ease-in-out",
        start_ratio=0.0,
        end_ratio=1.0,
        intensity=1.0,
    ),
    "pan-right": CameraMotionSpec(
        preset_id="pan-right",
        space="2d",
        from_state=CameraMotionState(scale=1.0, offset_x=-0.1),
        to_state=CameraMotionState(scale=1.0, offset_x=0.1),
        easing="linear",
        start_ratio=0.1,
        end_ratio=0.9,
        intensity=1.0,
    ),
    "orbit-left": CameraMotionSpec(
        preset_id="orbit-left",
        space="3d",
        from_state=CameraMotionState(yaw=-14.0, dolly=1.05),
        to_state=CameraMotionState(yaw=12.0, pitch=4.0, dolly=0.95),
        easing="ease-out",
        start_ratio=0.0,
        end_ratio=1.0,
        intensity=1.0,
    ),
}

BOXES = [OverlayBox(1536, 864), OverlayBox(640, 480), OverlayBox(320, 320)]

#: Parity budget between the emitted expression and the kernel, in pixels.
#:
#: Not zero, and deliberately so: the emitter renders every folded constant with
#: six decimal places, because short expressions are what keep a busy 3D preset's
#: `-filter_complex` inside the Windows command-line limit (L7). That rounding is
#: the ONLY source of drift here — it grows with the box's pixel size and stays
#: with the box's pixel size and with how much trigonometry a preset animates
#: (measured worst case: 1.4e-4 px, a 3D orbit on a 1536-wide box; 2D presets sit
#: near 1e-6). The metric that actually gates the feature (N1) allows 0.5 px, so
#: this budget is ~500x tighter and still fails instantly on a real geometry
#: mistake, every one of which is off by whole pixels.
TOLERANCE_PX = 1e-3


def kernel_points(spec, box: OverlayBox, timing: OverlayTiming, fps: float, frame: int) -> list:
    """What the shared geometry kernel says the four corners are at ``frame``."""
    plan = plan_from_spec(spec)
    local_time = (frame - 1) / fps - timing.start_time
    aspect = box.width / box.height
    state = state_at(plan, timing.duration, local_time, aspect, enforce_coverage=False)
    H = camera_homography(state, box.width, box.height)
    quad = apply_homography_to_rect(H, 0.0, 0.0, float(box.width), float(box.height))
    return quad_to_perspective_points(quad)


@pytest.mark.parametrize("preset_id", sorted(PRESETS))
@pytest.mark.parametrize("box", BOXES, ids=lambda b: f"{b.width}x{b.height}")
def test_emitted_corners_match_the_kernel(preset_id, box):
    """The export emitter and the preview kernel must agree within TOLERANCE_PX."""
    spec = PRESETS[preset_id]
    timing = OverlayTiming(start_time=1.5, duration=4.0)
    fps = 30.0
    motion = build_overlay_motion_filter(plan_from_spec(spec), box, timing, fps)

    for frame in (1, 15, 46, 90, 165):
        expected = kernel_points(spec, box, timing, fps, frame)
        actual = emitted_points(motion.filter_text, frame)
        for index, (want, got) in enumerate(zip(expected, actual)):
            assert abs(want - got) < TOLERANCE_PX, (
                f"{preset_id} {box.width}x{box.height} frame {frame} point {index}: "
                f"kernel {want} vs emitted {got}"
            )


def test_raster_order_transposes_the_clockwise_quad():
    """Slots 2 and 3 are bottom-LEFT then bottom-RIGHT, not our clockwise order.

    Feeding the clockwise array straight through produces a bow-tie fold that
    still looks like "some effect", which is exactly why it needs its own test.
    """
    box = OverlayBox(400, 200)
    timing = OverlayTiming(start_time=0.0, duration=2.0)
    motion = build_overlay_motion_filter(plan_from_spec(PRESETS["orbit-left"]), box, timing, 30.0)
    points = emitted_points(motion.filter_text, 30)

    plan = plan_from_spec(PRESETS["orbit-left"])
    state = state_at(plan, 2.0, 29 / 30.0, box.width / box.height, enforce_coverage=False)
    clockwise = apply_homography_to_rect(
        camera_homography(state, box.width, box.height), 0.0, 0.0, 400.0, 200.0
    )
    # slot2 == clockwise BL (index 6,7); slot3 == clockwise BR (index 4,5)
    assert abs(points[4] - clockwise[6]) < TOLERANCE_PX
    assert abs(points[5] - clockwise[7]) < TOLERANCE_PX
    assert abs(points[6] - clockwise[4]) < TOLERANCE_PX
    assert abs(points[7] - clockwise[5]) < TOLERANCE_PX


def test_progress_uses_the_measured_fps_not_the_requested_one():
    """25fps source: the divisor and the generated stream must both be 25."""
    box = OverlayBox(640, 360)
    timing = OverlayTiming(start_time=0.0, duration=4.0)
    motion = build_overlay_motion_filter(plan_from_spec(PRESETS["ken-burns"]), box, timing, 25.0)

    assert "(on-1)/25" in motion.filter_text
    assert "/30" not in motion.filter_text
    assert motion.input_options[:4] == ["-loop", "1", "-framerate", "25"]
    # ...and the geometry follows the same clock.
    expected = kernel_points(PRESETS["ken-burns"], box, timing, 25.0, 50)
    actual = emitted_points(motion.filter_text, 50)
    assert max(abs(a - b) for a, b in zip(expected, actual)) < TOLERANCE_PX


def test_still_stream_options_bound_the_generated_frames():
    """`-loop 1` without `-t` would decode frames forever; with it, one past the end."""
    motion = build_overlay_motion_filter(
        plan_from_spec(PRESETS["pan-right"]),
        OverlayBox(320, 180),
        OverlayTiming(start_time=2.0, duration=3.0),
        30.0,
    )
    assert motion.input_options[4] == "-t"
    assert 5.0 < float(motion.input_options[5]) < 5.2
    assert motion.is_animated


def test_scheme_a_emits_neither_margin_pad_nor_crop_nor_format():
    """Review proved all three redundant on real FFmpeg (P1-8); keeping them
    would only reintroduce the `+margin` coordinate trap."""
    motion = build_overlay_motion_filter(
        plan_from_spec(PRESETS["orbit-left"]),
        OverlayBox(512, 288),
        OverlayTiming(start_time=0.0, duration=3.0),
        30.0,
    )
    assert motion.filter_text.startswith("perspective=")
    assert "pad=" not in motion.filter_text
    assert "crop=" not in motion.filter_text
    assert "format=" not in motion.filter_text
    assert "eval=frame" in motion.filter_text
    assert "sense=destination" in motion.filter_text


def test_a_still_pan_is_never_silently_zoomed():
    """N1-c on the export side: coverage must NOT be folded into a still.

    A pure pan at scale 1 would be blown up 20% by the canvas coverage rule —
    the user picks "pan" and gets "zoom while panning". Both sides would make the
    same mistake, so no TS↔Python comparison can see it; only an absolute check
    can (L17).
    """
    box = OverlayBox(600, 300)
    timing = OverlayTiming(start_time=0.0, duration=2.0)
    motion = build_overlay_motion_filter(plan_from_spec(PRESETS["pan-right"]), box, timing, 30.0)
    points = emitted_points(motion.filter_text, 1)

    width = math.hypot(points[2] - points[0], points[3] - points[1])
    assert abs(width - box.width) < TOLERANCE_PX, "the box must keep its size through a pure pan"


def test_no_camera_motion_emits_nothing_at_all():
    """The whole no-motion path must stay byte-identical to the legacy output."""
    item = ImageCompositionItem(
        id="s1", name="s1", url="/tmp/s.png", start_time=0.0, duration=3.0, track_id="t1",
        position=ImagePosition(x=0.1, y=0.1, width=0.8, height=0.8),
    )
    motion = overlay_motion_for_item(
        item, OverlayBox(320, 180), OverlayTiming(0.0, 3.0), 30.0
    )
    assert motion.filter_text == ""
    assert motion.input_options == []
    assert motion.warnings == []
    assert not motion.is_animated


def test_static_fallback_when_ffmpeg_cannot_evaluate_per_frame():
    """A frozen framing is acceptable; an unreported one is not."""

    class Caps:
        has_perspective = True
        perspective_supports_eval_frame = False

    motion = build_overlay_motion_filter(
        plan_from_spec(PRESETS["ken-burns"]),
        OverlayBox(320, 180),
        OverlayTiming(0.0, 3.0),
        30.0,
        Caps(),
    )
    assert "eval=init" in motion.filter_text
    assert "(on-1)" not in motion.filter_text, "a frozen framing must not read the frame counter"
    assert motion.input_options == [], "a frozen framing needs no per-frame stream"
    assert any("camera_motion_static" in w for w in motion.warnings)


def test_missing_perspective_filter_raises_instead_of_dropping_the_effect():
    from app.services.composition.camera_motion_filters import CameraMotionUnsupportedError

    class Caps:
        has_perspective = False
        perspective_supports_eval_frame = False

    with pytest.raises(CameraMotionUnsupportedError):
        build_overlay_motion_filter(
            plan_from_spec(PRESETS["ken-burns"]),
            OverlayBox(320, 180),
            OverlayTiming(0.0, 3.0),
            30.0,
            Caps(),
        )


# ---------------------------------------------------------------------------
# L1 — both assembly points must emit the SAME motion segment.
# ---------------------------------------------------------------------------


class _Caps:
    has_perspective = True
    perspective_supports_eval_frame = True
    perspective_supports_sense = True
    supports_filter_complex_script = True
    version = "test"


@pytest.fixture
def svc(monkeypatch, tmp_path):
    instance = VideoCompositionService.__new__(VideoCompositionService)
    image = tmp_path / "still.png"
    image.write_bytes(b"png")
    monkeypatch.setattr(instance, "_get_ffmpeg_path", lambda: "ffmpeg")
    monkeypatch.setattr(instance, "_get_encoding_params", lambda quality="fast": ["-c:v", "libx264"])
    monkeypatch.setattr(instance, "_convert_url_to_local_path", lambda url: str(image))
    monkeypatch.setattr(instance, "_ensure_even_dimensions", lambda w, h: (w - w % 2, h - h % 2))
    monkeypatch.setattr(instance, "_probe_stream_fps", lambda path: 30.0)
    monkeypatch.setattr(instance, "_overlay_caps", lambda: _Caps())
    return instance


def _still() -> ImageCompositionItem:
    return ImageCompositionItem(
        id="s1", name="s1", url="/tmp/still.png", start_time=1.0, duration=4.0, track_id="t1",
        position=ImagePosition(x=0.1, y=0.2, width=0.5, height=0.4),
        camera_motion=PRESETS["ken-burns"],
    )


def _capture_filter_complex(monkeypatch) -> dict:
    captured = {}

    def run(cmd, capture_output=False, text=False):
        index = cmd.index("-filter_complex")
        captured["filter_complex"] = cmd[index + 1]
        captured["cmd"] = list(cmd)
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(service_module.subprocess, "run", run)
    return captured


def _motion_segment(filter_complex: str) -> str:
    match = re.search(r"perspective=.*?(?=\[img\d+\])", filter_complex)
    assert match, f"no motion segment found in {filter_complex[:120]}"
    return match.group(0)


def test_both_assembly_points_emit_an_identical_motion_segment(svc, monkeypatch, tmp_path):
    """L1: "the move only works when the timeline also has a subtitle" is the
    single hardest bug this feature could ship, so it is made structurally
    impossible and then checked end to end."""
    ctx = OverlayPassContext(
        temp_dir=str(tmp_path), output_resolution={"width": 1920, "height": 1080}, output_fps=30
    )

    captured = _capture_filter_complex(monkeypatch)
    monkeypatch.setattr(service_module.os.path, "getsize", lambda path: 10)
    assert svc._process_image_overlays(
        [_still()], str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4"), ctx
    )
    image_only = _motion_segment(captured["filter_complex"])

    srt = tmp_path / "subs.srt"
    srt.write_text("1\n00:00:00,000 --> 00:00:01,000\nhi\n", encoding="utf-8")
    monkeypatch.setattr(svc, "_create_srt_from_subtitle_items", lambda items, temp: str(srt))
    svc.subtitle_service = type(
        "Stub", (), {"build_drawtext_filters": lambda self, request, directory: (["drawtext=text=x"], None, None)}
    )()
    assert svc._process_overlays_and_subtitles_combined(
        [_still()],
        [SubtitleCompositionItem(id="c1", name="c1", text="hi", start_time=0.0, duration=1.0, track_id="t2")],
        str(tmp_path / "in.mp4"),
        str(tmp_path / "out2.mp4"),
        ctx,
    )
    combined = _motion_segment(captured["filter_complex"])

    assert image_only == combined


def test_a_motionless_still_keeps_the_legacy_chain_byte_for_byte(svc, monkeypatch, tmp_path):
    """N4-②: a timeline nobody added a move to must produce the old command."""
    ctx = OverlayPassContext(
        temp_dir=str(tmp_path), output_resolution={"width": 1920, "height": 1080}, output_fps=30
    )
    still = _still()
    still.camera_motion = None

    captured = _capture_filter_complex(monkeypatch)
    monkeypatch.setattr(service_module.os.path, "getsize", lambda path: 10)
    svc._process_image_overlays([still], str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4"), ctx)

    expected = (
        "[1:v]scale=960:432:force_original_aspect_ratio=decrease,"
        "pad=960:432:(ow-iw)/2:(oh-ih)/2:black@0[img0];"
        "[0:v][img0]overlay=192:216:enable='between(t,1.0,5.0)'[v0]"
    )
    assert captured["filter_complex"] == expected
    assert "-loop" not in captured["cmd"], "a motionless still must not gain input options"
