"""L11 — camera motion must never degrade into a silent concat fallback.

Plan: docs/plans/timeline-camera-motion/experiment-plan.md §9 L11 / R-P0-4.

The pre-existing behaviour of ``_compose_videos_filtergraph`` was: FFmpeg exits
non-zero → log one line → return False → the caller runs ``_concat_videos``.
``concat`` copies streams untouched, so for a timeline WITH camera motion that
path delivers a video with no effect while reporting a successful export. There
is no error to notice and nothing in the UI to see — the user only finds out by
watching the result.

These tests pin the replacement contract:
  * no motion  → unchanged, concat fallback still allowed;
  * motion     → retried once with a static framing, and if that fails too the
                 error propagates so the composition is marked failed.
"""

from __future__ import annotations

import subprocess

import pytest

from app.models.video_models import (
    CameraMotionSpec,
    CameraMotionState,
    VideoCompositionItem,
    VideoCompositionRequest,
)
from app.services import video_composition_service as service_module
from app.services.video_composition_service import VideoCompositionService


def motion() -> CameraMotionSpec:
    return CameraMotionSpec(
        preset_id="zoom-in",
        space="2d",
        from_state=CameraMotionState(scale=1.0),
        to_state=CameraMotionState(scale=1.25),
        easing="ease-in-out",
        start_ratio=0.0,
        end_ratio=1.0,
        intensity=1.0,
    )


def clip(clip_id: str, with_motion: bool) -> VideoCompositionItem:
    return VideoCompositionItem(
        id=clip_id,
        name=clip_id,
        url=f"/tmp/{clip_id}.mp4",
        start_time=0.0,
        duration=4.0,
        track_id="t1",
        clip_start=0.0,
        clip_end=4.0,
        opacity=0.5,  # keeps the builder off the concat shortcut in both cases
        camera_motion=motion() if with_motion else None,
    )


def request_with(with_motion: bool) -> VideoCompositionRequest:
    return VideoCompositionRequest(
        task_id="task-1",
        video_items=[clip("a", with_motion), clip("b", with_motion=False)],
        total_duration=8.0,
    )


class _Caps:
    has_perspective = True
    perspective_supports_eval_frame = True
    perspective_supports_sense = True
    supports_filter_complex_script = True
    version = "test"


@pytest.fixture
def svc(monkeypatch):
    """A service instance without the heavy __init__ (ffmpeg probe, dirs, ...)."""
    instance = VideoCompositionService.__new__(VideoCompositionService)
    instance._gpu_encoder = None
    monkeypatch.setattr(instance, "_get_encoding_params", lambda quality="fast": ["-c:v", "libx264"])
    monkeypatch.setattr(service_module.ffmpeg_caps, "probe", lambda path: _Caps())
    return instance


def _result(returncode: int) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["ffmpeg"], returncode=returncode, stdout="", stderr="boom"
    )


def test_request_has_camera_motion_detects_any_clip():
    assert VideoCompositionService._request_has_camera_motion(request_with(True)) is True
    assert VideoCompositionService._request_has_camera_motion(request_with(False)) is False


def test_failure_without_motion_still_allows_the_concat_fallback(svc, monkeypatch, tmp_path):
    """The long-standing behaviour is untouched for timelines we did not change."""
    monkeypatch.setattr(svc, "_run_filtergraph", lambda *a, **k: _result(1))

    outcome = svc._compose_videos_filtergraph(
        request_with(False),
        ["/tmp/a.mp4", "/tmp/b.mp4"],
        tmp_path / "out.mp4",
        "ffmpeg",
        {"width": 1920, "height": 1080},
    )
    assert outcome.composited is False
    assert outcome.warnings == []


def test_failure_with_motion_retries_static_then_raises(svc, monkeypatch, tmp_path):
    """Both attempts fail → the export must FAIL, not quietly lose the effect."""
    calls = []

    # `caps` is the last parameter: the script-file diversion is gated on the
    # capability probe, so the runner needs the same record the planner used.
    def always_fail(plan, inputs, output_path, ffmpeg_path, caps=None):
        calls.append(plan.filter_complex)
        return _result(1)

    monkeypatch.setattr(svc, "_run_filtergraph", always_fail)

    with pytest.raises(RuntimeError) as excinfo:
        svc._compose_videos_filtergraph(
            request_with(True),
            ["/tmp/a.mp4", "/tmp/b.mp4"],
            tmp_path / "out.mp4",
            "ffmpeg",
            {"width": 1920, "height": 1080},
        )

    assert len(calls) == 2, "the static-framing retry must be attempted before giving up"
    assert "eval=frame" in calls[0]
    assert "eval=init" in calls[1], "the retry must drop per-frame evaluation"
    # The message has to be actionable, not just a stack trace.
    message = str(excinfo.value)
    assert "Camera motion" in message
    assert "FFmpeg" in message


