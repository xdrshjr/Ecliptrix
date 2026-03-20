"""
Integration tests for the Ark Video Generation dual-mode support.

Tests the create_task() service function and the router endpoint logic,
mocking external ARK API calls to verify request construction.

Uses sys.modules mocking to handle heavy optional dependencies (cv2, pydub, etc.)
that may not be installed in the test environment.
"""

import sys
from unittest.mock import MagicMock

# Pre-mock heavy optional dependencies imported transitively by app.services.__init__
# and other modules. These must be set before any app imports.
_MOCK_MODULES = [
    "cv2", "pydub", "pydub.audio_segment", "yt_dlp",
    "whisper", "pyaudio", "librosa", "soundfile",
]
for mod_name in _MOCK_MODULES:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

import asyncio
from unittest.mock import patch, AsyncMock

import pytest
import httpx
from httpx import Response, Request

# Now safe to import app modules
from app.models.ark_video_models import ArkVideoGenerateRequest
import app.services.ark_video_service as ark_video_svc


def _make_mock_ark_response(status_code: int = 200, body: dict = None):
    """Create a mock httpx.Response."""
    if body is None:
        body = {"id": "fake-task-id"}
    request = Request(method="POST", url="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks")
    return Response(status_code=status_code, json=body, request=request)


@pytest.fixture
def captured_payloads():
    """List that accumulates payloads sent to the mocked ARK API."""
    return []


@pytest.fixture
def mock_ark_api(captured_payloads):
    """Patch httpx.AsyncClient.post to intercept ARK API calls."""
    original_post = httpx.AsyncClient.post

    async def fake_post(self, url, **kwargs):
        if "ark.cn-beijing.volces.com" in str(url):
            payload = kwargs.get("json", {})
            captured_payloads.append(payload)
            return _make_mock_ark_response(200, {"id": "fake-task-id"})
        return await original_post(self, url, **kwargs)

    with patch.object(httpx.AsyncClient, "post", new=fake_post):
        yield


@pytest.fixture(autouse=True)
def mock_settings():
    """Ensure ark_api_key is set for tests."""
    original_key = ark_video_svc.settings.ark_api_key
    ark_video_svc.settings.ark_api_key = "test-api-key-12345"
    yield
    ark_video_svc.settings.ark_api_key = original_key


def _run(coro):
    """Helper to run an async function synchronously."""
    return asyncio.get_event_loop().run_until_complete(coro)


# ---- Scenario A: Description mode - no images (backward compat) ----

def test_scenario_a_description_no_images(mock_ark_api, captured_payloads):
    """POST with just prompt (no mode field) should work as backward-compatible description mode."""
    request = ArkVideoGenerateRequest(prompt="test")
    task_id = _run(ark_video_svc.create_task(request))

    assert task_id == "fake-task-id"
    assert len(captured_payloads) == 1

    payload = captured_payloads[0]
    content = payload["content"]

    # Should only have text, no images
    assert len(content) == 1
    assert content[0]["type"] == "text"
    assert content[0]["text"] == "test"

    # Ratio should be default "16:9" when no images
    assert payload["ratio"] == "16:9"


# ---- Scenario B: Description mode - with images ----

def test_scenario_b_description_with_images(mock_ark_api, captured_payloads):
    """Description mode with image_urls should include images as first_frame/last_frame."""
    request = ArkVideoGenerateRequest(
        prompt="test",
        mode="description",
        image_urls=["http://img1.jpg", "http://img2.jpg"],
    )
    task_id = _run(ark_video_svc.create_task(request))

    assert task_id == "fake-task-id"
    assert len(captured_payloads) == 1

    payload = captured_payloads[0]
    content = payload["content"]

    # Should have text + 2 images
    assert len(content) == 3
    assert content[0]["type"] == "text"

    # First image -> first_frame role
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"] == "http://img1.jpg"
    assert content[1]["role"] == "first_frame"

    # Second image -> last_frame role
    assert content[2]["type"] == "image_url"
    assert content[2]["image_url"]["url"] == "http://img2.jpg"
    assert content[2]["role"] == "last_frame"

    # Ratio should be "adaptive" when images are present
    assert payload["ratio"] == "adaptive"


# ---- Scenario C: Keyframe mode - first frame only ----

def test_scenario_c_keyframe_first_frame_only(mock_ark_api, captured_payloads):
    """Keyframe mode with only first_frame_url should work."""
    request = ArkVideoGenerateRequest(
        prompt="test",
        mode="keyframe",
        first_frame_url="http://first.jpg",
    )
    task_id = _run(ark_video_svc.create_task(request))

    assert task_id == "fake-task-id"
    assert len(captured_payloads) == 1

    payload = captured_payloads[0]
    content = payload["content"]

    # Should have text + 1 image
    assert len(content) == 2
    assert content[0]["type"] == "text"
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"] == "http://first.jpg"
    assert content[1]["role"] == "first_frame"

    # Ratio should be "adaptive" in keyframe mode
    assert payload["ratio"] == "adaptive"


# ---- Scenario D: Keyframe mode - first + last frame ----

