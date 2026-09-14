"""Long filter graphs are passed through script files (EXO-05 / T9).

Windows rejects command lines over 32767 characters (WinError 206); ~110
subtitles used to push the drawtext chain past that and silently drop every
subtitle from the export.
"""

from __future__ import annotations

import shutil

import pytest

from app.models.video_models import SubtitleCompositionItem
from app.services.composition import ffmpeg_args
from app.services.composition.ffmpeg_args import (
    FILTER_ARG_INLINE_LIMIT,
    filter_complex_args,
    video_filter_args,
)


def test_short_graph_stays_inline(tmp_path):
    assert filter_complex_args("null", str(tmp_path), "ffmpeg") == ["-filter_complex", "null"]
    assert video_filter_args("null", str(tmp_path), "ffmpeg") == ["-vf", "null"]
    assert list(tmp_path.iterdir()) == []


def test_long_graph_is_written_to_script_file(tmp_path, monkeypatch):
    monkeypatch.setattr(ffmpeg_args, "supports_option_file_syntax", lambda path: True)
    graph = ",".join(["null"] * 3000)
    assert len(graph) > FILTER_ARG_INLINE_LIMIT

    args = filter_complex_args(graph, str(tmp_path), "ffmpeg")

    assert args[0] == "-/filter_complex"
    assert all(len(arg) <= FILTER_ARG_INLINE_LIMIT for arg in args)
    raw = open(args[1], "rb").read()
    assert not raw.startswith(b"\xef\xbb\xbf")
    assert raw.decode("utf-8") == graph


def test_option_file_probe_falls_back_to_filter_complex_script(tmp_path, monkeypatch):
    monkeypatch.setattr(ffmpeg_args, "supports_option_file_syntax", lambda path: False)
    long_chain = ",".join(["null"] * 3000)
    assert filter_complex_args(long_chain, str(tmp_path), "ffmpeg")[0] == "-filter_complex_script"
    assert video_filter_args(long_chain, str(tmp_path), "ffmpeg")[0] == "-filter_script:v"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH")
def test_script_file_args_chosen_by_probe_run_in_installed_ffmpeg(tmp_path):
    import subprocess

    long_chain = ",".join(["null"] * 3000)
    for args in (
        filter_complex_args(long_chain, str(tmp_path), "ffmpeg"),
        video_filter_args(long_chain, str(tmp_path), "ffmpeg"),
    ):
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.1",
             *args, "-f", "null", "-"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, (args[0], result.stderr)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH")
def test_160_subtitles_burn_in_succeeds(tmp_path):
    import subprocess

    from app.services.subtitle_service import SubtitleService

    video = tmp_path / "base.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", "color=c=black:s=640x360:r=10:d=8",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(video)],
        check=True, capture_output=True,
    )
    items = [
        SubtitleCompositionItem(
            id=f"s{index}", name=f"Subtitle {index}", text=f"Line {index}",
            start_time=index * 0.05, duration=0.05, track_id="subtitle-track-1",
        )
        for index in range(160)
    ]
    service = object.__new__(SubtitleService)
    text_dir = tmp_path / "text"
    text_dir.mkdir()
    filters = service.build_drawtext_filters_for_items(items, 640, 360, str(text_dir))
    assert len(",".join(filters)) > 32767

    output = tmp_path / "subtitled.mp4"
    service.burn_drawtext_filters(str(video), str(output), filters, str(tmp_path), timeout=None)

    assert output.exists() and output.stat().st_size > 0
