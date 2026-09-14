"""Content missing from a completed export is reported, not swallowed (S7).

EXO-03: failed subtitle / image / audio / clip-audio passes used to leave the task
``completed`` with ``warnings=[]``. EXO-04: one missing image dropped every
overlay. EXO-16: the composition subtitle burn had a fixed 300 s timeout.
EXO-18: remote images were downloaded with an unbounded ``requests.get``.
"""

import os
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

from app.models.video_models import (
    AudioCompositionItem,
    ImageCompositionItem,
    ImagePosition,
    SubtitleCompositionItem,
)
from app.services.composition.composition_outcome import CompositionStageError
from app.services.video_composition_service import VideoCompositionService, _AudioMergeJob
from tests.composition_harness import (
    MODULE,
    RESOLUTION,
    FakeFfmpeg,
    audio_item,
    camera_seams,
    composing,
    composition_request,
    image_item,
    make_service,
    video_item,
)


def _subtitle() -> SubtitleCompositionItem:
    return SubtitleCompositionItem(
        id="sub-1", name="Line 1", text="hello", start_time=0.0, duration=2.0,
        track_id="subtitle-track-1",
    )


def _degradations(service):
    return service.compositions["comp-1"]["degradations"]


def test_failed_subtitle_pass_reports_subtitles_degradation(tmp_path):
    service = make_service(tmp_path)
    service.subtitle_service = MagicMock()
    service.subtitle_service.build_drawtext_filters_for_items.return_value = ["drawtext=textfile=x"]
    service.subtitle_service.burn_drawtext_filters.side_effect = CompositionStageError(
        "subtitles", "Error while filtering"
    )
    request = composition_request(subtitle_items=[_subtitle()], total_duration=2.0)
    output = service.output_dir / "out.mp4"
    output.write_bytes(b"video")

    with camera_seams(), \
            patch.object(VideoCompositionService, "_get_video_properties", return_value=(64, 36, 30.0)):
        service._process_overlays_sequential([], request, output, str(tmp_path), composition_id="comp-1")

    assert _degradations(service) == [{
        "kind": "subtitles", "item_ids": ["sub-1"], "item_names": ["Line 1"],
        "reason": "Error while filtering",
    }]


def test_missing_audio_item_is_reported_not_silently_dropped(tmp_path):
    service = make_service(tmp_path)
    missing = AudioCompositionItem(
        id="bgm", name="bgm.mp3", url=str(tmp_path / "gone" / "bgm.mp3"),
        start_time=0.0, duration=4.0, track_id="audio-track-2",
    )
    request = composition_request(
        audio_items=[audio_item(tmp_path, "voice", 0.0, 4.0), missing], total_duration=4.0,
    )
    output = service.output_dir / "out.mp4"
    output.write_bytes(b"video")

    def convert(self, url):
        if not os.path.exists(url):
            raise FileNotFoundError(f"Audio file not found: {url}")
        return url

    with patch(f"{MODULE}.subprocess.run", side_effect=FakeFfmpeg()), \
            patch.object(VideoCompositionService, "_convert_url_to_local_path", convert):
        service._mix_audio_into_output(
            _AudioMergeJob("comp-1", request, output, str(tmp_path), "ffmpeg", 4.0), [],
        )

    degradations = _degradations(service)
    assert [(d["kind"], d["item_ids"]) for d in degradations] == [("audio_item", ["bgm"])]
    assert "Audio file not found" in degradations[0]["reason"]


def test_unreadable_clip_audio_probe_failure_is_reported(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg(
        fail_when=lambda cmd: cmd[0].endswith("ffprobe"),
        stderr="clip.mp4: Invalid data found when processing input",
    )
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 3.0)], total_duration=3.0,
    )

    with patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg), \
            patch.object(VideoCompositionService, "_convert_url_to_local_path", lambda self, url: url):
        paths = service._extract_video_audio_tracks(request, str(tmp_path), "ffmpeg", composition_id="comp-1")

    assert paths == []
    (degradation,) = _degradations(service)
    assert (degradation["kind"], degradation["item_ids"]) == ("embedded_audio", ["clip"])
    assert "Invalid data found" in degradation["reason"]


def test_a_missing_local_image_does_not_drop_the_other_overlays(tmp_path):
    """Real `_convert_url_to_local_path`: a missing file raises inside it."""
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    present = image_item(tmp_path, "present", 0.0, 2.0)
    missing = ImageCompositionItem(
        id="missing", name="missing.png", url=str(tmp_path / "media" / "missing.png"),
        start_time=2.0, duration=2.0, track_id="image-track-1",
        position=ImagePosition(x=0.0, y=0.0, width=1.0, height=1.0),
    )
    base = service.output_dir / "base.mp4"
    base.write_bytes(b"video")

    with patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg), camera_seams():
        success, _ = service._process_image_overlays(
            [missing, present], str(base), str(service.output_dir / "base_with_images.mp4"),
            str(tmp_path), RESOLUTION, 30, composition_id="comp-1",
        )

    overlay = ffmpeg.commands[-1]
    assert success is True
    assert present.url in overlay and missing.url not in overlay
    assert [d["item_ids"] for d in _degradations(service)] == [["missing"]]


