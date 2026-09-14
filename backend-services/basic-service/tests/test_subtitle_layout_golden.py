"""The drawtext export matches the shared subtitle layout golden table (EXO-09).

``tests/fixtures/subtitle_layout_golden.json`` is also read by
``src/components/video/lib/__tests__/subtitleLayout.test.ts``: the preview lays
subtitles out with the same wrapping, line height and block position rules, so
a rule change on either side fails the other side's test.

Each case is burned through the real filter builder: the text files it writes
give the drawn lines and the ``y=`` of each drawtext gives their top.
"""

import json
import re
from pathlib import Path

import pytest

from app.models.video_models import SubtitleCompositionItem
from app.services.subtitle_service import SubtitleService

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "subtitle_layout_golden.json"
_LINE_FILE = re.compile(r"sub_1_line_(\d+)\.txt")
_LINE_TOP = re.compile(r":y=(-?\d+):")


def _golden_cases():
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["cases"]


def _drawn_lines(case, text_dir: Path):
    """``(line index, text, top y)`` of every line the export draws for ``case``."""
    item = SubtitleCompositionItem(
        id="s1", name="Subtitle", text=case["text"], start_time=0.0, duration=2.0,
        track_id="subtitle-track-1", font_size=case["fontSize"], position=case["position"],
    )
    output = case["output"]
    filters = object.__new__(SubtitleService).build_drawtext_filters_for_items(
        [item], output["width"], output["height"], str(text_dir)
    )
    drawn = []
    for drawtext in filters:
        line_index = int(_LINE_FILE.search(drawtext).group(1))
        text = (text_dir / f"sub_1_line_{line_index}.txt").read_text(encoding="utf-8")
        drawn.append((line_index, text, int(_LINE_TOP.search(drawtext).group(1))))
    return drawn


@pytest.mark.parametrize("case", _golden_cases(), ids=lambda case: case["name"])
def test_drawtext_layout_matches_the_shared_golden_table(case, tmp_path):
    expected = case["expected"]

    assert expected["lineHeight"] == case["fontSize"] + 5
    # Blank lines keep their slot in the block but draw nothing.
    assert _drawn_lines(case, tmp_path) == [
        (index, line["text"], line["topY"])
        for index, line in enumerate(expected["lines"])
        if line["text"].strip()
    ]
