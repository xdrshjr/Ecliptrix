"""Real-FFmpeg probes of the canvas compositor graph (round 2, S6 / T3).

String assertions cannot prove that a graph *renders* the timeline; these tests
encode small lavfi clips, run the exact graph ``build_filtergraph`` plans and
read back pixels and durations. Skipped only when ffmpeg / ffprobe are missing.
"""

from __future__ import annotations

import shutil
import subprocess
import wave
from array import array
from pathlib import Path
from unittest.mock import patch

import pytest

from app.models.video_models import AspectRatio, VideoCompositionItem, VideoCompositionRequest
from app.services.composition import audio_mix
from app.services.composition.filtergraph_builder import build_filtergraph
from app.services.video_composition_service import VideoCompositionService

_FFMPEG = shutil.which("ffmpeg")
_FFPROBE = shutil.which("ffprobe")

pytestmark = pytest.mark.skipif(
    not (_FFMPEG and _FFPROBE),
    reason="ffmpeg/ffprobe not on PATH; canvas probes need them",
)

WIDTH, HEIGHT, FPS = 64, 36, 30
RED, BLUE, BLACK = (255, 0, 0), (0, 0, 255), (0, 0, 0)


class _Transition:
    def __init__(self, type_: str, duration: float):
        self.type = type_
        self.duration = duration


class _Clip:
    def __init__(self, id, track_id, start_time, duration, opacity=1.0,
                 transition_in=None, transition_out=None, track_z=None):
        self.id = id
        self.track_id = track_id
        self.start_time = start_time
        self.duration = duration
        self.clip_start = 0.0
        self.clip_end = duration
        self.opacity = opacity
        self.track_z = track_z
        self.transition_in = transition_in
        self.transition_out = transition_out


def _color_clip(directory: Path, name: str, color: str, duration: float) -> str:
    path = directory / f"{name}.mp4"
    subprocess.run(
        [_FFMPEG, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"color=c={color}:s={WIDTH}x{HEIGHT}:r={FPS}:d={duration}",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(path)],
        check=True, capture_output=True,
    )
    return str(path)


