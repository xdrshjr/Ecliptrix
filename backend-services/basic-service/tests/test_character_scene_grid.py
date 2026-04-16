"""Integration test for ark_image_service character/scene grid pack flow.

Mocks the ARK Seedream API so no network call is made; verifies that the
service:

* uses the 3×3 grid prompt with the R2 sub-view list,
* attaches the reference image under the ``image`` payload key (R1),
* persists the composite + 9 cropped frames + metadata.json,
* surfaces the full pack through ``generate_images_with_pack``.
"""

import base64
import io
import json
import os

import httpx
import pytest
from PIL import Image

from app.models.ark_image_models import ArkImageGenerateRequest
from app.services import ark_image_service, grid_pack_service


def _make_png_bytes(size: int = 600, color=(200, 100, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color=color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def mock_env(monkeypatch, tmp_path):
    """Intercept ARK POST + image download inside ark_image_service.httpx."""
    captured = {}
    png_bytes = _make_png_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/images/generations"):
            captured["payload"] = request.read().decode()
            return httpx.Response(
                200,
                json={"data": [{"url": "https://example.invalid/grid.png"}]},
            )
        return httpx.Response(200, content=png_bytes, headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    real_async = httpx.AsyncClient

    def patched(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async(*args, **kwargs)

    monkeypatch.setattr(ark_image_service.httpx, "AsyncClient", patched)
    monkeypatch.setattr(ark_image_service.settings, "ark_api_key", "test-key")
    monkeypatch.setattr(ark_image_service.settings.storage, "root", str(tmp_path))
    monkeypatch.setattr(grid_pack_service.settings.storage, "root", str(tmp_path))
    return {"captured": captured, "root": str(tmp_path)}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode, sub_views",
    [
        ("character", grid_pack_service.CHARACTER_SUB_VIEWS),
        ("scene", grid_pack_service.SCENE_SUB_VIEWS),
    ],
)
async def test_grid_pack_flow(mock_env, mode, sub_views):
    data_uri = "data:image/png;base64," + base64.b64encode(b"abc").decode()
    req = ArkImageGenerateRequest(
        prompt="hero in red cape",
        mode=mode,
        size="2048x2048",
        count=1,
        watermark=False,
        grid_mode=True,
        reference_image=data_uri,
    )

    images, pack = await ark_image_service.generate_images_with_pack(req)

    # One composite image + a populated pack with 9 frames
    assert len(images) == 1
    assert pack is not None
    assert pack.pack_type == mode
    assert pack.frame_count == 9
    assert len(pack.frames) == 9
    for i, frame in enumerate(pack.frames):
        assert frame.index == i
        assert frame.sub_view == sub_views[i]

    # Pack exists on disk with metadata + 9 frame files
    pack_dir = grid_pack_service.locate_pack_dir(mode, pack.pack_id)
    assert pack_dir is not None
    assert os.path.isfile(os.path.join(pack_dir, "original.png"))
    for frame in pack.frames:
        assert os.path.isfile(os.path.join(pack_dir, frame.filename))
    with open(os.path.join(pack_dir, "metadata.json"), encoding="utf-8") as f:
        meta = json.load(f)
    assert meta["pack_type"] == mode
    assert meta["grid_size"] == "3x3"
    assert meta["sub_views"] == sub_views

    # ARK payload carries the reference under `image` (R1) and the right size
    payload = json.loads(mock_env["captured"]["payload"])
    assert payload["image"] == data_uri
    assert payload["size"] == "2048x2048"
    assert payload["n"] == 1


@pytest.mark.asyncio
async def test_legacy_grid_mode_false_still_works(mock_env):
    """grid_mode=False keeps the old single-image flow."""
    req = ArkImageGenerateRequest(
        prompt="duck",
        mode="basic",
        size="1024x1024",
        count=1,
        watermark=False,
        grid_mode=False,
    )
    images, pack = await ark_image_service.generate_images_with_pack(req)
    assert pack is None
    # Mock returns a single URL regardless of ``n`` — we just assert shape.
    assert len(images) == 1
