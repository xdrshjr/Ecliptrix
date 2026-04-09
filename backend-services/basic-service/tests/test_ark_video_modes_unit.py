"""
Unit tests for Ark Video generation mode support (description + keyframe modes).

Tests the content array construction logic in ark_video_service.create_task()
and the router-level validation (400 on ValueError).

All tests mock the httpx client and settings so no real API calls are made.

Note: We use importlib to load ark_video_service directly from its file path,
bypassing app/services/__init__.py which has heavy transitive dependencies
(cv2, pydub, moviepy, etc.) that are not needed for these tests.
"""

import importlib
import importlib.util
import sys
import types
import os
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

# ---------------------------------------------------------------------------
# Bootstrap: load ark_video_service without triggering app.services.__init__
# ---------------------------------------------------------------------------

# Ensure the service root is on sys.path
_SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _SERVICE_ROOT)

# Import models (these have no heavy deps)
from app.models.ark_video_models import ArkVideoGenerateRequest

# We need to pre-register app.services as a namespace package so that
# "import app.services.ark_video_service" does NOT execute __init__.py.
# Instead we load the single .py file directly.
_ark_svc_path = os.path.join(_SERVICE_ROOT, "app", "services", "ark_video_service.py")
_spec = importlib.util.spec_from_file_location(
    "app.services.ark_video_service", _ark_svc_path
)
_ark_video_service = importlib.util.module_from_spec(_spec)

# Inject into sys.modules BEFORE exec so relative imports within the module resolve
# First ensure parent packages exist in sys.modules
if "app.services" not in sys.modules:
    _services_pkg = types.ModuleType("app.services")
    _services_pkg.__path__ = [os.path.join(_SERVICE_ROOT, "app", "services")]
    _services_pkg.__package__ = "app.services"
    sys.modules["app.services"] = _services_pkg

sys.modules["app.services.ark_video_service"] = _ark_video_service
_spec.loader.exec_module(_ark_video_service)

ark_video_service = _ark_video_service


# ---------------------------------------------------------------------------
# Helper: capture the payload sent to httpx by create_task()
# ---------------------------------------------------------------------------


