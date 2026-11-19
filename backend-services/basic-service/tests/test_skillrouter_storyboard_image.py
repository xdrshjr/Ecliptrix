"""Storyboard 2x2 grid generation through SkillRouter (spec §4.4, defect IM-03).

``storyboard_service`` called ARK Seedream directly; in router mode it must use
the gateway (key on the download, POST never retried, structured errors kept).
"""
import io
import json

import pytest
from PIL import Image

from app.config import settings
from app.models.storyboard_models import PartialGenerationError, StoryboardGenerateRequest
from app.services import storyboard_service
from app.services.credential_errors import (
    VideoError, classify_generation_error, generation_error_response,
)
from app.services.skillrouter.errors import RouterError

IMAGES = "/api/v1/media/images/generations"


@pytest.fixture(autouse=True)
def _storage_without_ark_key(tmp_path, monkeypatch):
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))
    monkeypatch.setattr(settings, "ark_image_api_key", "")
    monkeypatch.setattr(storyboard_service, "STORYBOARD_BATCH_RETRY_BASE_DELAY", 0.0)


def grid_png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (256, 256), (200, 120, 60)).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_router_mode_generates_without_an_ark_key(fake_gateway):
    fake_gateway.image_bytes = grid_png()
    pack = await storyboard_service.generate_storyboard(
        StoryboardGenerateRequest(prompt="A cat's day", frame_count=4))
    assert pack.frame_count == 4 and len(pack.frames) == 4
    assert fake_gateway.count("POST", IMAGES) == 1
    body = json.loads(fake_gateway.last("POST", IMAGES)["body"])
    assert body["count"] == 1 and body["watermark"] is False
    assert body["size"] == "2048x2048"
    download = fake_gateway.last("GET", "/api/v1/media/assets/asset1")
    assert download["headers"]["x-api-key"] == fake_gateway.api_key


@pytest.mark.asyncio
async def test_second_batch_chains_a_reference_image(fake_gateway):
    fake_gateway.image_bytes = grid_png()
    pack = await storyboard_service.generate_storyboard(
        StoryboardGenerateRequest(prompt="Seven scenes", frame_count=7))
    assert pack.frame_count == 7 and fake_gateway.count("POST", IMAGES) == 2
    first, second = [json.loads(r["body"]) for r in fake_gateway.requests
                     if r["method"] == "POST" and r["path"] == IMAGES]
    assert "referenceImage" not in first
    assert second["referenceImage"].startswith("data:image/")


@pytest.mark.asyncio
async def test_first_batch_failure_keeps_the_router_error_and_is_not_retried(fake_gateway):
    fake_gateway.fail("POST", IMAGES, 429, "quota_exceeded")
    with pytest.raises(RouterError) as error:
        await storyboard_service.generate_storyboard(
            StoryboardGenerateRequest(prompt="x", frame_count=4))
    assert error.value.error_code == "router_quota_exceeded"
    assert fake_gateway.count("POST", IMAGES) == 1


@pytest.mark.asyncio
async def test_later_batch_failure_is_partial_without_paid_retries(fake_gateway):
    fake_gateway.image_bytes = grid_png()
    original = storyboard_service._call_router_image
    calls = []

    async def flaky(**kwargs):
        calls.append(1)
        if len(calls) == 2:
            fake_gateway.fail("POST", IMAGES, 503, "upstream_unavailable")
        return await original(**kwargs)

    storyboard_service_call = storyboard_service._call_router_image
    storyboard_service._call_router_image = flaky
    try:
        with pytest.raises(PartialGenerationError) as error:
            await storyboard_service.generate_storyboard(
                StoryboardGenerateRequest(prompt="x", frame_count=8))
    finally:
        storyboard_service._call_router_image = storyboard_service_call
    assert error.value.completed_batches == 1
    assert fake_gateway.count("POST", IMAGES) == 2  # batch 1 ok + batch 2 once, no retry


@pytest.mark.asyncio
async def test_manual_mode_does_not_touch_the_gateway(fake_gateway_manual, monkeypatch):
    async def stub(**_):
        return "https://cdn.example/a.png", "task-1"

    async def download(remote, dest):
        import os
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "wb").write(grid_png())

    monkeypatch.setattr(settings, "ark_image_api_key", "ark-key")
    monkeypatch.setattr(storyboard_service, "_call_ark_seedream", stub)
    monkeypatch.setattr(storyboard_service, "_download_batch_original", download)
    await storyboard_service.generate_storyboard(
        StoryboardGenerateRequest(prompt="x", frame_count=4))
    assert fake_gateway_manual.requests == []


def test_router_error_passes_through_generation_error_helpers():
    error = RouterError("too_many_inflight", 429, "busy", retry_after=3)
    assert classify_generation_error(error, "x") is error
    with pytest.raises(RouterError):
        generation_error_response(error, "x")
    assert isinstance(classify_generation_error(VideoError("c"), "x"), VideoError)
