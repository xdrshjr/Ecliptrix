"""The standalone /add-subtitles service (N-16).

Replaces ``test_subtitle_add.py``, which depended on ``datas/merge`` sample
files that are not in the repository and asserted an SRT time format SRT never
uses. Every input here is generated in ``tmp_path``.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

from app.models.video_models import SubtitleAddRequest
from app.services.subtitle_service import SubtitleService

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH")

SRT_CONTENT = """1
00:00:00,000 --> 00:00:01,000
Hello

2
00:00:01,000 --> 00:00:02,000
line one
line two
"""


@pytest.fixture
def service(tmp_path: Path) -> SubtitleService:
    # object.__new__ skips __init__, which creates static/ directories in the CWD.
    instance = object.__new__(SubtitleService)
    instance.output_dir = tmp_path / "subtitled"
    instance.output_dir.mkdir()
    return instance


def _write_srt(tmp_path: Path) -> Path:
    path = tmp_path / "subs.srt"
    path.write_text(SRT_CONTENT, encoding="utf-8")
    return path


@needs_ffmpeg
@pytest.mark.asyncio
async def test_add_subtitles_burns_srt_into_video(service, tmp_path):
    video = tmp_path / "input.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", "color=c=black:s=320x240:r=10:d=2",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(video)],
        check=True, capture_output=True,
    )
    request = SubtitleAddRequest(
        video_file_path=str(video),
        subtitle_file_path=str(_write_srt(tmp_path)),
        font_size=24,
    )

    result = await service.add_subtitles(request)

    assert result.success, result.message
    output = Path(result.output_video_path)
    assert output.parent == service.output_dir
    assert output.stat().st_size > 0
    assert (result.video_width, result.video_height, result.subtitle_count) == (320, 240, 2)


def test_parse_srt_keeps_multiline_text(service, tmp_path):
    entries = service._parse_srt_file(str(_write_srt(tmp_path)))

    assert [entry.text for entry in entries] == ["Hello", "line one\nline two"]
    assert (entries[1].start_time, entries[1].end_time) == ("00:00:01,000", "00:00:02,000")


def test_convert_time_to_seconds_accepts_comma_and_dot(service):
    assert service._convert_time_to_seconds("00:00:01,500") == pytest.approx(1.5)
    assert service._convert_time_to_seconds("00:01:02.250") == pytest.approx(62.25)
    assert service._convert_time_to_seconds("01:00:00,000") == pytest.approx(3600.0)
