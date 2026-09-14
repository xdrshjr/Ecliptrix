"""
Video composition follows the timeline, not the sum of its clips (round 2).

EXV-03: the export lasts until the latest item ends. EXV-07: a failed canvas
composite fails the task instead of concatenating every track. EXV-10: a
normalized clip has an exact frame count. EXO-06: an image + audio timeline
exports over a black canvas without any video item.
"""

from unittest.mock import MagicMock, patch

from app.models.video_models import AspectRatio, VideoCompositionItem
from app.services.composition.composition_outcome import frame_count_for
from app.services.composition.media_probe import VideoStreamInfo
from app.services.video_composition_service import VideoCompositionService
from tests.composition_harness import (
    MODULE,
    FakeFfmpeg,
    audio_item,
    composing,
    composition_request,
    image_item,
    make_service,
    media_file,
    video_item,
)


def _two_track_videos(tmp_path):
    return [
        video_item(tmp_path, "base", "video-track-1", 0.0, 6.0),
        video_item(tmp_path, "top", "video-track-2", 2.0, 2.0),
    ]


def test_total_duration_is_timeline_max_end_not_clip_sum(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    request = composition_request(
        video_items=_two_track_videos(tmp_path),
        audio_items=[audio_item(tmp_path, "voice", 0.0, 6.0), audio_item(tmp_path, "sting", 1.0, 2.0)],
        total_duration=6.0,
    )

    with composing(ffmpeg):
        response = service._compose_video_sync("comp-1", request)

    assert response.success is True
    mix = next(c for c in ffmpeg.commands if c[-1].endswith("audio_mix.wav") and "[out]" in c)
    assert mix[mix.index("-t") + 1] == "6.0"


def test_audio_merge_never_uses_shortest(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 25.0)],
        audio_items=[audio_item(tmp_path, "short", 0.0, 13.0)],
        total_duration=25.0,
    )

    with composing(ffmpeg):
        service._compose_video_sync("comp-1", request)

    merge = next(c for c in ffmpeg.commands if "aac" in c)
    assert "-shortest" not in merge


def test_filtergraph_failure_marks_composition_failed_instead_of_concat(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg(fail_when=lambda cmd: "-filter_complex" in cmd)
    request = composition_request(video_items=_two_track_videos(tmp_path), total_duration=6.0)

    with composing(ffmpeg), patch.object(VideoCompositionService, "_concat_videos") as concat:
        response = service._compose_video_sync("comp-1", request)

    info = service.compositions["comp-1"]
    assert response.success is False
    assert (info["status"], info["task_id"]) == ("failed", "task-1")
    assert info["error_details"]["composition_stage"] == "compose"
    assert info["error_details"]["error_summary"] == "Invalid argument"
    concat.assert_not_called()


def test_normalized_clip_uses_exact_frame_count(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    capture = MagicMock()
    capture.get.return_value = 300  # frames → a 10 s source at 30 fps
    video_info = {
        'video_path': media_file(tmp_path, "source.mp4"), 'index': 0, 'temp_dir': str(tmp_path),
        'target_fps': 30, 'ffmpeg_path': 'ffmpeg', 'clip_start': 0.0, 'clip_end': 2.345,
        'target_aspect_ratio': AspectRatio.RATIO_16_9, 'camera_motion': None, 'camera_label': 'clip',
    }

    with patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg), \
            patch.object(VideoCompositionService, "_cv2_video_properties", return_value=(1920, 1080, 30.0)), \
            patch(f"{MODULE}.cv2.VideoCapture", return_value=capture):
        result = service._normalize_video(video_info)

    assert result["success"] is True
    command = ffmpeg.commands[-1]
    assert command[command.index("-frames:v") + 1] == "70"


def test_normalized_clip_counts_frames_between_rounded_timeline_boundaries(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    capture = MagicMock()
    capture.get.return_value = 300
    video_info = {
        'video_path': media_file(tmp_path, "source.mp4"), 'index': 1, 'temp_dir': str(tmp_path),
        'target_fps': 30, 'ffmpeg_path': 'ffmpeg', 'clip_start': 0.0, 'clip_end': 2.345,
        'timeline_start': 2.345,
        'target_aspect_ratio': AspectRatio.RATIO_16_9, 'camera_motion': None, 'camera_label': 'clip',
    }

    with patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg), \
            patch.object(VideoCompositionService, "_cv2_video_properties", return_value=(1920, 1080, 30.0)), \
            patch(f"{MODULE}.cv2.VideoCapture", return_value=capture):
        service._normalize_video(video_info)

    command = ffmpeg.commands[-1]
    # round(4.69 * 30) - round(2.345 * 30) = 141 - 70
    assert command[command.index("-frames:v") + 1] == "71"


def test_a_long_run_of_equal_clips_does_not_drift():
    clip, fps, count = 2.345, 30, 100
    frames = sum(frame_count_for(k * clip, clip, fps) for k in range(count))
    # Per-clip rounding would give 70 * 100 = 7000 frames, 1.17 s short.
    assert frames == round(count * clip * fps)


def test_a_clip_end_and_the_next_start_share_a_half_frame_boundary():
    # 0.005 + 1.845 is 1.8499999… in floating point while the next clip starts
    # at 1.85; both sit on frame 55.5 and must round to the same frame.
    first = frame_count_for(0.005, 1.845, 30)
    second = frame_count_for(1.85, 1.0, 30)
    assert first + second == 86  # round(2.85 * 30) - round(0.005 * 30)


def test_image_and_audio_only_request_skips_normalize_and_composes_base(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    request = composition_request(
        image_items=[image_item(tmp_path, "still", 0.0, 4.0)],
        audio_items=[audio_item(tmp_path, "voice", 0.0, 4.0)],
        total_duration=4.0,
    )

    with composing(ffmpeg) as normalizer:
        response = service._compose_video_sync("comp-1", request)

    assert response.success is True
    normalizer.assert_not_called()
    compose = next(c for c in ffmpeg.commands if any(p.startswith("color=c=black") for p in c))
    assert "-i" not in compose[:compose.index("-filter_complex")]
    graph = compose[compose.index("-filter_complex") + 1]
    assert graph.startswith("color=c=black:s=64x36:r=30:d=4.000000")


def test_audio_starting_later_is_padded_with_silence_to_the_timeline_end(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 20.0)],
        audio_items=[audio_item(tmp_path, "mid", 5.0, 8.0)],
        total_duration=20.0,
    )

    with patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg), \
            patch.object(VideoCompositionService, "_convert_url_to_local_path", lambda self, url: url):
        result = service._process_audio_tracks(request, str(tmp_path), "ffmpeg", 20.0)

    padded = next(c for c in ffmpeg.commands if "anullsrc=r=44100:cl=stereo" in c)
    assert padded[padded.index("-t") + 1] == "20.0"
    assert result.path is not None


