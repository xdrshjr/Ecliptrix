"""A long FFmpeg command keeps an export alive through its progress file (RV3-02 / RV3-13).

A canvas composite or a long clip is one ``subprocess.run`` that can encode for
more than ten minutes without changing the export stage, so a stall timeout
based on stage and progress alone killed healthy long exports.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from unittest.mock import patch

from app.services.composition.composition_lifecycle import temp_dir_for
from app.services.composition.ffmpeg_args import latest_progress_activity
from app.services.subtitle_service import SubtitleService
from app.services.video_composition_service import VideoCompositionService
from tests.composition_harness import (
    FakeFfmpeg,
    composing,
    composition_request,
    make_service,
    video_item,
)


def _scratch(composition_id: str) -> Path:
    path = Path(temp_dir_for(composition_id))
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_status_reports_activity_while_ffmpeg_writes_progress(tmp_path):
    service = make_service(tmp_path, composition_id="activity-1")
    scratch = _scratch("activity-1")
    try:
        progress = scratch / "progress_normalize_0.txt"
        progress.write_text("frame=10\nprogress=continue\n", encoding="ascii")
        os.utime(progress, (1_000.0, 1_000.0))
        first = service.get_composition_status("activity-1")["activity_at"]
        os.utime(progress, (2_000.0, 2_000.0))
        second = service.get_composition_status("activity-1")["activity_at"]
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    assert (first, second) == (1_000.0, 2_000.0)


def test_activity_follows_a_progress_file_that_ffmpeg_keeps_open(tmp_path):
    # FFmpeg holds its -progress file open for the whole command. On Windows a
    # directory listing keeps the first write's mtime until that handle closes,
    # so the heartbeat froze and a healthy long export hit the stall timeout.
    # Nothing but the poll may touch the file: opening a handle (os.stat does)
    # refreshes the listing and hides the bug, exactly as the real poll must.
    progress = tmp_path / "progress_normalize_0.txt"
    with open(progress, "w", encoding="ascii") as handle:
        handle.write("progress=continue\n")
        handle.flush()
        os.fsync(handle.fileno())
        first_activity = latest_progress_activity(str(tmp_path))
        writes_until = time.monotonic() + 0.2  # let the wall clock tick past the first write
        while time.monotonic() < writes_until:
            handle.write("frame=1\nprogress=continue\n")
            handle.flush()

        activity = latest_progress_activity(str(tmp_path))

        assert activity > first_activity
        assert activity == os.stat(progress).st_mtime


def test_concat_reencode_fallback_reports_progress(tmp_path):
    # The single-track path re-encodes the whole timeline when stream copy
    # fails; that one command can outlast the client's stall timeout too.
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg(fail_when=lambda cmd: "concat" in cmd and "copy" in cmd)
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 3.0)], total_duration=3.0,
    )

    with composing(ffmpeg):
        service._compose_video_sync("comp-1", request)

    reencode = next(c for c in ffmpeg.commands if "concat" in c and "copy" not in c)
    progress_path = reencode[reencode.index("-progress") + 1]
    assert os.path.dirname(progress_path) == temp_dir_for("comp-1")
    assert reencode[-1].endswith("composed_comp-1.mp4")


def test_compositing_progress_interpolates_from_out_time(tmp_path):
    service = make_service(tmp_path, composition_id="activity-2")
    info = service.compositions["activity-2"]
    info.update(stage="compositing", progress=0.7, timeline_end=100.0)
    scratch = _scratch("activity-2")
    try:
        (scratch / "progress_compositing.txt").write_text(
            "out_time_us=N/A\nprogress=continue\nout_time_us=50000000\nprogress=continue\n",
            encoding="ascii",
        )
        status = service.get_composition_status("activity-2")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    assert abs(status["progress"] - 0.8) < 1e-9
    assert info["progress"] == 0.7


def test_the_canvas_command_reports_into_the_composition_scratch_dir(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    request = composition_request(
        video_items=[
            video_item(tmp_path, "base", "video-track-1", 0.0, 6.0),
            video_item(tmp_path, "top", "video-track-2", 2.0, 2.0),
        ],
        total_duration=6.0,
    )

    with composing(ffmpeg):
        service._compose_video_sync("comp-1", request)

    canvas = next(c for c in ffmpeg.commands if any(p.startswith("color=c=black") for p in c))
    progress_path = canvas[canvas.index("-progress") + 1]
    assert progress_path == os.path.join(temp_dir_for("comp-1"), "progress_compositing.txt")
    assert canvas[-1].endswith("composed_comp-1.mp4")


def test_cancelled_queued_composition_returns_without_taking_a_slot(tmp_path):
    service = make_service(tmp_path, composition_id="queued-1")
    service._composition_semaphore = threading.Semaphore(0)  # every slot is busy
    service._cancel_events.track("queued-1")
    service.cancel_composition("queued-1")
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 2.0)], total_duration=2.0,
    )

    with patch.object(
        VideoCompositionService, "_compose_video_sync",
        side_effect=AssertionError("a cancelled queued export must not compose"),
    ):
        service._process_video_composition_async("queued-1", request)

    info = service.compositions["queued-1"]
    assert (info["status"], info["error_details"]["composition_stage"]) == ("failed", "cancelled")
    assert service._composition_semaphore.acquire(blocking=False) is False


def test_subtitle_burn_writes_progress_before_its_output(tmp_path):
    # Burning subtitles into a long export is one command that can outlast the
    # client's stall timeout, so it must report activity like the canvas does.
    service = object.__new__(SubtitleService)
    progress = str(tmp_path / "progress_subtitles.txt")
    output = str(tmp_path / "out.mp4")
    done = subprocess.CompletedProcess([], 0, "", "")

    with patch("app.services.subtitle_service.subprocess.run", return_value=done) as run:
        service.burn_drawtext_filters(
            str(tmp_path / "in.mp4"), output, ["drawtext=text='a'"], str(tmp_path),
            timeout=None, progress_path=progress,
        )

    cmd = run.call_args.args[0]
    assert cmd[cmd.index("-progress") + 1] == progress
    assert cmd[-1] == output


def test_the_subtitle_burn_reports_into_the_composition_scratch_dir(tmp_path):
    service = make_service(tmp_path)
    scratch = str(tmp_path / "scratch")
    subtitles = service.subtitle_service

    with (
        patch.object(service, "_get_video_properties", return_value=(1920, 1080, 30.0)),
        patch.object(subtitles, "build_drawtext_filters_for_items", return_value=["drawtext=text='a'"]),
        patch.object(subtitles, "burn_drawtext_filters") as burn,
    ):
        service._process_subtitle_tracks([], str(tmp_path / "composed.mp4"), scratch)

    expected = os.path.join(scratch, "progress_subtitles.txt")
    assert burn.call_args.kwargs["progress_path"] == expected
