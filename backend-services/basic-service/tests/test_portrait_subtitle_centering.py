"""The standalone burn-in centres every wrapped line; portrait uses the centred builder.

Rewritten for N-16: the old unittest class called the builders without
``text_files_dir`` (TypeError) and asserted log lines that no longer exist.
"""

from pathlib import Path
from unittest.mock import patch

import pytest

from app.models.video_models import SubtitleAddRequest
from app.services.subtitle_service import SubtitleEntry, SubtitleService

FONT_SIZE = 50
#: 36 CJK characters: two lines at 1080 px wide (19 characters per line).
LONG_CJK = "这是一段很长的字幕文本，需要换行显示" * 2


@pytest.fixture
def service() -> SubtitleService:
    # object.__new__ skips __init__, which creates directories in the CWD.
    return object.__new__(SubtitleService)


def _request() -> SubtitleAddRequest:
    return SubtitleAddRequest(
        video_file_path="in.mp4",
        subtitle_file_path="subs.srt",
        font_size=FONT_SIZE,
        position="bottom",
    )


def _entries():
    return [
        SubtitleEntry(1, "00:00:00,000", "00:00:03,000", LONG_CJK),
        SubtitleEntry(2, "00:00:03,000", "00:00:06,000", "Another subtitle that wraps"),
    ]


def _command_with_spies(service, tmp_path: Path, width: int, height: int):
    with patch.object(
        service, "_build_multiline_centered_drawtext_filters",
        wraps=service._build_multiline_centered_drawtext_filters,
    ) as centered, patch.object(
        service, "_build_standard_drawtext_filters",
        wraps=service._build_standard_drawtext_filters,
    ) as standard:
        cmd = service._build_ffmpeg_command(
            "in.mp4", "out.mp4", _entries(), _request(), width, height, str(tmp_path)
        )
    return cmd, centered, standard


def test_portrait_frame_uses_centered_builder(service, tmp_path):
    cmd, centered, standard = _command_with_spies(service, tmp_path, 1080, 1920)

    assert centered.call_count == 1
    assert standard.call_count == 0
    assert cmd[0] == "ffmpeg" and cmd[-1] == "out.mp4"


def test_every_wrapped_line_is_centered(service, tmp_path):
    entry = SubtitleEntry(1, "00:00:00,000", "00:00:03,000", LONG_CJK)

    filters = service._build_multiline_centered_drawtext_filters(
        [entry], _request(), 1080, 1920, str(tmp_path)
    )

    max_chars = service._calculate_max_line_width(1080, FONT_SIZE, 50, 1920)
    assert len(filters) == len(service._wrap_text(LONG_CJK, max_chars)) == 2
    assert all("x=(w-text_w)/2" in drawtext for drawtext in filters)
    written = [
        path.read_text(encoding="utf-8")
        for path in sorted(tmp_path.glob("sub_1_line_*.txt"))
    ]
    assert "".join(written) == LONG_CJK


def test_landscape_frame_uses_standard_builder(service, tmp_path):
    cmd, centered, standard = _command_with_spies(service, tmp_path, 1920, 1080)

    assert standard.call_count == 1
    assert centered.call_count == 0
    assert cmd[0] == "ffmpeg" and cmd[-1] == "out.mp4"
