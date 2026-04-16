"""
Unit tests for ark_image_service multi-reference image support.

Tests that _resolve_multi_references correctly composites multiple images,
handles @-mention tag replacement, and maintains backward compatibility.
"""

import base64
import io
import pytest
import pytest_asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from PIL import Image

from app.models.ark_image_models import ArkImageGenerateRequest
from app.services.ark_image_service import _resolve_multi_references


def _make_image_data_uri(w: int = 100, h: int = 100, color: tuple = (255, 0, 0)) -> str:
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _make_request(**overrides) -> ArkImageGenerateRequest:
    defaults = {
        "prompt": "a cat",
        "size": "1024x1024",
        "count": 1,
        "watermark": True,
        "mode": "basic",
    }
    defaults.update(overrides)
    return ArkImageGenerateRequest(**defaults)


class TestResolveMultiReferences:
    @pytest.mark.asyncio
    async def test_no_references(self):
        req = _make_request()
        ref, prompt = await _resolve_multi_references(req)
        assert ref is None
        assert prompt == "a cat"

    @pytest.mark.asyncio
    async def test_single_reference_image_backward_compat(self):
        uri = _make_image_data_uri()
        req = _make_request(reference_image=uri)
        ref, prompt = await _resolve_multi_references(req)
        assert ref is not None
        assert ref.startswith("data:image/png;base64,")
        assert prompt == "a cat"

    @pytest.mark.asyncio
    async def test_single_reference_images(self):
        uri = _make_image_data_uri()
        req = _make_request(reference_images=[uri])
        ref, prompt = await _resolve_multi_references(req)
        assert ref is not None
        assert ref.startswith("data:image/png;base64,")
        assert prompt == "a cat"

    @pytest.mark.asyncio
    async def test_multi_reference_images_composited(self):
        uri1 = _make_image_data_uri(100, 100, (255, 0, 0))
        uri2 = _make_image_data_uri(100, 100, (0, 255, 0))
        req = _make_request(reference_images=[uri1, uri2])
        ref, prompt = await _resolve_multi_references(req)
        assert ref is not None
        assert ref.startswith("data:image/png;base64,")
        assert "collage" in prompt.lower() or "synthesiz" in prompt.lower()

    @pytest.mark.asyncio
    async def test_multi_reference_with_mentions(self):
        uri1 = _make_image_data_uri(100, 100, (255, 0, 0))
        uri2 = _make_image_data_uri(100, 100, (0, 255, 0))
        req = _make_request(
            prompt="画一个和@[cat.jpg]一样的猫坐在@[room.png]的沙发上",
            reference_images=[uri1, uri2],
            mentioned_images={
                "@[cat.jpg]": uri1,
                "@[room.png]": uri2,
            },
        )
        ref, prompt = await _resolve_multi_references(req)
        assert ref is not None
        assert "@[cat.jpg]" not in prompt
        assert "@[room.png]" not in prompt
        assert "reference image" in prompt

    @pytest.mark.asyncio
    async def test_reference_images_priority_over_reference_image(self):
        uri1 = _make_image_data_uri(100, 100, (255, 0, 0))
        uri2 = _make_image_data_uri(100, 100, (0, 255, 0))
        single_uri = _make_image_data_uri(50, 50, (0, 0, 255))
        req = _make_request(
            reference_image=single_uri,
            reference_images=[uri1, uri2],
        )
        ref, prompt = await _resolve_multi_references(req)
        assert ref is not None
        assert "collage" in prompt.lower() or "synthesiz" in prompt.lower()

    @pytest.mark.asyncio
    async def test_three_images_composited(self):
        uris = [_make_image_data_uri(100, 100, (i * 80, 0, 0)) for i in range(3)]
        req = _make_request(reference_images=uris)
        ref, prompt = await _resolve_multi_references(req)
        assert ref is not None
        assert ref.startswith("data:image/png;base64,")

    @pytest.mark.asyncio
    async def test_four_images_composited(self):
        uris = [_make_image_data_uri(100, 100, (0, i * 60, 0)) for i in range(4)]
        req = _make_request(reference_images=uris)
        ref, prompt = await _resolve_multi_references(req)
        assert ref is not None
        assert ref.startswith("data:image/png;base64,")
        assert "2x2" in prompt


class TestArkImageModels:
    def test_request_accepts_new_fields(self):
        uri = _make_image_data_uri()
        req = ArkImageGenerateRequest(
            prompt="test",
            reference_images=[uri, uri],
            mentioned_images={"@[img1]": uri},
        )
        assert req.reference_images == [uri, uri]
        assert req.mentioned_images == {"@[img1]": uri}

    def test_request_backward_compat(self):
        req = ArkImageGenerateRequest(prompt="test")
        assert req.reference_images is None
        assert req.mentioned_images is None
        assert req.reference_image is None

    def test_request_single_reference_compat(self):
        uri = _make_image_data_uri()
        req = ArkImageGenerateRequest(
            prompt="test",
            reference_image=uri,
        )
        assert req.reference_image == uri
        assert req.reference_images is None
