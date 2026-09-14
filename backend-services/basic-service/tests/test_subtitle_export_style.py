"""Exported subtitles keep each item's own style and text (EXO-01/10/11/17).

Before round 2 every subtitle was burned with the FIRST item's font size, color,
background and position, empty subtitles burned their item name, text after a
blank line vanished in the SRT round trip, and a style without a background got
an implicit translucent black box.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from app.models.video_models import SubtitleCompositionItem
from app.services.composition.camera_motion import CameraFilterCaps, CameraMotionConfig
from app.services.subtitle_service import SubtitleService, to_ffmpeg_color
from app.services.video_composition_service import VideoCompositionService


def _item(item_id: str, text: str, start: float, duration: float, **style) -> SubtitleCompositionItem:
    return SubtitleCompositionItem(
        id=item_id, name=f"Subtitle {item_id}", text=text, start_time=start,
        duration=duration, track_id="subtitle-track-1", **style,
    )


@pytest.fixture
def subtitles() -> SubtitleService:
    return object.__new__(SubtitleService)


def _filters(service: SubtitleService, tmp_path: Path, items) -> list:
    return service.build_drawtext_filters_for_items(items, 1920, 1080, str(tmp_path))


def _styled_pair():
    first = _item("s1", "FIRST", 0.0, 2.0, font_size=20, font_color="#FF0000", position="top")
    second = _item("s2", "SECOND", 2.0, 2.0, font_size=40, font_color="#FFFF00",
                   background_color="#0000FF", position="bottom")
    return first, second


def test_each_subtitle_keeps_its_own_style_in_drawtext(subtitles, tmp_path):
    filters = _filters(subtitles, tmp_path, list(_styled_pair()))
    first = next(f for f in filters if "sub_1_line_0" in f)
    second = next(f for f in filters if "sub_2_line_0" in f)
    assert ":fontsize=20:fontcolor=#FF0000:" in first and ":y=50:" in first
    assert ":fontsize=40:fontcolor=#FFFF00:" in second
    assert "boxcolor=#0000FF" in second


def test_merged_overlay_pass_uses_per_item_subtitle_style(tmp_path):
    service = object.__new__(VideoCompositionService)
    service.compositions = {}
    service._gpu_encoder = None
    service.subtitle_service = object.__new__(SubtitleService)
    commands = []

    def fake_run(cmd, *args, **kwargs):
        commands.append(list(cmd))
        return type("Done", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    with patch.object(VideoCompositionService, "_get_ffmpeg_path", return_value="ffmpeg"), \
            patch.object(VideoCompositionService, "_get_camera_caps", return_value=CameraFilterCaps()), \
            patch.object(VideoCompositionService, "_get_camera_config",
                         return_value=CameraMotionConfig(dry_run_probe=False)), \
            patch("app.services.video_composition_service.subprocess.run", side_effect=fake_run):
        success, _ = service._process_overlays_and_subtitles_combined(
            [], list(_styled_pair()), "in.mp4", str(tmp_path / "out.mp4"), str(tmp_path),
            {"width": 1920, "height": 1080}, 30,
        )

    assert success is True
    graph = commands[-1][commands[-1].index("-filter_complex") + 1]
    assert ":fontsize=20:" in graph and ":fontsize=40:" in graph


def test_subtitle_without_background_draws_no_box(subtitles, tmp_path):
    filters = _filters(subtitles, tmp_path, [_item("s1", "hello", 0.0, 2.0)])
    assert filters
    assert not any("box=1" in f or "#000000@0.5" in f for f in filters)


def test_hex_with_alpha_background_converts_to_ffmpeg_color():
    assert to_ffmpeg_color("#00000080") == "0x000000@0.502"
    assert to_ffmpeg_color("#abc") == "#aabbcc"
    assert to_ffmpeg_color("#112233") == "#112233"
    assert to_ffmpeg_color("black@0.4") == "black@0.4"
    assert to_ffmpeg_color("transparent") is None
    assert to_ffmpeg_color("") is None


def test_blank_subtitle_items_are_not_burned_with_their_name(subtitles, tmp_path):
    assert _filters(subtitles, tmp_path, [_item("s1", "   ", 0.0, 2.0)]) == []


def test_blank_line_inside_subtitle_keeps_following_text(subtitles, tmp_path):
    filters = _filters(subtitles, tmp_path, [_item("s1", "第一行\n\n第三行", 0.0, 2.0)])
    written = sorted(p.read_text(encoding="utf-8") for p in tmp_path.glob("sub_1_line_*.txt"))
    assert len(filters) == 2
    assert written == ["第一行", "第三行"]


def test_adjacent_subtitles_use_half_open_enable_window(subtitles, tmp_path):
    filters = _filters(subtitles, tmp_path, [
        _item("s1", "one", 0.0, 2.0),
        _item("s2", "two", 2.0, 2.0),
    ])
    assert "enable='gte(t,0.000)*lt(t,2.000)'" in filters[0]
    assert "enable='gte(t,2.000)*lt(t,4.000)'" in filters[1]
    assert not any("between(" in f for f in filters)


def test_subtitle_text_is_drawn_literally_without_expansion(subtitles, tmp_path):
    filters = _filters(subtitles, tmp_path, [_item("s1", "100% C:\\dir", 0.0, 2.0)])
    assert filters and all(":expansion=none" in f for f in filters)


needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH")

_PROBE_WIDTH, _PROBE_HEIGHT = 320, 240
_UPPER_ROWS, _LOWER_ROWS = range(0, 120), range(120, 240)


def _burn(tmp_path: Path, items) -> Path:
    """Burn ``items`` into a 2 s, 10 fps black clip through the real FFmpeg."""
    base = tmp_path / "base.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", f"color=c=black:s={_PROBE_WIDTH}x{_PROBE_HEIGHT}:r=10:d=2",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(base)],
        check=True, capture_output=True,
    )
    service = object.__new__(SubtitleService)
    text_dir = tmp_path / "text"
    text_dir.mkdir()
    filters = service.build_drawtext_filters_for_items(
        items, _PROBE_WIDTH, _PROBE_HEIGHT, str(text_dir)
    )
    output = tmp_path / "subtitled.mp4"
    service.burn_drawtext_filters(str(base), str(output), filters, str(tmp_path), timeout=None)
    return output


def _colored_pixels(video: Path, frame_index: int, rows: range, channel: int) -> int:
    """Pixels in ``rows`` of one frame dominated by ``channel`` (0 = red, 2 = blue)."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video),
         "-vf", f"select=eq(n\\,{frame_index})", "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True, capture_output=True,
    ).stdout
    others = [index for index in range(3) if index != channel]
    count = 0
    for row in rows:
        start = row * _PROBE_WIDTH * 3
        for offset in range(start, start + _PROBE_WIDTH * 3, 3):
            pixel = raw[offset:offset + 3]
            if pixel[channel] > 150 and all(pixel[index] < 90 for index in others):
                count += 1
    return count


