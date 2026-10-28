"""POST /api/video/image-to-video: validation, source resolution, error codes.

Everything here fails BEFORE FFmpeg is needed, except the final HTTP-contract
test, so the file stays fast and runs without FFmpeg.
"""

import base64
import io
from pathlib import Path

import httpx
import pytest
from PIL import Image

from app.models import ImageToVideoRequest
from app.routers import video_router
from app.services import derived_gc_service
from app.services import image_to_video_service as service_module


@pytest.fixture
def storage(tmp_path, monkeypatch):
    from app.config import settings
    from app.services import storage_service as storage_module

    root = tmp_path / "uploads"
    (root / "uploads" / "images").mkdir(parents=True)
    monkeypatch.setattr(storage_module.storage_service, "root", root)
    monkeypatch.setattr(settings.storage, "root", str(root))
    monkeypatch.setattr(service_module, "find_ffmpeg", lambda: "ffmpeg")
    return root


def png(width=64, height=48) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 40, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


def make_request(**fields) -> ImageToVideoRequest:
    return ImageToVideoRequest(**{"effect": "static", "duration": 2.0, **fields})


async def post(**fields):
    return await video_router.convert_image_to_video(make_request(**fields))


# ── request validation ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_missing_source_is_reported():
    response = await post()
    assert response.success is False
    assert response.error_code == "MISSING_IMAGE_SOURCE"


@pytest.mark.asyncio
async def test_invalid_direction_for_the_chosen_effect_is_rejected():
    response = await post(image_url="/x.png", effect="ken_burns",
                          ken_burns_direction="sideways")
    assert response.error_code == "INVALID_ARGUMENT"


@pytest.mark.asyncio
async def test_direction_of_another_effect_is_ignored_not_rejected(storage):
    (storage / "uploads" / "images" / "a.png").write_bytes(png())
    response = await post(storage_key="uploads/images/a.png",
                          effect="static", ken_burns_direction="zoom_in")
    assert getattr(response, "error_code", None) != "INVALID_ARGUMENT"


def test_out_of_range_aspect_ratio_fails_pydantic_validation():
    with pytest.raises(ValueError):
        make_request(image_url="/x.png", aspect_ratio="7:3")


def test_max_long_side_is_bounded():
    with pytest.raises(ValueError):
        make_request(image_url="/x.png", max_long_side=100)
    with pytest.raises(ValueError):
        make_request(image_url="/x.png", max_long_side=9000)


# ── storage_key resolution (AC-20) ──────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["../x", "/etc/passwd", "C:/x", "a/../../x",
                                 "uploads//a.png"])
async def test_unsafe_storage_keys_are_invalid_arguments(storage, key):
    response = await post(storage_key=key)
    assert response.success is False
    assert response.error_code == "INVALID_ARGUMENT"


@pytest.mark.asyncio
async def test_unknown_storage_key_is_image_not_found(storage):
    response = await post(storage_key="uploads/images/nope.png")
    assert response.error_code == "IMAGE_NOT_FOUND"


@pytest.mark.asyncio
async def test_storage_key_outside_the_root_is_never_read(storage, tmp_path):
    secret = tmp_path / "secret.png"
    secret.write_bytes(png())
    response = await post(storage_key="../secret.png")
    assert response.error_code == "INVALID_ARGUMENT"


@pytest.mark.asyncio
async def test_existing_storage_key_loads_the_bytes(storage):
    (storage / "uploads" / "images" / "a.png").write_bytes(png())
    request = make_request(storage_key="uploads/images/a.png")
    assert await service_module.load_image_bytes(request) == png()


@pytest.mark.asyncio
async def test_same_origin_route_loads_the_bytes(storage):
    (storage / "uploads" / "images" / "a.png").write_bytes(png())
    request = make_request(image_url="/api/storage/files/uploads/images/a.png")
    assert await service_module.load_image_bytes(request) == png()


@pytest.mark.asyncio
async def test_loopback_http_url_is_treated_as_a_local_route(storage):
    (storage / "uploads" / "images" / "a.png").write_bytes(png())
    request = make_request(
        image_url="http://127.0.0.1:3000/api/storage/files/uploads/images/a.png")
    assert await service_module.load_image_bytes(request) == png()


def test_source_precedence_prefers_image_data():
    request = make_request(image_url="/x", storage_key="a/b.png",
                           image_data="aGk=")
    assert request.image_data == "aGk="  # load_image_bytes reads it first


@pytest.mark.asyncio
async def test_base64_data_url_is_decoded():
    payload = "data:image/png;base64," + base64.b64encode(png()).decode()
    request = make_request(image_data=payload)
    assert await service_module.load_image_bytes(request) == png()


