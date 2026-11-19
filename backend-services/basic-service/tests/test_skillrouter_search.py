"""Image / video / audio search through the SkillRouter gateway (spec §4.6):
real HTTP fake gateway, the three real services; the router client is never mocked."""

from __future__ import annotations

import json

import httpx
import pytest

from app.services.audio_search_service import AudioSearchService
from app.services.image_search_service import ImageSearchService
from app.services.integration_credentials_service import integration_credentials
from app.services.skillrouter import catalog, search_adapter
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.sync_support import reset_sync_cache
from app.services.video_search_service import VideoSearchService
from tests import skillrouter_fake

IMAGES = "/api/v1/media/search/images"
VIDEOS = "/api/v1/media/search/videos"
SOUNDS = "/api/v1/media/search/sounds"


@pytest.fixture(autouse=True)
def _clean_caches():
    catalog.reset()
    reset_sync_cache()
    yield
    reset_sync_cache()


def _bodies(gateway, path: str) -> list:
    return [json.loads(r["body"]) for r in gateway.requests
            if r["method"] == "POST" and r["path"] == path]


# ------------------------------------------------------------------ images


@pytest.mark.asyncio
async def test_image_results_map_to_image_info_with_attribution(fake_gateway):
    response = ImageSearchService().search_images("ocean", max_images=5)

    assert response.success and len(response.images) == 5
    first = response.images[0]
    assert (first.id, first.description) == ("image-0", "ocean 0")
    assert first.thumb_url == first.small_url == "https://cdn.example/image/0-t.jpg"
    assert first.regular_url == "https://cdn.example/image/0-p.mp4"
    assert first.raw_url == first.full_url == "https://cdn.example/image/0.mp4"
    assert (first.width, first.height, first.color) == (1920, 1080, "#112233")
    assert first.user_name == "Ann" and first.user_profile_url == "https://cdn.example/ann"
    assert first.html_url == "https://cdn.example/page/0"
    assert first.download_location == "https://cdn.example/dl/0"
    assert first.likes == 0 and first.created_at == ""  # not invented
    assert response.total_found == 100 and response.query == "ocean"
    assert "Photos by image" in response.message
    request = fake_gateway.last("POST", IMAGES)
    assert request["headers"]["x-api-key"] == fake_gateway.api_key
    assert _bodies(fake_gateway, IMAGES) == [{"query": "ocean", "perPage": 5}]


@pytest.mark.asyncio
async def test_unsplash_handle_is_taken_from_the_profile_url(fake_gateway):
    item = {"id": "p1", "thumbUrl": "t", "previewUrl": "p", "downloadUrl": "d",
            "author": {"name": "Jane Doe", "url": "https://unsplash.com/@jane"}}
    info = search_adapter._image_info(item)
    assert (info.user_name, info.user_username) == ("Jane Doe", "jane")


@pytest.mark.asyncio
async def test_sixty_images_follow_the_cursor_over_two_pages(fake_gateway):
    response = ImageSearchService().search_images("ocean", max_images=60)

    bodies = _bodies(fake_gateway, IMAGES)
    assert [b.get("cursor") for b in bodies] == [None, "30"]
    assert all(b["perPage"] == 30 for b in bodies)
    assert len(response.images) == 60
    assert [i.id for i in response.images][-1] == "image-59"


@pytest.mark.asyncio
async def test_filters_are_forwarded_and_unsupported_ones_are_dropped(fake_gateway):
    ImageSearchService().search_images(
        "ocean", max_images=5, orientation="landscape", color="all", order_by="popular")
    assert _bodies(fake_gateway, IMAGES) == [
        {"query": "ocean", "perPage": 5, "orientation": "landscape"}]  # popular: not offered


@pytest.mark.asyncio
async def test_unsupported_orientation_is_ignored_not_an_error(fake_gateway):
    ImageSearchService().search_images("ocean", max_images=5, orientation="squarish_x")
    assert "orientation" not in _bodies(fake_gateway, IMAGES)[0]


# ------------------------------------------------------------------ videos


@pytest.mark.asyncio
async def test_video_results_map_to_video_info(fake_gateway):
    response = VideoSearchService().search_videos("sea", max_videos=3, orientation="landscape")

    assert response.success and len(response.videos) == 3
    video = response.videos[0]
    assert video.id == 1000 and video.author == "Ann" and video.title == "Video by Ann"
    assert video.duration == 5
    assert video.video_url == "https://cdn.example/video/0.mp4"
    assert video.thumbnail == "https://cdn.example/video/0-t.jpg"
    assert (video.width, video.height) == (1920, 1080)
    assert response.total_found == 3
    assert _bodies(fake_gateway, VIDEOS) == [
        {"query": "sea", "perPage": 3, "orientation": "landscape"}]


@pytest.mark.asyncio
async def test_pagination_never_exceeds_max_pages(fake_gateway):
    fake_gateway.search_total = 10_000
    response = search_adapter.search_videos("sea", 1000)

    assert fake_gateway.count("POST", VIDEOS) == search_adapter.MAX_PAGES == 4
    assert len(response.videos) == 4 * 80


@pytest.mark.asyncio
async def test_mixed_orientation_sends_no_filter(fake_gateway):
    VideoSearchService().search_videos("sea", max_videos=2)
    assert "orientation" not in _bodies(fake_gateway, VIDEOS)[0]


# ------------------------------------------------------------------ audio


