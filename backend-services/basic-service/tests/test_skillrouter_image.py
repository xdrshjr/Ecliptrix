"""AI image generation through the SkillRouter gateway (spec §4.4): real HTTP
fake gateway, real files; the router client is never mocked."""

from __future__ import annotations

import base64
import io
import json
import os
from datetime import date
from pathlib import Path

import httpx
import pytest
from PIL import Image

from app.models.ark_image_models import ArkImageGenerateRequest
from app.services import ark_image_service, grid_pack_service
from app.services.skillrouter import catalog
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.image_adapter import nearest_size, shrink_reference
from tests import skillrouter_fake

IMAGES = "/api/v1/media/images/generations"


def _png(size: int = 90, color=(200, 100, 40)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def _isolated_storage(monkeypatch, tmp_path):
    catalog.reset()
    monkeypatch.setattr(ark_image_service.settings.storage, "root", str(tmp_path))
    monkeypatch.setattr(grid_pack_service.settings.storage, "root", str(tmp_path))
    return tmp_path


def _request(**overrides) -> ArkImageGenerateRequest:
    values = dict(prompt="a red apple", mode="basic", size="1280x720", count=1,
                  watermark=False, grid_mode=False)
    values.update(overrides)
    return ArkImageGenerateRequest(**values)


def _bodies(gateway) -> list:
    return [json.loads(r["body"]) for r in gateway.requests
            if r["method"] == "POST" and r["path"] == IMAGES]


# ------------------------------------------------------------------ happy path


@pytest.mark.asyncio
async def test_generates_downloads_with_key_and_keeps_storage_layout(fake_gateway, tmp_path):
    fake_gateway.image_bytes = _png()
    images = await ark_image_service.generate_images(_request())

    (body,) = _bodies(fake_gateway)
    assert body == {"prompt": "a red apple", "size": "1280x720", "count": 1, "watermark": False}
    assert "model" not in body
    (image,) = images
    today = date.today().strftime("%Y%m%d")
    assert image.local_url.startswith(f"/api/storage/files/images/ark/{today}/")
    saved = tmp_path / "images" / "ark" / today / Path(image.local_url).name
    assert saved.read_bytes() == fake_gateway.image_bytes
    assert (image.width, image.height) == (1280, 720)
    assert image.notes == []
    asset_gets = [r for r in fake_gateway.requests if r["path"].startswith("/api/v1/media/assets/")]
    assert asset_gets and all(r["headers"]["x-api-key"] == fake_gateway.api_key for r in asset_gets)
    assert not list(saved.parent.glob("*.part"))


@pytest.mark.asyncio
async def test_size_not_offered_is_mapped_to_nearest_ratio_and_noted(
        fake_gateway, monkeypatch):
    monkeypatch.setitem(skillrouter_fake.LIMITS["ai_image"], "sizes", ["1024x1024", "1024x576"])
    (image,) = await ark_image_service.generate_images(_request(size="1280x720"))

    assert _bodies(fake_gateway)[0]["size"] == "1024x576"
    assert (image.width, image.height) == (1024, 576)
    assert image.notes and "1024x576" in image.notes[0]


def test_nearest_size_prefers_ratio_then_area():
    sizes = ["1024x1024", "2048x2048", "1280x720", "720x1280", "1024x576"]
    assert nearest_size("1280x720", sizes) == "1280x720"
    assert nearest_size("1920x1080", sizes) == "1280x720"
    assert nearest_size("1920x1080", ["1024x576", "2048x1152", "1024x1024"]) == "2048x1152"
    assert nearest_size("576x1024", sizes) == "720x1280"
    assert nearest_size("1000x1000", []) == "1000x1000"


@pytest.mark.asyncio
async def test_count_above_gateway_max_is_split_into_serial_batches(fake_gateway, monkeypatch):
    monkeypatch.setitem(skillrouter_fake.LIMITS["ai_image"], "maxCount", 2)
    images = await ark_image_service.generate_images(_request(count=3))

    assert [b["count"] for b in _bodies(fake_gateway)] == [2, 1]
    assert len(images) == 3


@pytest.mark.asyncio
async def test_later_batch_failure_returns_billed_images_with_a_note(fake_gateway, monkeypatch):
    monkeypatch.setitem(skillrouter_fake.LIMITS["ai_image"], "maxCount", 2)
    fake_gateway.fail("POST", IMAGES, 429, "too_many_inflight", retry_after=1, after=1)

    images = await ark_image_service.generate_images(_request(count=3))

    assert len(images) == 2
    assert any("too_many_inflight" in note for note in images[0].notes)
    assert fake_gateway.count("POST", IMAGES) == 2  # the failed batch was not retried


@pytest.mark.asyncio
@pytest.mark.parametrize("status,code,error_code", [
    (429, "quota_exceeded", "router_quota_exceeded"),
    (429, "too_many_inflight", "router_busy"),
    (401, "authentication_error", "router_key_invalid"),
    (422, "content_rejected", "content_rejected"),
])
async def test_first_batch_failure_propagates_and_is_not_retried(
        fake_gateway, status, code, error_code):
    fake_gateway.fail("POST", IMAGES, status, code, retry_after=1)
    with pytest.raises(RouterError) as error:
        await ark_image_service.generate_images(_request())
    assert error.value.error_code == error_code
    assert fake_gateway.count("POST", IMAGES) == 1


@pytest.mark.asyncio
async def test_asset_redirect_to_another_origin_is_refused_and_leaves_no_files(
        fake_gateway, tmp_path):
    fake_gateway.redirect_paths["/api/v1/media/assets/asset1"] = "http://evil.example/x.png"
    with pytest.raises(RouterError) as error:
        await ark_image_service.generate_images(_request())
    assert error.value.code == "router_redirect_blocked"
    leftovers = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert leftovers == []


@pytest.mark.asyncio
async def test_clearing_the_router_key_returns_to_the_manual_gate(fake_gateway):
    from app.services.integration_credentials_service import integration_credentials

    await integration_credentials.clear("skillrouter")
    requests_before = len(fake_gateway.requests)
    # Manual mode without a Seedream key: the original ValueError, no gateway call.
    with pytest.raises(ValueError):
        await ark_image_service.generate_images_with_pack(_request())
    assert len(fake_gateway.requests) == requests_before


# ------------------------------------------------------------------ references


def _bmp_data_uri(side: int) -> str:
    buffer = io.BytesIO()
    gradient = Image.linear_gradient("L").resize((side, side))
    Image.merge("RGB", (gradient, gradient, gradient)).save(buffer, format="BMP")
    return "data:image/bmp;base64," + base64.b64encode(buffer.getvalue()).decode()


def test_oversized_reference_is_shrunk_to_2048_jpeg_under_6mb():
    original = _bmp_data_uri(2600)
    assert len(original.partition(",")[2]) > 6 * 1024 * 1024

    shrunk = shrink_reference(original)

    assert shrunk.startswith("data:image/jpeg;base64,")
    assert len(shrunk.partition(",")[2]) <= 6 * 1024 * 1024
    image = Image.open(io.BytesIO(base64.b64decode(shrunk.partition(",")[2])))
    assert max(image.size) == 2048


def test_small_reference_and_urls_are_left_untouched():
    uri = "data:image/png;base64," + base64.b64encode(_png()).decode()
    assert shrink_reference(uri) == uri
    assert shrink_reference("https://example.com/a.png") == "https://example.com/a.png"


def test_undecodable_oversized_reference_is_rejected_clearly():
    junk = "data:image/png;base64," + base64.b64encode(os.urandom(5 * 1024 * 1024)).decode()
    with pytest.raises(RouterError) as error:
        shrink_reference(junk)
    assert error.value.error_code == "router_invalid_request"


@pytest.mark.asyncio
async def test_reference_is_sent_as_single_reference_image_field(fake_gateway):
    uri = "data:image/png;base64," + base64.b64encode(_png()).decode()
    await ark_image_service.generate_images(_request(reference_image=uri))
    body = _bodies(fake_gateway)[0]
    assert body["referenceImage"] == uri and "image" not in body


# ------------------------------------------------------------------ defer_download / grid


@pytest.mark.asyncio
async def test_defer_download_is_ignored_in_router_mode_and_cover_job_can_read_the_file(
        fake_gateway, tmp_path, monkeypatch):
    from app.services import video_cover_asset_service as cover_assets
    from app.services.storage_service import storage_service

    monkeypatch.setattr(storage_service, "root", str(tmp_path), raising=False)
    fake_gateway.image_bytes = _png()

    images, _pack = await ark_image_service.generate_images_with_pack(
        _request(), defer_download=True)

    (image,) = images
    assert image.local_url and image.local_url.startswith("/api/storage/files/images/ark/")
    source = cover_assets.local_source_path(image.local_url)  # what the cover job does
    assert source.read_bytes() == fake_gateway.image_bytes


@pytest.mark.asyncio
async def test_grid_pack_flow_works_through_the_gateway(fake_gateway):
    fake_gateway.image_bytes = _png(size=600)
    request = ArkImageGenerateRequest(
        prompt="hero in red cape", mode="character", size="2048x2048", count=1,
        watermark=False, grid_mode=True)

    images, pack = await ark_image_service.generate_images_with_pack(request)

    assert pack is not None and pack.frame_count == 9 and len(images) == 1
    assert _bodies(fake_gateway)[0]["size"] == "2048x2048"
    pack_dir = grid_pack_service.locate_pack_dir("character", pack.pack_id)
    assert os.path.isfile(os.path.join(pack_dir, "original.png"))


# ------------------------------------------------------------------ HTTP surface


@pytest.mark.asyncio
async def test_generate_endpoint_returns_structured_router_error(fake_gateway):
    from app.main import app

    fake_gateway.fail("POST", IMAGES, 429, "quota_exceeded")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/ark-image/generate", json={
            "prompt": "x", "size": "1280x720", "count": 1, "grid_mode": False})
    payload = response.json()
    assert response.status_code == 429
    assert payload["error_code"] == "router_quota_exceeded"
    assert payload["success"] is False