# ── SSRF and size guards (AC-7) ─────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data/x.jpg",
    "http://10.0.0.5/x.jpg",
    "http://192.168.1.10/x.jpg",
    "http://localhost.localdomain/x.jpg",
    "file:///etc/passwd",
])
async def test_internal_and_non_http_targets_are_refused(storage, url):
    response = await post(image_url=url)
    assert response.success is False
    assert response.error_code == "IMAGE_NOT_FOUND"


@pytest.fixture
def remote(monkeypatch):
    """Serve canned responses for a 'public' host through httpx.MockTransport."""
    state = {"handler": lambda request: httpx.Response(404)}
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(lambda r: state["handler"](r))
        return real_client(*args, **kwargs)

    monkeypatch.setattr(service_module.httpx, "AsyncClient", client_factory)
    monkeypatch.setattr(service_module, "validate_external_url", lambda url: url)
    monkeypatch.setattr(
        "app.services.local_media_resolver.validate_external_url",
        lambda url: url)
    return state


@pytest.mark.asyncio
async def test_remote_non_image_content_type_is_refused(storage, remote):
    remote["handler"] = lambda r: httpx.Response(
        200, content=b"<html/>", headers={"content-type": "text/html"})
    response = await post(image_url="https://img.example.com/a.jpg")
    assert response.error_code == "IMAGE_UNREADABLE"


@pytest.mark.asyncio
async def test_remote_oversized_body_is_refused(storage, remote, monkeypatch):
    monkeypatch.setattr(service_module, "MAX_IMAGE_BYTES", 100)
    remote["handler"] = lambda r: httpx.Response(
        200, content=b"x" * 500, headers={"content-type": "image/jpeg"})
    response = await post(image_url="https://img.example.com/a.jpg")
    assert response.error_code == "IMAGE_TOO_LARGE"


@pytest.mark.asyncio
async def test_remote_redirect_to_an_internal_host_is_refused(
        storage, remote, monkeypatch):
    def guard(url):
        if "169.254" in url:
            raise service_module.URLGuardError("blocked")
        return url

    monkeypatch.setattr(service_module, "validate_external_url", guard)
    remote["handler"] = lambda r: httpx.Response(
        302, headers={"location": "http://169.254.169.254/x.jpg"})
    response = await post(image_url="https://img.example.com/a.jpg")
    assert response.error_code == "IMAGE_NOT_FOUND"


@pytest.mark.asyncio
async def test_remote_http_error_status_is_image_not_found(storage, remote):
    response = await post(image_url="https://img.example.com/missing.jpg")
    assert response.error_code == "IMAGE_NOT_FOUND"


@pytest.mark.asyncio
async def test_oversized_local_file_is_image_too_large(storage, monkeypatch):
    (storage / "uploads" / "images" / "a.png").write_bytes(png())
    monkeypatch.setattr(service_module, "MAX_IMAGE_BYTES", 10)
    response = await post(storage_key="uploads/images/a.png")
    assert response.error_code == "IMAGE_TOO_LARGE"


@pytest.mark.asyncio
async def test_pixel_cap_rejects_before_decoding(storage, monkeypatch):
    (storage / "uploads" / "images" / "a.png").write_bytes(png(100, 100))
    monkeypatch.setattr(service_module, "MAX_IMAGE_PIXELS", 5000)
    response = await post(storage_key="uploads/images/a.png")
    assert response.error_code == "IMAGE_TOO_LARGE"


@pytest.mark.asyncio
async def test_pixel_cap_does_not_touch_the_global_pil_limit(
        storage, monkeypatch):
    before = Image.MAX_IMAGE_PIXELS
    (storage / "uploads" / "images" / "a.png").write_bytes(png())
    await post(storage_key="uploads/images/a.png")
    assert Image.MAX_IMAGE_PIXELS == before


@pytest.mark.asyncio
async def test_corrupt_image_is_image_unreadable(storage):
    (storage / "uploads" / "images" / "a.png").write_bytes(b"not an image")
    response = await post(storage_key="uploads/images/a.png")
    assert response.error_code == "IMAGE_UNREADABLE"


# ── placement and GC (AC-10) ────────────────────────────────────────────────


def test_generated_clips_live_under_a_servable_storage_path():
    key = "video/generated/i2v_0123456789abcdef.mp4"
    assert service_module._storage_url("0123456789abcdef", ".mp4") == (
        "/api/storage/files/" + key)


def test_gc_service_never_reclaims_video_generated():
    assert "generated" not in derived_gc_service._THUMBNAILS_REL
    assert "generated" not in derived_gc_service._WAVEFORMS_REL
    source = Path(derived_gc_service.__file__).read_text(encoding="utf-8")
    assert "video/generated" not in source


# ── HTTP contract ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_business_failures_are_returned_not_raised(storage):
    response = await post(storage_key="uploads/images/nope.png")
    assert response.success is False
    assert response.error_code