@pytest.mark.asyncio
async def test_audio_results_map_to_audio_info(fake_gateway):
    response = AudioSearchService().search_audios("rain", max_audios=2)

    assert response.success and len(response.audios) == 2
    audio = response.audios[0]
    assert audio.id == 1000 and audio.name == "audio 0" and audio.username == "Ann"
    assert audio.duration == 5.0 and audio.license == "CC0" and audio.tags == ["a"]
    assert audio.download_url == "https://cdn.example/audio/0.mp4"
    assert audio.preview_url == "https://cdn.example/audio/0-p.mp4"
    assert audio.type is None and audio.bitrate is None and audio.downloads is None
    assert response.total_found == 100


@pytest.mark.asyncio
async def test_audio_filters_are_translated_for_the_gateway(fake_gateway, monkeypatch):
    monkeypatch.setitem(skillrouter_fake.LIMITS["audio_search"], "sorts", ["score", "downloads_desc"])
    AudioSearchService().search_audios(
        "rain", max_audios=5, duration_min=2.0, duration_max=99999,
        audio_type="nature", sort_by="downloads")
    assert _bodies(fake_gateway, SOUNDS) == [{
        "query": "rain", "perPage": 5, "audioType": "nature", "sort": "downloads_desc",
        "minDurationSeconds": 2.0, "maxDurationSeconds": 3600}]


# ------------------------------------------------------------------ failures never look like "no results"


@pytest.mark.asyncio
@pytest.mark.parametrize("call", [
    lambda: ImageSearchService().search_images("x", 5),
    lambda: VideoSearchService().search_videos("x", 5),
    lambda: AudioSearchService().search_audios("x", 5),
])
async def test_gateway_failure_raises_instead_of_returning_empty_results(fake_gateway, call):
    for path in (IMAGES, VIDEOS, SOUNDS):
        fake_gateway.fail("POST", path, 429, "quota_exceeded")
    with pytest.raises(RouterError) as error:
        call()
    assert error.value.error_code == "router_quota_exceeded"


@pytest.mark.asyncio
async def test_authentication_failure_is_not_retried(fake_gateway):
    fake_gateway.fail("POST", IMAGES, 401, "authentication_error")
    with pytest.raises(RouterError) as error:
        ImageSearchService().search_images("x", 5)
    assert error.value.error_code == "router_key_invalid"
    assert fake_gateway.count("POST", IMAGES) == 1


@pytest.mark.asyncio
async def test_search_page_is_retried_once_on_transient_upstream_error(fake_gateway):
    fake_gateway.fail("POST", VIDEOS, 503, "upstream_unavailable", retry_after=0)
    with pytest.raises(RouterError):
        VideoSearchService().search_videos("x", 5)
    assert fake_gateway.count("POST", VIDEOS) == 2


@pytest.mark.asyncio
async def test_failure_after_the_first_page_keeps_the_pages_already_fetched(fake_gateway):
    fake_gateway.fail("POST", IMAGES, 429, "too_many_inflight", retry_after=0, after=1)
    response = ImageSearchService().search_images("ocean", max_images=60)
    assert len(response.images) == 30


@pytest.mark.asyncio
async def test_results_without_usable_ids_are_an_error_not_an_empty_list():
    with pytest.raises(RouterError) as error:
        search_adapter._convert([{"id": "abc"}], search_adapter._video_info, "videos")
    assert error.value.code == "router_bad_response"


@pytest.mark.asyncio
async def test_unreachable_gateway_raises(fake_gateway):
    await integration_credentials.save("skillrouter", {"base_url": "http://127.0.0.1:9"})
    with pytest.raises(RouterError) as error:
        ImageSearchService().search_images("x", 5)
    assert error.value.error_code == "router_unreachable"


# ------------------------------------------------------------------ HTTP surface


@pytest.mark.asyncio
@pytest.mark.parametrize("route,payload", [
    ("/api/image/search", {"query": "x", "max_images": 5}),
    ("/api/video/search", {"query": "x", "max_videos": 5}),
    ("/api/audio/search", {"query": "x", "max_audios": 5}),
])
async def test_search_routes_answer_a_structured_router_error(fake_gateway, route, payload):
    from app.main import app

    for path in (IMAGES, VIDEOS, SOUNDS):
        fake_gateway.fail("POST", path, 429, "quota_exceeded")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(route, json=payload)
    assert response.status_code == 429
    assert response.json()["error_code"] == "router_quota_exceeded"


@pytest.mark.asyncio
async def test_image_route_returns_results_in_router_mode(fake_gateway):
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/image/search", json={"query": "ocean", "max_images": 3})
    payload = response.json()
    assert response.status_code == 200
    assert [i["id"] for i in payload["images"]] == ["image-0", "image-1", "image-2"]


@pytest.mark.asyncio
async def test_manual_capability_override_sends_only_that_capability_to_the_vendor(
        fake_gateway, monkeypatch):
    """AC-10: video_library pinned to manual no longer touches the gateway."""
    await integration_credentials.save("skillrouter", {"manual_capabilities": "video_library"})
    service = VideoSearchService()
    monkeypatch.setattr(type(service), "api_keys", [], raising=False)  # no Pexels key
    response = service.search_videos("sea", max_videos=2)
    assert response.success is False and "not configured" in response.message
    assert fake_gateway.count("POST", VIDEOS) == 0
    ImageSearchService().search_images("sea", max_images=2)  # still routed
    assert fake_gateway.count("POST", IMAGES) == 1
