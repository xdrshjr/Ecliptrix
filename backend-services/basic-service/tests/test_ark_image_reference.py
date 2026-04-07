"""Tests for ark_image_service reference-image forwarding to ARK Seedream."""
import base64
import io
import json

import httpx
import pytest
from PIL import Image

from app.models.ark_image_models import ArkImageGenerateRequest
from app.services import ark_image_service


def _make_test_png(size: int = 100, color=(0, 0, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color=color).save(buf, format="PNG")
    return buf.getvalue()


PNG_BYTES = _make_test_png()
DATA_URI = f"data:image/png;base64,{base64.b64encode(PNG_BYTES).decode()}"


@pytest.fixture
def mock_ark_image_env(monkeypatch, tmp_path):
    """
    Patch httpx.AsyncClient inside ark_image_service to a MockTransport that
    captures any POST to /images/generations and returns a fake URL. Other
    requests (the download step) get the test PNG bytes back.
    """
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/images/generations"):
            captured["payload"] = request.read().decode()
            return httpx.Response(
                200,
                json={"data": [{"url": "https://example.invalid/fake.png"}]},
            )
        return httpx.Response(200, content=PNG_BYTES, headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def patched_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(ark_image_service.httpx, "AsyncClient", patched_client)
    monkeypatch.setattr(ark_image_service.settings, "ark_api_key", "test-key")

    # Reroute on-disk writes inside generate_images() to tmp_path so we don't
    # pollute the real static/uploads directory. We omit raising=False so that
    # any future rename of `settings.storage.root` will fail loudly here
    # instead of silently turning the patch into a no-op.
    monkeypatch.setattr(
        ark_image_service.settings.storage,
        "root",
        str(tmp_path),
    )

    return captured


@pytest.mark.asyncio
async def test_ark_image_basic_reference_uses_correct_payload_key(mock_ark_image_env):
    """The reference image must end up under the same key Task 0 verified for storyboard."""
    req = ArkImageGenerateRequest(
        prompt="a yellow rubber duck",
        mode="basic",
        size="1024x1024",
        count=1,
        watermark=False,
        reference_image=DATA_URI,
    )
    await ark_image_service.generate_images(req)

    payload = json.loads(mock_ark_image_env["payload"])
    assert "image" in payload, (
        f"reference image dropped — payload keys = {list(payload.keys())}"
    )
    value = payload["image"]
    if isinstance(value, list):
        value = value[0]
    assert value == DATA_URI
    assert "image_urls" not in payload, "obsolete payload key still being sent"


@pytest.mark.asyncio
async def test_ark_image_basic_no_reference_omits_image_field(mock_ark_image_env):
    """When the user provides no reference, the payload must omit image AND image_urls."""
    req = ArkImageGenerateRequest(
        prompt="a yellow rubber duck",
        mode="basic",
        size="1024x1024",
        count=1,
        watermark=False,
    )
    await ark_image_service.generate_images(req)

    payload = json.loads(mock_ark_image_env["payload"])
    assert "image" not in payload
    assert "image_urls" not in payload


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["basic", "character", "scene"])
async def test_ark_image_all_modes_attach_reference(mock_ark_image_env, mode):
    """All three image-generation modes (basic/character/scene) must attach
    the reference image under the correct `image` key, not the obsolete
    `image_urls` key.

    Character and scene modes mutate the prompt and force `n=1`, but they
    must NOT swallow the reference image — that was the same class of bug
    we just fixed for the storyboard service, and we don't want it to
    silently re-introduce itself in a future refactor.
    """
    req = ArkImageGenerateRequest(
        prompt="a yellow rubber duck",
        mode=mode,
        size="2048x2048",
        count=1,
        watermark=False,
        reference_image=DATA_URI,
    )
    await ark_image_service.generate_images(req)

    payload = json.loads(mock_ark_image_env["payload"])
    assert payload.get("image") == DATA_URI, (
        f"mode={mode} dropped reference — payload keys = {list(payload.keys())}"
    )
    assert "image_urls" not in payload, (
        f"mode={mode} regressed to obsolete image_urls key"
    )
    # character/scene must still force count=1 even when a reference is provided
    if mode in ("character", "scene"):
        assert payload.get("n") == 1
