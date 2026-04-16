"""
Unit tests for the reference_compositor service — multi-image compositing
and @-mention tag replacement.
"""

import base64
import io
import pytest
import pytest_asyncio
from PIL import Image

from app.services.reference_compositor import (
    _composite_images,
    position_labels,
    _layout,
    composite_references,
    replace_mention_tags,
    CELL_SIZE,
    GAP,
    BG_COLOR,
)


def _make_image(w: int = 100, h: int = 100, color: tuple = (255, 0, 0)) -> Image.Image:
    return Image.new("RGB", (w, h), color)


def _image_to_data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _images_to_data_uris(*imgs: Image.Image) -> list[str]:
    return [_image_to_data_uri(img) for img in imgs]


class TestLayout:
    def test_layout_1(self):
        assert _layout(1) == (1, 1)

    def test_layout_2(self):
        assert _layout(2) == (1, 2)

    def test_layout_3(self):
        assert _layout(3) == (2, 2)

    def test_layout_4(self):
        assert _layout(4) == (2, 2)


class TestPositionLabels:
    def test_labels_1(self):
        assert position_labels(1) == []

    def test_labels_2(self):
        assert position_labels(2) == ["left", "right"]

    def test_labels_3(self):
        assert position_labels(3) == ["top", "bottom-left", "bottom-right"]

    def test_labels_4(self):
        assert position_labels(4) == [
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
        ]


class TestCompositeImages:
    def test_single_image_returns_original(self):
        img = _make_image(200, 300, (0, 128, 255))
        result, desc = _composite_images([img])
        assert result.size == (200, 300)
        assert desc == ""

    def test_two_images_side_by_side(self):
        img1 = _make_image(50, 50, (255, 0, 0))
        img2 = _make_image(50, 50, (0, 255, 0))
        result, desc = _composite_images([img1, img2])
        expected_w = 2 * CELL_SIZE + GAP
        expected_h = CELL_SIZE
        assert result.size == (expected_w, expected_h)
        assert "1x2" in desc or "left" in desc
        assert "right" in desc

    def test_three_images_layout(self):
        imgs = [_make_image(80, 60, (i * 80, 0, 0)) for i in range(3)]
        result, desc = _composite_images(imgs)
        expected_w = 2 * CELL_SIZE + GAP
        expected_h = 2 * CELL_SIZE + GAP
        assert result.size == (expected_w, expected_h)
        assert "top" in desc
        assert "bottom-left" in desc

    def test_four_images_grid(self):
        imgs = [_make_image(100, 100, (i * 50, i * 50, i * 50)) for i in range(4)]
        result, desc = _composite_images(imgs)
        expected_w = 2 * CELL_SIZE + GAP
        expected_h = 2 * CELL_SIZE + GAP
        assert result.size == (expected_w, expected_h)
        assert "2x2" in desc

    def test_different_sizes_resized(self):
        img1 = _make_image(10, 10, (255, 0, 0))
        img2 = _make_image(2000, 1000, (0, 255, 0))
        result, desc = _composite_images([img1, img2])
        assert result.size == (2 * CELL_SIZE + GAP, CELL_SIZE)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="No images"):
            _composite_images([])

    def test_composite_is_valid_rgb(self):
        imgs = [_make_image(50, 50, (i * 60, 0, 0)) for i in range(4)]
        result, _ = _composite_images(imgs)
        assert result.mode == "RGB"


class TestReplaceMentionTags:
    def test_basic_replacement(self):
        prompt = "画一个和@[cat.jpg]一样的猫坐在@[room.png]的沙发上"
        mentioned = {
            "@[cat.jpg]": "data:image/png;base64,abc",
            "@[room.png]": "/api/storage/files/room.png",
        }
        labels = ["left area", "right area"]
        result = replace_mention_tags(prompt, mentioned, labels)
        assert "@[cat.jpg]" not in result
        assert "@[room.png]" not in result
        assert "left area reference image" in result
        assert "right area reference image" in result

    def test_single_mention(self):
        prompt = "参考@[ref1]生成图片"
        mentioned = {"@[ref1]": "data:image/png;base64,xxx"}
        labels = ["left area"]
        result = replace_mention_tags(prompt, mentioned, labels)
        assert "left area reference image" in result

    def test_no_mentions(self):
        prompt = "一只猫"
        mentioned = {}
        labels = []
        result = replace_mention_tags(prompt, mentioned, labels)
        assert result == "一只猫"

    def test_mention_not_in_prompt(self):
        prompt = "一只猫坐在沙发上"
        mentioned = {"@[dog.jpg]": "data:image/png;base64,abc"}
        labels = ["left area"]
        result = replace_mention_tags(prompt, mentioned, labels)
        assert result == "一只猫坐在沙发上"


class TestCompositeReferences:
    @pytest.mark.asyncio
    async def test_single_data_uri(self):
        img = _make_image(100, 100, (255, 0, 0))
        data_uri = _image_to_data_uri(img)
        result_uri, desc = await composite_references([data_uri])
        assert result_uri.startswith("data:image/png;base64,")
        assert desc == ""

    @pytest.mark.asyncio
    async def test_two_data_uris(self):
        img1 = _make_image(100, 100, (255, 0, 0))
        img2 = _make_image(100, 100, (0, 255, 0))
        uris = _images_to_data_uris(img1, img2)
        result_uri, desc = await composite_references(uris)
        assert result_uri.startswith("data:image/png;base64,")
        assert "left" in desc
        assert "right" in desc

        b64_data = result_uri.split(",", 1)[1]
        composite_bytes = base64.b64decode(b64_data)
        composite_img = Image.open(io.BytesIO(composite_bytes))
        assert composite_img.mode == "RGB"

    @pytest.mark.asyncio
    async def test_four_data_uris(self):
        imgs = [_make_image(80, 80, (i * 50, i * 50, i * 50)) for i in range(4)]
        uris = _images_to_data_uris(*imgs)
        result_uri, desc = await composite_references(uris)
        assert "2x2" in desc

        b64_data = result_uri.split(",", 1)[1]
        composite_bytes = base64.b64decode(b64_data)
        composite_img = Image.open(io.BytesIO(composite_bytes))
        expected_size = 2 * CELL_SIZE + GAP
        assert composite_img.size == (expected_size, expected_size)

    @pytest.mark.asyncio
    async def test_empty_raises(self):
        with pytest.raises(ValueError, match="No reference images"):
            await composite_references([])

    @pytest.mark.asyncio
    async def test_mixed_sizes_normalized(self):
        small = _make_image(10, 10, (255, 0, 0))
        large = _make_image(2000, 2000, (0, 255, 0))
        uris = _images_to_data_uris(small, large)
        result_uri, desc = await composite_references(uris)
        assert result_uri.startswith("data:image/png;base64,")

        b64_data = result_uri.split(",", 1)[1]
        composite_bytes = base64.b64decode(b64_data)
        composite_img = Image.open(io.BytesIO(composite_bytes))
        expected_w = 2 * CELL_SIZE + GAP
        expected_h = CELL_SIZE
        assert composite_img.size == (expected_w, expected_h)
