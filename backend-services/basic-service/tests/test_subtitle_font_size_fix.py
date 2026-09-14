"""
Test cases for subtitle font size fix
验证字幕字体大小修复的测试用例

Round 2 (EXO-01): composition subtitles are drawn straight from each item — no
SRT round trip and no single request style — so the size set in the editor must
appear in that item's own drawtext filters.
"""

import pytest

from app.models.video_models import SubtitleCompositionItem
from app.services.subtitle_service import SubtitleService


def _filters(tmp_path, **style):
    item = SubtitleCompositionItem(
        id="test_subtitle",
        name="测试字幕",
        text="这是一个测试字幕",
        start_time=0.0,
        duration=3.0,
        track_id="subtitle_track_1",
        **style,
    )
    service = object.__new__(SubtitleService)
    return service.build_drawtext_filters_for_items([item], 1920, 1080, str(tmp_path))


def test_font_size_from_frontend_respected(tmp_path):
    """测试后端正确使用前端传递的字体大小"""
    filters = _filters(tmp_path, font_size=36, background_color="#000000@0.5")
    assert filters and all(":fontsize=36:" in f for f in filters)


def test_default_font_size_when_not_specified(tmp_path):
    """测试当未指定字体大小时使用正确的默认值"""
    filters = _filters(tmp_path)
    assert filters and all(":fontsize=24:" in f for f in filters)


@pytest.mark.parametrize("font_size", [8, 12, 16, 24, 32, 48, 60, 72])
def test_various_font_sizes(tmp_path, font_size):
    """测试各种字体大小的正确传递"""
    filters = _filters(tmp_path, font_size=font_size)
    assert filters and all(f":fontsize={font_size}:" in f for f in filters)