def test_static_retry_success_reports_a_warning(svc, monkeypatch, tmp_path):
    """A degraded render is acceptable; an UNREPORTED one is not."""
    attempts = {"n": 0}

    def fail_then_succeed(plan, inputs, output_path, ffmpeg_path, caps=None):
        attempts["n"] += 1
        return _result(1) if attempts["n"] == 1 else _result(0)

    monkeypatch.setattr(svc, "_run_filtergraph", fail_then_succeed)

    outcome = svc._compose_videos_filtergraph(
        request_with(True),
        ["/tmp/a.mp4", "/tmp/b.mp4"],
        tmp_path / "out.mp4",
        "ffmpeg",
        {"width": 1920, "height": 1080},
    )
    assert outcome.composited is True
    assert outcome.warnings, "a silent degradation is the failure mode this feature must avoid"
    assert any("camera_motion_static" in w for w in outcome.warnings)


def test_missing_normalized_input_with_motion_raises(svc, monkeypatch, tmp_path):
    """A missing input used to silently mean concat; with motion it must not."""
    monkeypatch.setattr(svc, "_run_filtergraph", lambda *a, **k: _result(0))

    with pytest.raises(RuntimeError) as excinfo:
        svc._compose_videos_filtergraph(
            request_with(True),
            [],  # no normalized paths at all
            tmp_path / "out.mp4",
            "ffmpeg",
            {"width": 1920, "height": 1080},
        )
    assert "concat" in str(excinfo.value)


def test_unsupported_ffmpeg_surfaces_as_a_runtime_error(svc, monkeypatch, tmp_path):
    """Tier 3: no `perspective` filter → fail loudly with a fixable message."""

    class NoPerspective(_Caps):
        has_perspective = False
        perspective_supports_eval_frame = False

    monkeypatch.setattr(service_module.ffmpeg_caps, "probe", lambda path: NoPerspective())
    monkeypatch.setattr(svc, "_run_filtergraph", lambda *a, **k: _result(0))

    with pytest.raises(RuntimeError) as excinfo:
        svc._compose_videos_filtergraph(
            request_with(True),
            ["/tmp/a.mp4", "/tmp/b.mp4"],
            tmp_path / "out.mp4",
            "ffmpeg",
            {"width": 1920, "height": 1080},
        )
    assert "perspective" in str(excinfo.value)


def test_large_filtergraph_is_passed_as_a_script_file(svc, monkeypatch, tmp_path):
    """L7: keep the Windows CreateProcess command line out of danger."""
    captured = {}

    def capture(cmd, capture_output, text):
        captured["cmd"] = list(cmd)
        # The script file must still exist while FFmpeg would be reading it.
        index = cmd.index("-filter_complex_script")
        captured["script"] = open(cmd[index + 1], encoding="utf-8").read()
        return _result(0)

    monkeypatch.setattr(service_module.subprocess, "run", capture)

    class BigPlan:
        filter_complex = "x" * (service_module.FILTER_COMPLEX_INLINE_LIMIT + 1)
        output_label = "[vout]"

    svc._run_filtergraph(BigPlan(), ["/tmp/a.mp4"], tmp_path / "out.mp4", "ffmpeg")

    assert "-filter_complex" not in captured["cmd"]
    assert "-filter_complex_script" in captured["cmd"]
    assert captured["script"] == BigPlan.filter_complex
    # ...and cleaned up afterwards, so exports do not litter the output dir.
    script_index = captured["cmd"].index("-filter_complex_script")
    assert not (tmp_path / captured["cmd"][script_index + 1]).exists()


def test_small_filtergraph_stays_inline(svc, monkeypatch, tmp_path):
    captured = {}

    def capture(cmd, capture_output, text):
        captured["cmd"] = list(cmd)
        return _result(0)

    monkeypatch.setattr(service_module.subprocess, "run", capture)

    class SmallPlan:
        filter_complex = "[0:v]null[vout]"
        output_label = "[vout]"

    svc._run_filtergraph(SmallPlan(), ["/tmp/a.mp4"], tmp_path / "out.mp4", "ffmpeg")
    assert "-filter_complex" in captured["cmd"]
    assert "-filter_complex_script" not in captured["cmd"]


def test_large_filtergraph_inlines_when_the_build_has_no_script_option(
    svc, monkeypatch, tmp_path
):
    """A build without `-filter_complex_script` must inline, not fail.

    Handing an unknown option to such a build would fail the encode; with camera
    motion present the retry ladder would then blame `eval=frame` and hand the
    user a static framing for a reason that has nothing to do with the real
    problem. 8 KB is our own threshold, a quarter of the OS ceiling, so inlining
    stays correct — it just gives up the safety margin.
    """
    captured = {}

    def capture(cmd, capture_output, text):
        captured["cmd"] = list(cmd)
        return _result(0)

    monkeypatch.setattr(service_module.subprocess, "run", capture)

    class NoScriptCaps:
        supports_filter_complex_script = False

    class BigPlan:
        filter_complex = "x" * (service_module.FILTER_COMPLEX_INLINE_LIMIT + 1)
        output_label = "[vout]"

    svc._run_filtergraph(
        BigPlan(), ["/tmp/a.mp4"], tmp_path / "out.mp4", "ffmpeg", NoScriptCaps()
    )

    assert "-filter_complex_script" not in captured["cmd"]
    index = captured["cmd"].index("-filter_complex")
    assert captured["cmd"][index + 1] == BigPlan.filter_complex