def test_remote_image_url_is_skipped_with_degradation_and_never_downloaded(tmp_path, monkeypatch):
    download = MagicMock(side_effect=AssertionError("remote images must not be downloaded"))
    monkeypatch.setattr(requests, "get", download)
    service = make_service(tmp_path)
    remote = ImageCompositionItem(
        id="remote", name="cover.png", url="https://cdn.example.com/cover.png?token=secret",
        start_time=0.0, duration=2.0, track_id="image-track-1",
        position=ImagePosition(x=0.0, y=0.0, width=1.0, height=1.0),
    )

    with patch(f"{MODULE}.subprocess.run", side_effect=FakeFfmpeg()), camera_seams(), \
            patch.object(VideoCompositionService, "_convert_url_to_local_path", lambda self, url: url):
        success, _ = service._process_image_overlays(
            [remote], "base.mp4", str(tmp_path / "out.mp4"), str(tmp_path), RESOLUTION, 30,
            composition_id="comp-1",
        )

    assert success is False
    (degradation,) = _degradations(service)
    assert degradation["reason"] == "remote image is not available locally"
    download.assert_not_called()


def test_composition_subtitle_burn_in_has_no_fixed_timeout(tmp_path):
    service = make_service(tmp_path)
    run_kwargs = []

    def fake_run(cmd, *args, **kwargs):
        run_kwargs.append(kwargs)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    video = service.output_dir / "out.mp4"
    video.write_bytes(b"video")
    with patch.object(VideoCompositionService, "_get_video_properties", return_value=(640, 360, 30.0)), \
            patch("app.services.subtitle_service.subprocess.run", side_effect=fake_run):
        subtitled = service._process_subtitle_tracks([_subtitle()], str(video), str(tmp_path))

    assert subtitled.endswith("_with_subtitles.mp4")
    assert run_kwargs and run_kwargs[-1].get("timeout", "missing") is None


def test_the_same_loss_is_recorded_once(tmp_path):
    service = make_service(tmp_path)
    item = image_item(tmp_path, "still", 0.0, 2.0)
    service._record_degradation("comp-1", "image_overlay", [item], "first attempt")
    service._record_degradation("comp-1", "image_overlay", [item], "motion-free retry")
    assert len(_degradations(service)) == 1


def test_clip_without_an_audio_stream_is_silent_not_degraded(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()  # ffprobe succeeds and lists no audio stream
    request = composition_request(
        video_items=[video_item(tmp_path, "mute", "video-track-1", 0.0, 3.0)], total_duration=3.0,
    )

    with patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg), \
            patch.object(VideoCompositionService, "_convert_url_to_local_path", lambda self, url: url):
        paths = service._extract_video_audio_tracks(request, str(tmp_path), "ffmpeg", composition_id="comp-1")

    assert paths == []
    assert [cmd[0] for cmd in ffmpeg.commands] == ["ffprobe"]
    assert _degradations(service) == []


def test_degradation_reason_is_one_short_line_without_url_query_strings(tmp_path):
    service = make_service(tmp_path)
    reason = "https://cdn.example.com/cover.png?X-Amz-Signature=secret refused " + "x" * 400

    service._record_degradation("comp-1", "image_overlay", [image_item(tmp_path, "cover", 0.0, 2.0)], reason)

    (entry,) = _degradations(service)
    assert entry["reason"].startswith("https://cdn.example.com/cover.png refused x")
    assert "secret" not in entry["reason"]
    assert len(entry["reason"]) == 300


def _canvas_command(ffmpeg: FakeFfmpeg):
    return next(c for c in ffmpeg.commands if any(p.startswith("color=c=black") for p in c))


def test_canvas_command_has_one_input_per_run(tmp_path):
    """N-04: a contiguous run is joined first, so the canvas decodes it as one input."""
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    base_run = [video_item(tmp_path, f"base-{n}", "video-track-1", float(n), 1.0) for n in range(5)]
    request = composition_request(
        video_items=[*base_run, video_item(tmp_path, "top", "video-track-2", 1.0, 2.0)],
        total_duration=5.0,
    )

    with composing(ffmpeg):
        response = service._compose_video_sync("comp-1", request)

    concat = next(c for c in ffmpeg.commands if "concat" in c)
    assert response.success is True
    assert _canvas_command(ffmpeg).count("-i") == 2
    assert concat[-1].endswith("run_0.mp4")