def _solid_item(item_id: str, start: float, color: str, position: str) -> SubtitleCompositionItem:
    # Text and box share one color, so a drawn subtitle is a solid block.
    return _item(item_id, "MM", start, 1.0, font_size=40, font_color=color,
                 background_color=color, position=position)


@needs_ffmpeg
def test_adjacent_subtitles_never_share_the_boundary_frame_in_ffmpeg(tmp_path):
    video = _burn(tmp_path, [
        _solid_item("s1", 0.0, "#FF0000", "top"),
        _solid_item("s2", 1.0, "#0000FF", "bottom"),
    ])
    # 10 fps: frame 9 is t=0.9, frame 10 is exactly the shared boundary t=1.0.
    assert _colored_pixels(video, 9, _UPPER_ROWS, 0) > 1000
    assert _colored_pixels(video, 9, _LOWER_ROWS, 2) < 20
    assert _colored_pixels(video, 10, _UPPER_ROWS, 0) < 20
    assert _colored_pixels(video, 10, _LOWER_ROWS, 2) > 1000


@needs_ffmpeg
def test_subtitle_text_with_percent_sign_is_burned_in(tmp_path):
    item = _item("s1", "5%", 0.0, 2.0, font_size=40, font_color="#FF0000",
                 background_color="#FF0000", position="top")
    video = _burn(tmp_path, [item])
    assert _colored_pixels(video, 5, _UPPER_ROWS, 0) > 1000
