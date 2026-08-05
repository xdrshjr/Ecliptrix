"""L-I1 / L-I2 — a still's camera motion must never be dropped silently.

Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §5 / §7.4-19d.

The pre-existing behaviour of the overlay orchestration was: the image pass
returns False (or throws) → one `logger.warning` → the composition is marked
`completed` anyway. The user downloads a "successful" export with no image on it
at all, and nothing anywhere says so. Once a still can carry a camera move, that
same path also swallows the effect the user explicitly applied.

These tests pin the replacement contract, and they are deliberately written
against the ORCHESTRATION block rather than the emitters: the emitters can be
perfect and the export still ships wrong, because only the orchestration can
mark a composition `failed`.

  * no camera motion → unchanged, a failed overlay pass still warns and carries
    on (widening that is a different, much larger behaviour change);
  * camera motion + combined pass fails → the sequential ladder is tried, and if
    that recovers the effect the export succeeds;
  * camera motion + every ladder rung fails → RuntimeError, so the outer handler
    marks the composition failed.
"""

from __future__ import annotations

import pytest

from app.models.video_models import (
    CameraMotionSpec,
    CameraMotionState,
    ImageCompositionItem,
    ImagePosition,
    SubtitleCompositionItem,
    VideoCompositionItem,
    VideoCompositionRequest,
)
from app.services.video_composition_service import (
    OverlayPassContext,
    VideoCompositionService,
)


def motion() -> CameraMotionSpec:
    return CameraMotionSpec(
        preset_id="ken-burns",
        space="2d",
        from_state=CameraMotionState(scale=1.0),
        to_state=CameraMotionState(scale=1.2, offset_x=0.05),
        easing="ease-in-out",
        start_ratio=0.0,
        end_ratio=1.0,
        intensity=1.0,
    )


def still(with_motion: bool) -> ImageCompositionItem:
    return ImageCompositionItem(
        id="still-1",
        name="still-1",
        url="/tmp/still.png",
        start_time=0.0,
        duration=4.0,
        track_id="t1",
        position=ImagePosition(x=0.1, y=0.1, width=0.8, height=0.8),
        camera_motion=motion() if with_motion else None,
    )


def subtitle() -> SubtitleCompositionItem:
    return SubtitleCompositionItem(
        id="sub-1", name="sub-1", text="hi", start_time=0.0, duration=2.0, track_id="t2"
    )


def request_with(with_motion: bool, with_subtitles: bool) -> VideoCompositionRequest:
    return VideoCompositionRequest(
        task_id="task-1",
        video_items=[
            VideoCompositionItem(
                id="v1", name="v1", url="/tmp/v1.mp4", start_time=0.0, duration=4.0, track_id="t0"
            )
        ],
        image_items=[still(with_motion)],
        subtitle_items=[subtitle()] if with_subtitles else [],
        total_duration=4.0,
    )


@pytest.fixture
def svc():
    """A service instance without the heavy __init__ (ffmpeg probe, dirs, ...)."""
    return VideoCompositionService.__new__(VideoCompositionService)


@pytest.fixture
def ctx(tmp_path):
    return OverlayPassContext(
        temp_dir=str(tmp_path), output_resolution={"width": 1920, "height": 1080}, output_fps=30
    )


def _output(tmp_path):
    path = tmp_path / "out.mp4"
    path.write_bytes(b"video")
    return path


def _producing(flag: bool):
    """A fake overlay pass that writes its output file iff it reports success."""

    def run(*args, **kwargs):
        output_path = args[2] if len(args) > 2 else kwargs["output_path"]
        if flag:
            with open(output_path, "wb") as handle:
                handle.write(b"overlaid")
        return flag

    return run


def test_image_only_failure_without_motion_stays_a_warning(svc, ctx, tmp_path, monkeypatch):
    """The long-standing behaviour is untouched for stills we did not change."""
    monkeypatch.setattr(svc, "_process_image_overlays", _producing(False))

    svc._apply_overlay_passes(request_with(False, with_subtitles=False), _output(tmp_path), ctx)


def test_image_only_failure_with_motion_fails_the_export(svc, ctx, tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_process_image_overlays", _producing(False))

    with pytest.raises(RuntimeError) as excinfo:
        svc._apply_overlay_passes(request_with(True, with_subtitles=False), _output(tmp_path), ctx)
    message = str(excinfo.value)
    assert "still-1" in message, "the message must name the clip whose effect was lost"
    assert "camera motion" in message.lower()


def test_combined_failure_with_motion_falls_back_then_fails(svc, ctx, tmp_path, monkeypatch):
    """combined returns False → the sequential ladder runs → still no effect → fail."""
    calls = []

    def combined(*args, **kwargs):
        calls.append("combined")
        return False

    def sequential(*args, **kwargs):
        calls.append("sequential")
        return False

    monkeypatch.setattr(svc, "_process_overlays_and_subtitles_combined", combined)
    monkeypatch.setattr(svc, "_process_overlays_sequential", sequential)

    with pytest.raises(RuntimeError):
        svc._apply_overlay_passes(request_with(True, with_subtitles=True), _output(tmp_path), ctx)
    assert calls == ["combined", "sequential"], "the fallback ladder must still be tried first"


def test_combined_exception_with_motion_falls_back_then_fails(svc, ctx, tmp_path, monkeypatch):
    """The `except Exception` rung is the one that used to swallow everything."""
    calls = []

    def combined(*args, **kwargs):
        calls.append("combined")
        raise RuntimeError("ffmpeg exploded")

    def sequential(*args, **kwargs):
        calls.append("sequential")
        return False

    monkeypatch.setattr(svc, "_process_overlays_and_subtitles_combined", combined)
    monkeypatch.setattr(svc, "_process_overlays_sequential", sequential)

    with pytest.raises(RuntimeError):
        svc._apply_overlay_passes(request_with(True, with_subtitles=True), _output(tmp_path), ctx)
    assert calls == ["combined", "sequential"]


def test_sequential_recovery_with_motion_is_a_success(svc, ctx, tmp_path, monkeypatch):
    """A degraded PATH is fine as long as the effect actually made it in."""
    monkeypatch.setattr(svc, "_process_overlays_and_subtitles_combined", _producing(False))
    monkeypatch.setattr(svc, "_process_overlays_sequential", lambda *a, **k: True)

    svc._apply_overlay_passes(request_with(True, with_subtitles=True), _output(tmp_path), ctx)


def test_successful_image_pass_replaces_the_output(svc, ctx, tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_process_image_overlays", _producing(True))

    output = _output(tmp_path)
    svc._apply_overlay_passes(request_with(True, with_subtitles=False), output, ctx)
    assert output.read_bytes() == b"overlaid", "the overlaid render must replace the input"


def test_no_images_is_a_no_op_even_with_a_motion_guard(svc, ctx, tmp_path, monkeypatch):
    """A timeline with neither stills nor subtitles must not touch the output."""
    request = request_with(False, with_subtitles=False)
    request.image_items = []

    output = _output(tmp_path)
    svc._apply_overlay_passes(request, output, ctx)
    assert output.read_bytes() == b"video"