def test_canvas_over_the_input_limit_is_refused_before_it_runs(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    request = composition_request(
        video_items=[
            video_item(tmp_path, "base", "video-track-1", 0.0, 4.0),
            video_item(tmp_path, "top", "video-track-2", 1.0, 1.0),
        ],
        total_duration=4.0,
    )

    with composing(ffmpeg), patch(f"{MODULE}.MAX_CANVAS_INPUTS", 1):
        response = service._compose_video_sync("comp-1", request)

    details = service.compositions["comp-1"]["error_details"]
    assert response.success is False
    assert (details["composition_stage"], details["error_summary"]) == (
        "compose", "too many inputs for one FFmpeg command",
    )
    assert not any(any(p.startswith("color=c=black") for p in c) for c in ffmpeg.commands)


def test_command_line_over_the_windows_limit_fails_the_stage_readably(tmp_path):
    """WinError 206 used to surface as an opaque 'finalization' failure (EX3-04)."""

    class _CommandTooLong(OSError):
        winerror = 206

    def refuse_long_canvas(cmd, *args, **kwargs):
        if any(str(part).startswith("color=c=black") for part in cmd):
            raise _CommandTooLong("The filename or extension is too long")
        return FakeFfmpeg()(cmd)

    service = make_service(tmp_path)
    request = composition_request(
        video_items=[
            video_item(tmp_path, "base", "video-track-1", 0.0, 4.0),
            video_item(tmp_path, "top", "video-track-2", 1.0, 1.0),
        ],
        total_duration=4.0,
    )

    with composing(FakeFfmpeg()), patch(f"{MODULE}.subprocess.run", side_effect=refuse_long_canvas):
        service._compose_video_sync("comp-1", request)

    details = service.compositions["comp-1"]["error_details"]
    assert (details["composition_stage"], details["error_summary"]) == (
        "compose", "too many inputs for one FFmpeg command",
    )


def test_400_clip_audio_inputs_keep_every_command_under_limit(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    items = [audio_item(tmp_path, f"a{n:03d}", n * 0.5, 0.5) for n in range(400)]
    request = composition_request(audio_items=items, total_duration=200.0)

    with patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg), \
            patch.object(VideoCompositionService, "_convert_url_to_local_path", lambda self, url: url):
        result = service._process_audio_tracks(request, str(tmp_path / "work"), "ffmpeg", 200.0)

    def inputs_of(cmd):
        return [cmd[i + 1] for i, arg in enumerate(cmd) if arg == "-i"]

    parts = [c for c in ffmpeg.commands if "[out]" in c and "mix_part_" in c[-1]]
    final = [c for c in ffmpeg.commands if "[out]" in c and c[-1].endswith("audio_mix.wav")]
    assert (result.path is not None, result.dropped) == (True, [])
    assert all(len(subprocess.list2cmdline(cmd)) < 32767 for cmd in ffmpeg.commands)
    assert (len(parts), len(final)) == (7, 1)
    assert len(set(path for cmd in parts for path in inputs_of(cmd))) == 400
    assert inputs_of(final[0]) == [cmd[-1] for cmd in parts]
    assert all(cmd[cmd.index("-c:a") + 1] == "pcm_f32le" for cmd in parts)


def test_normalization_progress_advances_per_clip(tmp_path):
    service = make_service(tmp_path)
    recorded = []

    class _RecordingStatus(dict):
        def __setitem__(self, key, value):
            super().__setitem__(key, value)
            if key == "progress":
                recorded.append((self.get("stage"), round(value, 4)))

    service.compositions["comp-1"] = _RecordingStatus(service.compositions["comp-1"])
    clips = [video_item(tmp_path, f"clip-{n}", f"video-track-{n}", 0.0, 2.0) for n in range(3)]

    with composing(FakeFfmpeg()):
        service._compose_video_sync("comp-1", composition_request(video_items=clips, total_duration=2.0))

    assert [p for stage, p in recorded if stage == "normalizing"] == [0.4, 0.5, 0.6, 0.7]


def test_cancel_between_stages_cleans_temp_dir(tmp_path):
    service = make_service(tmp_path)

    def cancel_during_canvas(cmd):
        if any(part.startswith("color=c=black") for part in cmd):
            service.cancel_composition("comp-1")
        return False

    ffmpeg = FakeFfmpeg(fail_when=cancel_during_canvas)
    request = composition_request(
        video_items=[
            video_item(tmp_path, "base", "video-track-1", 0.0, 6.0),
            video_item(tmp_path, "top", "video-track-2", 2.0, 2.0),
        ],
        audio_items=[audio_item(tmp_path, "voice", 0.0, 6.0)],
        total_duration=6.0,
    )

    with composing(ffmpeg):
        response = service._compose_video_sync("comp-1", request)

    info = service.compositions["comp-1"]
    assert response.success is False
    assert (info["status"], info["error_details"]["composition_stage"]) == ("failed", "cancelled")
    assert not any(cmd[-1].endswith("audio_mix.wav") for cmd in ffmpeg.commands)
    assert not (Path(tempfile.gettempdir()) / "video_compose_comp-1").exists()
    assert list(service.output_dir.iterdir()) == []
