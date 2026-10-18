"""联系表：2×3 网格、序号/时间码烧入、整表 ≤1280、坏帧跳过（AC-15）。"""
import io

import pytest
from PIL import Image

from app.services.agent_vision import contact_sheet
from tests.agent_vision_support import jpeg_bytes, png_bytes


def frames(count, color=(90, 90, 90)):
    return [(index * 1.5 + 0.5, jpeg_bytes(320, 180, color))
            for index in range(count)]


def open_sheet(body):
    image = Image.open(io.BytesIO(body))
    image.load()
    return image


@pytest.mark.parametrize("count,expected", [
    (1, (1, 1)), (2, (2, 1)), (3, (2, 2)), (4, (2, 2)),
    (5, (2, 3)), (6, (2, 3)),
])
def test_grid_shape(count, expected):
    assert contact_sheet.grid_shape(count) == expected


def test_four_frames_make_a_2x2_sheet_within_1280():
    """AC-15：4 帧 → 2×2；每格 480×270 + 4px 白边；整表最长边 ≤1280。"""
    sheet = open_sheet(contact_sheet.build_sheet(frames(4)))
    assert sheet.size == (2 * 480 + 3 * 4, 2 * 270 + 3 * 4)
    assert max(sheet.size) <= 1280


def test_six_frames_make_three_rows():
    sheet = open_sheet(contact_sheet.build_sheet(frames(6)))
    assert sheet.size == (2 * 480 + 3 * 4, 3 * 270 + 4 * 4)


def test_whole_sheet_is_clamped_to_1280():
    wide = contact_sheet._compose(frames(2), 2, 1)[0]
    assert contact_sheet._clamp_longest_side(wide).width <= 1280


def test_label_is_burned_into_the_cell_corner():
    """左上角烧入 `#i  MM:SS.s`：该区域必须有近黑像素（默认字体影子）。"""
    body = contact_sheet.build_sheet([(65.4, jpeg_bytes(480, 270,
                                                        (255, 255, 255)))])
    sheet = open_sheet(body)
    corner = sheet.crop((4, 4, 120, 28)).convert("L")
    assert min(corner.getdata()) < 80


def test_undecodable_frame_is_skipped_not_fatal():
    broken = b"\xff\xd8\xff" + b"garbage" * 8
    body = contact_sheet.build_sheet(
        [(0.5, jpeg_bytes(320, 180, (10, 200, 10))), (1.5, broken)])
    sheet = open_sheet(body)
    assert sheet.size[0] > 0


def test_empty_input_is_rejected():
    with pytest.raises(ValueError):
        contact_sheet.build_sheet([])


def test_all_frames_broken_is_rejected():
    with pytest.raises(ValueError):
        contact_sheet.build_sheet([(0.5, b"nope")])


def test_png_frames_are_accepted():
    body = contact_sheet.build_sheet([(0.5, png_bytes(320, 180))])
    assert open_sheet(body).size == (480 + 2 * 4, 270 + 2 * 4)


def test_timecode_format():
    from app.services.agent_vision.frame_sampler import format_timecode

    assert format_timecode(0) == "00:00.0"
    assert format_timecode(65.4) == "01:05.4"
    assert format_timecode(125.25) == "02:05.2"
