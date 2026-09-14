"""Real-FFmpeg probes of the canvas compositor graph (round 2, S6 / T3).

String assertions cannot prove that a graph *renders* the timeline; these tests
encode small lavfi clips, run the exact graph ``build_filtergraph`` plans and
read back pixels and durations. Skipped only when ffmpeg / ffprobe are missing.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from app.services.composition.filtergraph_builder import build_filtergraph

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