def test_scenario_d_keyframe_both_frames(mock_ark_api, captured_payloads):
    """Keyframe mode with both first and last frame URLs."""
    request = ArkVideoGenerateRequest(
        prompt="test",
        mode="keyframe",
        first_frame_url="http://first.jpg",
        last_frame_url="http://last.jpg",
    )
    task_id = _run(ark_video_svc.create_task(request))

    assert task_id == "fake-task-id"
    assert len(captured_payloads) == 1

    payload = captured_payloads[0]
    content = payload["content"]

    # Should have text + 2 images
    assert len(content) == 3
    assert content[0]["type"] == "text"
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"] == "http://first.jpg"
    assert content[1]["role"] == "first_frame"
    assert content[2]["type"] == "image_url"
    assert content[2]["image_url"]["url"] == "http://last.jpg"
    assert content[2]["role"] == "last_frame"

    assert payload["ratio"] == "adaptive"


# ---- Scenario E: Keyframe mode - missing first frame (should fail) ----

def test_scenario_e_keyframe_missing_first_frame(mock_ark_api, captured_payloads):
    """Keyframe mode without first_frame_url should raise ValueError."""
    request = ArkVideoGenerateRequest(
        prompt="test",
        mode="keyframe",
    )
    with pytest.raises(ValueError, match="first_frame_url is required"):
        _run(ark_video_svc.create_task(request))

    # No payload should have been sent to ARK API
    assert len(captured_payloads) == 0


# ---- Scenario F: Keyframe mode ignores image_urls ----

def test_scenario_f_keyframe_ignores_image_urls(mock_ark_api, captured_payloads):
    """Keyframe mode should ignore image_urls field."""
    request = ArkVideoGenerateRequest(
        prompt="test",
        mode="keyframe",
        first_frame_url="http://first.jpg",
        image_urls=["http://should-ignore.jpg"],
    )
    task_id = _run(ark_video_svc.create_task(request))

    assert task_id == "fake-task-id"
    assert len(captured_payloads) == 1

    payload = captured_payloads[0]
    content = payload["content"]

    # Verify "http://should-ignore.jpg" is NOT in any content item
    all_urls = [
        item.get("image_url", {}).get("url", "")
        for item in content
        if item.get("type") == "image_url"
    ]
    assert "http://should-ignore.jpg" not in all_urls

    # Should only have text + first_frame
    assert len(content) == 2
    assert content[1]["image_url"]["url"] == "http://first.jpg"


# ---- Scenario G: Description mode ignores first_frame_url ----

def test_scenario_g_description_ignores_first_frame_url(mock_ark_api, captured_payloads):
    """Description mode should ignore first_frame_url field."""
    request = ArkVideoGenerateRequest(
        prompt="test",
        mode="description",
        first_frame_url="http://should-ignore.jpg",
    )
    task_id = _run(ark_video_svc.create_task(request))

    assert task_id == "fake-task-id"
    assert len(captured_payloads) == 1

    payload = captured_payloads[0]
    content = payload["content"]

    # Verify first_frame_url is NOT in any content item
    all_urls = [
        item.get("image_url", {}).get("url", "")
        for item in content
        if item.get("type") == "image_url"
    ]
    assert "http://should-ignore.jpg" not in all_urls

    # Should only have text (no images in description mode without image_urls)
    assert len(content) == 1


# ---- Scenario H: All frontend params accepted ----

def test_scenario_h_all_frontend_params(mock_ark_api, captured_payloads):
    """All fields from the TypeScript ArkVideoGenerateParams interface should be accepted."""
    # This tests that the Pydantic model accepts all fields the frontend can send
    request = ArkVideoGenerateRequest(
        prompt="test",
        mode="keyframe",
        first_frame_url="http://first.jpg",
        last_frame_url="http://last.jpg",
        duration=10,
        camera_fixed=True,
        watermark=False,
        resolution="1080p",
    )
    task_id = _run(ark_video_svc.create_task(request))

    assert task_id == "fake-task-id"
    assert len(captured_payloads) == 1

    payload = captured_payloads[0]

    # Duration and resolution should be passed through
    assert payload["duration"] == 10
    assert payload["resolution"] == "1080p"

    # Keyframe mode: ratio is adaptive
    assert payload["ratio"] == "adaptive"

    # Content should have text + 2 images
    content = payload["content"]
    assert len(content) == 3
    assert content[1]["role"] == "first_frame"
    assert content[2]["role"] == "last_frame"


# ---- Additional: Verify Pydantic model accepts all frontend fields ----

def test_pydantic_model_accepts_all_frontend_fields():
    """Ensure ArkVideoGenerateRequest accepts every field from ArkVideoGenerateParams."""
    # These are ALL fields from the TypeScript interface
    request = ArkVideoGenerateRequest(
        prompt="test prompt",
        duration=5,
        camera_fixed=False,
        watermark=True,
        image_url="http://img.jpg",
        image_urls=["http://img1.jpg", "http://img2.jpg"],
        aspect_ratio="9:16",
        resolution="480p",
        mode="description",
        first_frame_url="http://first.jpg",
        last_frame_url="http://last.jpg",
    )
    # Verify all fields are set
    assert request.prompt == "test prompt"
    assert request.duration == 5
    assert request.camera_fixed is False
    assert request.watermark is True
    assert request.image_url == "http://img.jpg"
    assert request.image_urls == ["http://img1.jpg", "http://img2.jpg"]
    assert request.aspect_ratio == "9:16"
    assert request.resolution == "480p"
    assert request.mode == "description"
    assert request.first_frame_url == "http://first.jpg"
    assert request.last_frame_url == "http://last.jpg"