def test_timeline_end_covers_items_past_a_shorter_total_duration(tmp_path):
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg()
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 4.0)],
        audio_items=[audio_item(tmp_path, "music", 0.0, 6.0), audio_item(tmp_path, "sting", 1.0, 2.0)],
        total_duration=4.0,
    )

    with composing(ffmpeg):
        response = service._compose_video_sync("comp-1", request)

    assert response.success is True
    compose = next(c for c in ffmpeg.commands if any(p.startswith("color=c=black") for p in c))
    assert "d=6.000000" in compose[compose.index("-filter_complex") + 1]
    mix = next(c for c in ffmpeg.commands if c[-1].endswith("audio_mix.wav") and "[out]" in c)
    assert mix[mix.index("-t") + 1] == "6.0"


def test_normalize_tasks_carry_each_clip_window(tmp_path):
    service = make_service(tmp_path)
    trimmed = video_item(tmp_path, "trimmed", "video-track-1", 0.0, 10.0).model_copy(
        update={"clip_start": 5.0, "clip_end": 15.0}
    )
    request = composition_request(
        video_items=[trimmed, video_item(tmp_path, "full", "video-track-1", 10.0, 6.4)],
        total_duration=16.4,
    )

    with composing(FakeFfmpeg()) as normalizer:
        service._compose_video_sync("comp-1", request)

    windows = sorted(
        (call.args[1]["index"], call.args[1]["clip_start"], call.args[1]["clip_end"])
        for call in normalizer.call_args_list
    )
    assert windows == [(0, 5.0, 15.0), (1, 0.0, 6.4)]


def test_concat_fast_path_failure_reports_the_compose_stage_readably(tmp_path):
    """The summary is the last stderr line, not the FFmpeg banner and config."""
    service = make_service(tmp_path)
    ffmpeg = FakeFfmpeg(fail_when=lambda cmd: "concat" in cmd)
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 3.0)], total_duration=3.0,
    )

    with composing(ffmpeg):
        response = service._compose_video_sync("comp-1", request)

    details = service.compositions["comp-1"]["error_details"]
    assert response.success is False
    assert (details["composition_stage"], details["error_summary"]) == ("compose", "Invalid argument")


def test_invalid_clip_window_is_not_retried(tmp_path):
    """EX3-02: a deterministic failure used to burn 4 attempts and 7 s of back-off."""
    service = make_service(tmp_path)
    failure = {
        "success": False, "error": "Invalid clipping parameters: clip duration is -1.00s",
        "index": 0, "retryable": False,
    }

    with patch.object(VideoCompositionService, "_normalize_video", return_value=failure) as normalize, \
            patch(f"{MODULE}.time.sleep", side_effect=AssertionError("must not back off")):
        result = service._normalize_video_with_retry({"index": 0})

    assert normalize.call_count == 1
    assert (result["success"], result["attempts"]) == (False, 1)


def test_empty_clip_window_is_reported_as_not_retryable(tmp_path):
    service = make_service(tmp_path)
    video_info = {
        'video_path': media_file(tmp_path, "source.mp4"), 'index': 0, 'temp_dir': str(tmp_path),
        'target_fps': 30, 'ffmpeg_path': 'ffmpeg', 'clip_start': 5.0, 'clip_end': 5.0,
        'target_aspect_ratio': AspectRatio.RATIO_16_9, 'camera_motion': None, 'camera_label': 'clip',
    }
    source = VideoStreamInfo(width=1920, height=1080, fps=30.0, duration=10.0, rotation=0)

    with patch.object(VideoCompositionService, "_describe_source", return_value=source):
        result = service._normalize_video(video_info)

    assert (result["success"], result["retryable"]) == (False, False)


def test_split_clips_of_one_source_are_not_copied(tmp_path):
    """EX3-03: every clip cut from one 2 GB recording copied the whole file to temp."""
    service = make_service(tmp_path)
    source = media_file(tmp_path, "recording.mp4")
    clips = [
        VideoCompositionItem(
            id=f"cut-{n}", name=f"cut-{n}", url=source, start_time=n * 2.0, duration=2.0,
            track_id="video-track-1", clip_start=n * 2.0, clip_end=n * 2.0 + 2.0,
        )
        for n in range(3)
    ]

    with composing(FakeFfmpeg()) as normalizer, patch(f"{MODULE}.shutil.copy2") as copy:
        response = service._compose_video_sync("comp-1", composition_request(video_items=clips, total_duration=6.0))

    assert response.success is True
    copy.assert_not_called()
    assert {call.args[1]["video_path"] for call in normalizer.call_args_list} == {source}