def _render(directory: Path, clips, paths, timeline_end=None) -> str:
    plan = build_filtergraph(
        clips, WIDTH, HEIGHT, pre_trimmed=True, fps=FPS, timeline_end=timeline_end,
    )
    assert plan.can_use_concat is False
    output = str(directory / "out.mp4")
    cmd = [_FFMPEG, "-y", "-v", "error"]
    for clip_id in plan.video_inputs:
        cmd.extend(["-i", paths[clip_id]])
    cmd.extend([
        "-filter_complex", plan.filter_complex, "-map", plan.output_label,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", output,
    ])
    result = subprocess.run(cmd, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return output


def _pixel(video: str, at_seconds: float):
    raw = subprocess.run(
        [_FFMPEG, "-v", "error", "-ss", f"{at_seconds}", "-i", video,
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True, capture_output=True,
    ).stdout
    offset = ((HEIGHT // 2) * WIDTH + WIDTH // 2) * 3
    return tuple(raw[offset:offset + 3])


def _duration(video: str) -> float:
    out = subprocess.run(
        [_FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video],
        check=True, capture_output=True, text=True,
    ).stdout
    return float(out.strip())


def _close(actual, expected, tolerance=24) -> bool:
    return all(abs(a - e) <= tolerance for a, e in zip(actual, expected))


def test_canvas_upper_track_shows_lower_track_outside_its_clip(tmp_path):
    paths = {
        "base": _color_clip(tmp_path, "base", "red", 6),
        "top": _color_clip(tmp_path, "top", "blue", 2),
    }
    clips = [_Clip("base", "t1", 0.0, 6.0), _Clip("top", "t2", 2.0, 2.0)]
    video = _render(tmp_path, clips, paths)
    assert _close(_pixel(video, 1.0), RED)
    assert _close(_pixel(video, 3.0), BLUE)
    assert _close(_pixel(video, 5.0), RED)
    assert abs(_duration(video) - 6.0) < 0.1


def test_canvas_gap_renders_black_and_keeps_later_clip_time(tmp_path):
    paths = {
        "red": _color_clip(tmp_path, "red", "red", 2),
        "blue": _color_clip(tmp_path, "blue", "blue", 2),
    }
    clips = [_Clip("red", "t1", 0.0, 2.0), _Clip("blue", "t1", 4.0, 2.0)]
    video = _render(tmp_path, clips, paths)
    assert _close(_pixel(video, 3.0), BLACK)
    assert _close(_pixel(video, 4.5), BLUE)
    assert abs(_duration(video) - 6.0) < 0.1


def test_canvas_leading_gap_renders_black_before_the_first_clip(tmp_path):
    paths = {"blue": _color_clip(tmp_path, "blue", "blue", 2)}
    video = _render(tmp_path, [_Clip("blue", "t1", 3.0, 2.0)], paths)
    assert _close(_pixel(video, 1.0), BLACK)
    assert _close(_pixel(video, 4.0), BLUE)
    assert abs(_duration(video) - 5.0) < 0.1


def test_canvas_dissolve_keeps_total_duration(tmp_path):
    dissolve = _Transition("dissolve", 1.0)
    paths = {
        "a": _color_clip(tmp_path, "a", "red", 3),
        "b": _color_clip(tmp_path, "b", "green", 3),
        "c": _color_clip(tmp_path, "c", "blue", 3),
    }
    clips = [
        _Clip("a", "t1", 0.0, 3.0, transition_out=dissolve),
        _Clip("b", "t1", 3.0, 3.0, transition_in=dissolve, transition_out=dissolve),
        _Clip("c", "t1", 6.0, 3.0, transition_in=dissolve),
    ]
    video = _render(tmp_path, clips, paths)
    assert abs(_duration(video) - 9.0) < 0.1
    assert _close(_pixel(video, 7.5), BLUE)


def test_canvas_bottom_fade_darkens_over_black(tmp_path):
    paths = {"solo": _color_clip(tmp_path, "solo", "red", 4)}
    clips = [_Clip("solo", "t1", 0.0, 4.0, opacity=0.5,
                   transition_in=_Transition("fade", 1.0))]
    video = _render(tmp_path, clips, paths)
    red, green, blue = _pixel(video, 2.0)
    assert abs(red - 128) <= 3
    assert green <= 10 and blue <= 10


def test_hard_cut_then_dissolve_graph_encodes(tmp_path):
    dissolve = _Transition("dissolve", 1.0)
    paths = {name: _color_clip(tmp_path, name, color, 2)
             for name, color in (("a", "red"), ("b", "green"), ("c", "blue"))}
    clips = [
        _Clip("a", "t1", 0.0, 2.0),
        _Clip("b", "t1", 2.0, 2.0, transition_out=dissolve),
        _Clip("c", "t1", 4.0, 2.0, transition_in=dissolve),
    ]
    video = _render(tmp_path, clips, paths)
    assert abs(_duration(video) - 6.0) < 0.1


def test_black_base_only_graph_encodes_with_duration(tmp_path):
    video = _render(tmp_path, [], {}, timeline_end=2.0)
    assert abs(_duration(video) - 2.0) < 0.1
    assert _close(_pixel(video, 1.0), BLACK)


# ---------------------------------------------------------------------------
# Round 3: sources the normalization pass used to mis-read, and long timelines
# ---------------------------------------------------------------------------


def _composer() -> VideoCompositionService:
    service = object.__new__(VideoCompositionService)
    service._gpu_encoder = None
    return service


def _normalize(directory: Path, source: str, aspect: AspectRatio, window) -> str:
    result = _composer()._normalize_video({
        'video_path': source, 'index': 0, 'temp_dir': str(directory), 'target_fps': FPS,
        'ffmpeg_path': 'ffmpeg', 'clip_start': window[0], 'clip_end': window[1],
        'timeline_start': 0.0, 'target_aspect_ratio': aspect,
        'camera_motion': None, 'camera_label': 'clip',
    })
    assert result["success"] is True, result.get("error")
    return result["normalized_path"]


def _frame_count(video: str) -> int:
    out = subprocess.run(
        [_FFPROBE, "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", video],
        check=True, capture_output=True, text=True,
    ).stdout
    return int(out.strip())


def _pixel_at(video: str, at_seconds: float, x: int, y: int, width: int):
    raw = subprocess.run(
        [_FFMPEG, "-v", "error", "-ss", f"{at_seconds}", "-i", video,
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True, capture_output=True,
    ).stdout
    offset = (y * width + x) * 3
    return tuple(raw[offset:offset + 3])


def test_rotated_portrait_clip_fills_vertical_frame(tmp_path):
    """EX3-01: a phone clip stored landscape with a 90-degree display matrix."""
    landscape = _color_clip(tmp_path, "landscape", "red", 1)
    portrait = str(tmp_path / "portrait.mp4")
    subprocess.run(
        [_FFMPEG, "-y", "-v", "error", "-display_rotation:v:0", "90",
         "-i", landscape, "-c", "copy", portrait],
        check=True, capture_output=True,
    )

    normalized = _normalize(tmp_path, portrait, AspectRatio.RATIO_9_16, (0.0, 1.0))

    # Letterboxing the coded 64x36 size left rows 0-655 of 1080x1920 black.
    assert _close(_pixel_at(normalized, 0.5, 540, 100, 1080), RED)


def test_webm_without_duration_normalizes_requested_window(tmp_path):
    """EX3-02: a live-style WebM has no container duration and no frame count."""
    capture = str(tmp_path / "capture.webm")
    subprocess.run(
        [_FFMPEG, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"color=c=blue:s={WIDTH}x{HEIGHT}:r={FPS}:d=4",
         "-c:v", "libvpx", "-f", "webm", "-live", "1", capture],
        check=True, capture_output=True,
    )

    normalized = _normalize(tmp_path, capture, AspectRatio.RATIO_16_9, (0.5, 1.5))

    assert _frame_count(normalized) == 30


def test_premerged_run_matches_per_clip_frame_count(tmp_path):
    """N-04: a joined run keeps every clip's frames and position on the canvas."""
    colors = {"a": "red", "b": "green", "c": "blue", "top": "white"}
    paths = {name: _color_clip(tmp_path, name, color, 0.5) for name, color in colors.items()}
    placement = (("a", 0.0, "t1"), ("b", 0.5, "t1"), ("c", 1.0, "t1"), ("top", 2.0, "t2"))
    items = [
        VideoCompositionItem(
            id=name, name=name, url=paths[name], start_time=start, duration=0.5,
            track_id=track, clip_start=0.0, clip_end=0.5,
        )
        for name, start, track in placement
    ]
    request = VideoCompositionRequest(
        task_id="t", video_items=items, total_duration=3.0,
        output_resolution={"width": WIDTH, "height": HEIGHT}, output_fps=FPS,
    )
    work = tmp_path / "work"
    work.mkdir()
    output = tmp_path / "canvas.mp4"

    _composer()._compose_videos_filtergraph(
        request, [paths[item.id] for item in items], output, "ffmpeg",
        {"width": WIDTH, "height": HEIGHT}, 3.0, str(work),
    )

    assert (work / "run_0.mp4").exists()
    assert _frame_count(str(output)) == 90
    assert _close(_pixel(str(output), 0.25), RED)
    assert _close(_pixel(str(output), 1.25), BLUE)
    assert _close(_pixel(str(output), 2.25), (255, 255, 255))


def _tone(directory: Path, name: str, frequency: int) -> str:
    path = str(directory / f"{name}.wav")
    subprocess.run(
        [_FFMPEG, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"sine=frequency={frequency}:sample_rate=44100:duration=2",
         "-af", "volume=12dB", "-ac", "2", path],
        check=True, capture_output=True,
    )
    return path


def _samples(path: str) -> array:
    with wave.open(path, "rb") as handle:
        return array("h", handle.readframes(handle.getnframes()))


def test_chunked_audio_mix_matches_single_pass_mix(tmp_path):
    """EX3-04 / RV3-14: five half-scale tones sum past 0 dBFS; float chunks must not clip early."""
    sources = [
        {"path": _tone(tmp_path, f"tone{n}", 220 + 110 * n), "start_time": n * 0.1}
        for n in range(5)
    ]
    work = tmp_path / "work"
    work.mkdir()
    composer = _composer()
    single, chunked = str(work / "single.wav"), str(work / "chunked.wav")

    assert composer._run_audio_mix(sources, single, "ffmpeg", 2.5)
    with patch("app.services.video_composition_service.chunk_sources",
               lambda count: audio_mix.chunk_sources(count, max_inputs=2)):
        parts = composer._mix_audio_chunks(sources, str(work), "ffmpeg", 2.5)
    assert len(parts) == 3
    assert composer._run_audio_mix(parts, chunked, "ffmpeg", 2.5)

    single_samples, chunked_samples = _samples(single), _samples(chunked)
    assert len(single_samples) == len(chunked_samples)
    assert max(abs(a - b) for a, b in zip(single_samples, chunked_samples)) <= 1
    assert max(abs(sample) for sample in single_samples) >= 32767  # the sum reaches full scale
