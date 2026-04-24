"""
Unit tests for storyboard_service multi-reference image support.

Tests that generate_storyboard correctly handles reference_images and
mentioned_images fields, composites multiple references, and maintains
backward compatibility.
"""

import base64
import io
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from PIL import Image

from app.models.storyboard_models import StoryboardGenerateRequest


def _make_image_data_uri(w: int = 100, h: int = 100, color: tuple = (255, 0, 0)) -> str:
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


class TestStoryboardModels:
    def test_request_accepts_new_fields(self):
        uri = _make_image_data_uri()
        req = StoryboardGenerateRequest(
            prompt="test storyboard",
            frame_count=4,
            reference_images=[uri, uri],
            mentioned_images={"@[img1]": uri},
        )
        assert req.reference_images == [uri, uri]
        assert req.mentioned_images == {"@[img1]": uri}

    def test_request_backward_compat(self):
        req = StoryboardGenerateRequest(prompt="test")
        assert req.reference_images is None
        assert req.mentioned_images is None
        assert req.reference_image is None

    def test_request_single_reference_compat(self):
        uri = _make_image_data_uri()
        req = StoryboardGenerateRequest(
            prompt="test",
            reference_image=uri,
        )
        assert req.reference_image == uri
        assert req.reference_images is None

    def test_request_priority_reference_images(self):
        uri1 = _make_image_data_uri(100, 100, (255, 0, 0))
        uri2 = _make_image_data_uri(100, 100, (0, 255, 0))
        single_uri = _make_image_data_uri(50, 50, (0, 0, 255))
        req = StoryboardGenerateRequest(
            prompt="test",
            frame_count=4,
            reference_image=single_uri,
            reference_images=[uri1, uri2],
        )
        assert req.reference_images == [uri1, uri2]
        assert req.reference_image == single_uri

    def test_request_with_mentions(self):
        uri1 = _make_image_data_uri()
        uri2 = _make_image_data_uri()
        req = StoryboardGenerateRequest(
            prompt="分镜内容 @[cat] 和 @[room]",
            frame_count=9,
            reference_images=[uri1, uri2],
            mentioned_images={
                "@[cat]": uri1,
                "@[room]": uri2,
            },
        )
        assert req.mentioned_images == {"@[cat]": uri1, "@[room]": uri2}

    def test_grid_size_always_2x2_regardless_of_frame_count(self):
        # Post-refactor: the backend always uses 2×2 batches internally,
        # so grid_size is locked to "2x2" no matter what frame_count is.
        req = StoryboardGenerateRequest(
            prompt="test",
            frame_count=6,
        )
        assert req.grid_size == "2x2"

    def test_default_frame_count_is_one_batch(self):
        req = StoryboardGenerateRequest(prompt="test")
        assert req.frame_count == 4
        assert req.grid_size == "2x2"


class TestStoryboardMultiReferenceResolve:
    @pytest.mark.asyncio
    async def test_multi_reference_prompt_replacement(self):
        from app.services.reference_compositor import (
            composite_references,
            position_labels,
            replace_mention_tags,
        )

        uri1 = _make_image_data_uri(100, 100, (255, 0, 0))
        uri2 = _make_image_data_uri(100, 100, (0, 255, 0))

        composite_uri, desc = await composite_references([uri1, uri2])
        assert composite_uri.startswith("data:image/png;base64,")

        prompt = "画一个和@[cat.jpg]一样的猫坐在@[room.png]的沙发上"
        mentioned = {"@[cat.jpg]": uri1, "@[room.png]": uri2}
        labels = position_labels(2)
        replaced = replace_mention_tags(prompt, mentioned, labels)
        assert "@[cat.jpg]" not in replaced
        assert "@[room.png]" not in replaced
        assert "left reference image" in replaced

    @pytest.mark.asyncio
    async def test_no_mentions_appends_synthesis_hint(self):
        from app.services.reference_compositor import composite_references

        uri1 = _make_image_data_uri(100, 100, (255, 0, 0))
        uri2 = _make_image_data_uri(100, 100, (0, 255, 0))

        _, desc = await composite_references([uri1, uri2])
        assert "collage" in desc or "left" in desc