async def _capture_payload(request: ArkVideoGenerateRequest) -> dict:
    """
    Call create_task() with a mocked httpx client and return the JSON payload
    that would have been POSTed to the ARK API.
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"id": "fake-task-id-123"}

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch.object(ark_video_service, "settings") as mock_settings:
        mock_settings.ark_api_key = "test-api-key"
        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await ark_video_service.create_task(request)

    assert result == "fake-task-id-123"

    # Extract the json= kwarg from the post call
    call_args = mock_client.post.call_args
    payload = call_args.kwargs.get("json") or call_args[1].get("json")
    if payload is None and len(call_args.args) > 1:
        payload = call_args.args[1]
    return payload


# ---------------------------------------------------------------------------
# Test 1: Description mode, text only (no images)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_description_mode_no_images():
    """Description mode with no images: content has only the text entry."""
    request = ArkVideoGenerateRequest(
        prompt="A cat running on grass",
        mode="description",
        aspect_ratio="16:9",
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 1
    assert payload["content"][0] == {"type": "text", "text": "A cat running on grass"}
    # No images -> ratio should be the requested aspect_ratio
    assert payload["ratio"] == "16:9"


# ---------------------------------------------------------------------------
# Test 2: Description mode with single image_url
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_description_mode_with_image_url():
    """Description mode with image_url: content has text + one image entry."""
    request = ArkVideoGenerateRequest(
        prompt="Flowers blooming",
        mode="description",
        image_url="https://example.com/img1.jpg",
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 2
    assert payload["content"][0] == {"type": "text", "text": "Flowers blooming"}
    assert payload["content"][1]["type"] == "image_url"
    assert payload["content"][1]["image_url"]["url"] == "https://example.com/img1.jpg"
    assert payload["content"][1]["role"] == "first_frame"
    # Images present -> ratio must be "adaptive"
    assert payload["ratio"] == "adaptive"


# ---------------------------------------------------------------------------
# Test 3: Description mode with image_urls (multiple images)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_description_mode_with_image_urls():
    """Description mode with image_urls: content has text + two image entries."""
    request = ArkVideoGenerateRequest(
        prompt="Transition effect",
        mode="description",
        image_urls=["https://example.com/a.jpg", "https://example.com/b.jpg"],
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 3
    assert payload["content"][0]["type"] == "text"
    assert payload["content"][1]["role"] == "first_frame"
    assert payload["content"][1]["image_url"]["url"] == "https://example.com/a.jpg"
    assert payload["content"][2]["role"] == "last_frame"
    assert payload["content"][2]["image_url"]["url"] == "https://example.com/b.jpg"
    assert payload["ratio"] == "adaptive"


# ---------------------------------------------------------------------------
# Test 4: Keyframe mode with first_frame_url only
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_keyframe_mode_first_frame_only():
    """Keyframe mode with first_frame_url only: one image entry, ratio=adaptive."""
    request = ArkVideoGenerateRequest(
        prompt="Camera slowly zooms in",
        mode="keyframe",
        first_frame_url="https://example.com/first.jpg",
        aspect_ratio="9:16",  # should be ignored, forced to adaptive
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 2
    assert payload["content"][0] == {"type": "text", "text": "Camera slowly zooms in"}
    assert payload["content"][1]["type"] == "image_url"
    assert payload["content"][1]["image_url"]["url"] == "https://example.com/first.jpg"
    assert payload["content"][1]["role"] == "first_frame"
    # Keyframe mode forces adaptive regardless of aspect_ratio
    assert payload["ratio"] == "adaptive"


# ---------------------------------------------------------------------------
# Test 5: Keyframe mode with first_frame_url + last_frame_url
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_keyframe_mode_first_and_last_frame():
    """Keyframe mode with both frames: two image entries, ratio=adaptive."""
    request = ArkVideoGenerateRequest(
        prompt="Day to night transition",
        mode="keyframe",
        first_frame_url="https://example.com/first.jpg",
        last_frame_url="https://example.com/last.jpg",
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 3
    assert payload["content"][0]["type"] == "text"
    assert payload["content"][1]["role"] == "first_frame"
    assert payload["content"][1]["image_url"]["url"] == "https://example.com/first.jpg"
    assert payload["content"][2]["role"] == "last_frame"
    assert payload["content"][2]["image_url"]["url"] == "https://example.com/last.jpg"
    assert payload["ratio"] == "adaptive"


# ---------------------------------------------------------------------------
# Test 6: Keyframe mode without first_frame_url raises ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_keyframe_mode_missing_first_frame_raises():
    """Keyframe mode without first_frame_url must raise ValueError."""
    request = ArkVideoGenerateRequest(
        prompt="Some prompt",
        mode="keyframe",
        # first_frame_url not set
    )
    with patch.object(ark_video_service, "settings") as mock_settings:
        mock_settings.ark_api_key = "test-api-key"
        with pytest.raises(ValueError, match="first_frame_url is required"):
            await ark_video_service.create_task(request)


# ---------------------------------------------------------------------------
# Test 7: Backward compatibility — no mode field defaults to description
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backward_compatibility_no_mode():
    """When mode is not specified, it defaults to 'description' and behaves as before."""
    request = ArkVideoGenerateRequest(
        prompt="Legacy request without mode",
        image_url="https://example.com/legacy.jpg",
    )
    # Verify the default
    assert request.mode == "description"

    payload = await _capture_payload(request)

    assert len(payload["content"]) == 2
    assert payload["content"][1]["role"] == "first_frame"
    assert payload["content"][1]["image_url"]["url"] == "https://example.com/legacy.jpg"
    assert payload["ratio"] == "adaptive"


# ---------------------------------------------------------------------------
# Test 8: Keyframe mode ignores image_url / image_urls
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_keyframe_mode_ignores_description_images():
    """Keyframe mode should ignore image_url/image_urls even if provided."""
    request = ArkVideoGenerateRequest(
        prompt="Keyframe with extra images that should be ignored",
        mode="keyframe",
        first_frame_url="https://example.com/first.jpg",
        image_url="https://example.com/should-be-ignored.jpg",
        image_urls=["https://example.com/also-ignored.jpg"],
    )
    payload = await _capture_payload(request)

    # Should only have text + first_frame, no description-mode images
    assert len(payload["content"]) == 2
    urls_in_payload = [
        item["image_url"]["url"]
        for item in payload["content"]
        if item.get("type") == "image_url"
    ]
    assert "https://example.com/should-be-ignored.jpg" not in urls_in_payload
    assert "https://example.com/also-ignored.jpg" not in urls_in_payload
    assert "https://example.com/first.jpg" in urls_in_payload


# ---------------------------------------------------------------------------
# Test 9: Description mode ignores first_frame_url / last_frame_url
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_description_mode_ignores_keyframe_fields():
    """Description mode should ignore first_frame_url/last_frame_url even if provided."""
    request = ArkVideoGenerateRequest(
        prompt="Description with keyframe fields that should be ignored",
        mode="description",
        image_url="https://example.com/ref.jpg",
        first_frame_url="https://example.com/first-ignored.jpg",
        last_frame_url="https://example.com/last-ignored.jpg",
    )
    payload = await _capture_payload(request)

    # Should only have text + the description-mode image
    assert len(payload["content"]) == 2
    urls_in_payload = [
        item["image_url"]["url"]
        for item in payload["content"]
        if item.get("type") == "image_url"
    ]
    assert "https://example.com/ref.jpg" in urls_in_payload
    assert "https://example.com/first-ignored.jpg" not in urls_in_payload
    assert "https://example.com/last-ignored.jpg" not in urls_in_payload


# ---------------------------------------------------------------------------
# Test 10: Router returns 400 for keyframe validation failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_router_returns_400_for_keyframe_validation():
    """POST /api/ark-video/generate with keyframe mode but no first_frame_url returns 400.

    We build a minimal FastAPI app that mirrors the real router's error-handling pattern
    (ValueError -> HTTPException 400) to avoid importing the full app.routers package
    which has heavy transitive dependencies (cv2, pydub, etc.) not present in the test env.
    """
    from httpx import AsyncClient, ASGITransport
    from fastapi import FastAPI, HTTPException

    from app.models.ark_video_models import ArkVideoGenerateResponse

    test_app = FastAPI()

    @test_app.post("/api/ark-video/generate", response_model=ArkVideoGenerateResponse)
    async def generate_video(request: ArkVideoGenerateRequest):
        try:
            task_id = await ark_video_service.create_task(request)
            return ArkVideoGenerateResponse(
                success=True, message="ok", ark_task_id=task_id
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    transport = ASGITransport(app=test_app)

    with patch.object(ark_video_service, "settings") as mock_settings:
        mock_settings.ark_api_key = "test-api-key"
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/ark-video/generate",
                json={
                    "prompt": "test prompt",
                    "mode": "keyframe",
                    # no first_frame_url
                },
            )

    assert response.status_code == 400
    assert "first_frame_url" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Test 11: Reference mode with single image_url
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reference_mode_single_image_url():
    """Reference mode with image_url: content has text + one image with reference_image role."""
    request = ArkVideoGenerateRequest(
        prompt="A cat on a sofa",
        mode="reference",
        image_url="https://example.com/ref.jpg",
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 2
    assert payload["content"][0] == {"type": "text", "text": "A cat on a sofa"}
    assert payload["content"][1]["type"] == "image_url"
    assert payload["content"][1]["image_url"]["url"] == "https://example.com/ref.jpg"
    assert payload["content"][1]["role"] == "reference_image"
    assert payload["ratio"] == "adaptive"


# ---------------------------------------------------------------------------
# Test 12: Reference mode with image_urls (two images)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reference_mode_two_image_urls():
    """Reference mode with image_urls: content has text + two images with reference_image role."""
    request = ArkVideoGenerateRequest(
        prompt="Transition from day to night",
        mode="reference",
        image_urls=["https://example.com/day.jpg", "https://example.com/night.jpg"],
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 3
    assert payload["content"][0]["type"] == "text"
    assert payload["content"][1]["type"] == "image_url"
    assert payload["content"][1]["image_url"]["url"] == "https://example.com/day.jpg"
    assert payload["content"][1]["role"] == "reference_image"
    assert payload["content"][2]["type"] == "image_url"
    assert payload["content"][2]["image_url"]["url"] == "https://example.com/night.jpg"
    assert payload["content"][2]["role"] == "reference_image"
    assert payload["ratio"] == "adaptive"


# ---------------------------------------------------------------------------
# Test 13: Reference mode without images uses aspect_ratio
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reference_mode_no_images():
    """Reference mode without images: ratio falls back to aspect_ratio."""
    request = ArkVideoGenerateRequest(
        prompt="Empty reference test",
        mode="reference",
        aspect_ratio="9:16",
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 1
    assert payload["content"][0] == {"type": "text", "text": "Empty reference test"}
    assert payload["ratio"] == "9:16"


# ---------------------------------------------------------------------------
# Test 14: Reference mode with both image_url and image_urls merges them
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reference_mode_merges_image_url_and_image_urls():
    """Reference mode: image_url is prepended to image_urls when not already present."""
    request = ArkVideoGenerateRequest(
        prompt="Merged images test",
        mode="reference",
        image_url="https://example.com/primary.jpg",
        image_urls=["https://example.com/secondary.jpg"],
    )
    payload = await _capture_payload(request)

    assert len(payload["content"]) == 3
    assert (
        payload["content"][1]["image_url"]["url"] == "https://example.com/primary.jpg"
    )
    assert payload["content"][1]["role"] == "reference_image"
    assert (
        payload["content"][2]["image_url"]["url"] == "https://example.com/secondary.jpg"
    )
    assert payload["content"][2]["role"] == "reference_image"
