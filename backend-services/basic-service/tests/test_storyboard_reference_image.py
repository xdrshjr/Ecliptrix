"""Tests for storyboard reference-image forwarding to ARK Seedream."""
import base64
import io
import json

import httpx
import pytest
from PIL import Image

from app.models.storyboard_models import StoryboardGenerateRequest
from app.services import storyboard_service


def _make_test_png(size: int = 100, color=(255, 0, 0)) -> bytes:
    """Generate a real, croppable PNG so generate_storyboard's crop step doesn't fail."""
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color=color).save(buf, format="PNG")
    return buf.getvalue()


PNG_BYTES = _make_test_png()
DATA_URI = f"data:image/png;base64,{base64.b64encode(PNG_BYTES).decode()}"


@pytest.fixture
def mock_storyboard_env(monkeypatch, tmp_path):
    """
    Patch httpx.AsyncClient inside storyboard_service to a MockTransport that:
      - captures any POST to /images/generations into `captured["payload"]`,
      - returns a fake JSON response with a single image URL,
      - returns the test PNG bytes for any other GET (the download step).

    Also patches the storage base dir and ARK API key. Yields the `captured` dict
    so individual tests can assert on the payload that was sent.
    """
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/images/generations"):
            captured["payload"] = request.read().decode()
            return httpx.Response(
                200,
                json={"data": [{"url": "https://example.invalid/fake.png"}]},
            )
        # any other request = download of the generated image
        return httpx.Response(200, content=PNG_BYTES, headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient  # capture BEFORE monkeypatch

    def patched_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(storyboard_service.httpx, "AsyncClient", patched_client)
    monkeypatch.setattr(storyboard_service.settings, "ark_api_key", "test-key")
    monkeypatch.setattr(storyboard_service, "_storyboard_base_dir", lambda: str(tmp_path))

    return captured


@pytest.mark.asyncio
async def test_reference_image_uses_correct_ark_payload_key(mock_storyboard_env):
    """The base64 reference image MUST end up under the key the ARK API actually reads."""
    req = StoryboardGenerateRequest(
        prompt="four red apples",
        frame_count=4,
        aspect_ratio="1:1",
        reference_image=DATA_URI,
    )
    pack = await storyboard_service.generate_storyboard(req)

    payload = json.loads(mock_storyboard_env["payload"])
    # The expected key is whatever Task 0 verified. Default assumption: "image".
    assert "image" in payload, (
        f"reference image dropped — payload keys = {list(payload.keys())}"
    )
    value = payload["image"]
    if isinstance(value, list):
        value = value[0]
    assert value == DATA_URI, "reference image present but value mangled"
    assert "image_urls" not in payload, "obsolete payload key still being sent"

    # The pack returned to the frontend must record the reference, so the UI
    # can show "this storyboard was generated from this reference image".
    assert pack.reference_image_url is not None, (
        "StoryboardPack.reference_image_url is None even though a reference "
        "was provided"
    )
    assert pack.reference_image_url.endswith("/reference.png"), (
        f"unexpected reference URL shape: {pack.reference_image_url}"
    )


@pytest.mark.asyncio
async def test_no_reference_image_means_no_image_field(mock_storyboard_env):
    """When the user provides no reference, the payload must omit image AND image_urls."""
    req = StoryboardGenerateRequest(prompt="x", frame_count=4, aspect_ratio="1:1")
    await storyboard_service.generate_storyboard(req)

    payload = json.loads(mock_storyboard_env["payload"])
    assert "image" not in payload, "image field leaked despite no reference being provided"
    assert "image_urls" not in payload, "obsolete image_urls field is back"


@pytest.mark.asyncio
async def test_https_url_reference_image_passes_through(mock_storyboard_env):
    """
    The model.reference_image field is typed as Optional[str] with no validator
    and historically accepts both base64 data URIs and plain HTTPS URLs.
    Pin the passthrough behaviour so a future "must be a data URI" change
    cannot silently break URL inputs.

    Also asserts that the URL is propagated to the StoryboardPack response so
    the frontend can render "generated from this reference URL".
    """
    https_ref = "https://example.com/some/reference.jpg"
    req = StoryboardGenerateRequest(
        prompt="x",
        frame_count=4,
        aspect_ratio="1:1",
        reference_image=https_ref,
    )
    pack = await storyboard_service.generate_storyboard(req)

    payload = json.loads(mock_storyboard_env["payload"])
    assert "image" in payload
    value = payload["image"]
    if isinstance(value, list):
        value = value[0]
    assert value == https_ref
    assert "image_urls" not in payload

    # HTTPS URL must also be passed through to the response, not silently
    # dropped to None just because the local-save branch was skipped.
    assert pack.reference_image_url == https_ref, (
        "HTTPS URL reference dropped from StoryboardPack.reference_image_url"
    )
