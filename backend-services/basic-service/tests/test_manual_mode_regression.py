"""Default (manual) installs never touch the SkillRouter gateway (spec §8.1, AC-09, AC-13).

``fake_gateway_manual`` runs a real gateway but the app is left in its default
mode; every seam touched by the SkillRouter work must behave exactly as before
and the gateway must see ZERO requests. The kill switch (``SKILLROUTER_ENABLED=0``)
gets the same guarantee while router mode is configured.
"""

from __future__ import annotations

import json
from datetime import date
from unittest.mock import Mock

import httpx
import pytest
import requests

from app.models.ark_image_models import ArkImageGenerateRequest
from app.services import ark_image_service, tts_service as tts_module
from app.services.audio_search_service import AudioSearchService
from app.services.image_search_service import ImageSearchService
from app.services.integration_credentials_service import integration_credentials
from app.services.skillrouter import catalog, is_routed
from app.services.skillrouter.constants import ROUTED
from app.services.skillrouter.tts_adapter import cap_tts_concurrency
from app.services.tts_errors import TTSServiceError
from app.services.tts_service import TTSClient, TTSService
from app.services.video_search_service import VideoSearchService

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
       b"\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0"
       b"\xa0\x00\x00\x00\x00IEND\xaeB`\x82")


def _assert_gateway_untouched(gateway) -> None:
    assert gateway.requests == [], [r["path"] for r in gateway.requests]


@pytest.fixture(autouse=True)
def _fresh_catalog():
    catalog.reset()


# ------------------------------------------------------------------ routing decision


@pytest.mark.asyncio
async def test_default_install_routes_nothing(fake_gateway_manual):
    assert [cap for cap in ROUTED if is_routed(cap)] == []
    _assert_gateway_untouched(fake_gateway_manual)


@pytest.mark.asyncio
async def test_kill_switch_forces_manual_paths_even_in_router_mode(fake_gateway, monkeypatch):
    assert is_routed("tts")
    monkeypatch.setenv("SKILLROUTER_ENABLED", "0")
    assert [cap for cap in ROUTED if is_routed(cap)] == []
    assert isinstance(TTSService().make_tts_client(), TTSClient)
    assert cap_tts_concurrency(5) == 5
    fake_gateway.requests.clear()
    response = ImageSearchService().search_images("x", 3)
    assert response.success is False and "not configured" in response.message
    assert fake_gateway.requests == []


# ------------------------------------------------------------------ TTS


@pytest.mark.asyncio
async def test_tts_manual_path_uses_volcano_client_and_keeps_its_config_check(
        fake_gateway_manual, monkeypatch, tmp_path):
    service = TTSService()
    with pytest.raises(TTSServiceError) as missing:
        service.validate_config()
    assert missing.value.error_code == "TTS_CONFIG_MISSING"

    await integration_credentials.save("volcano_tts", {"api_key": "volcano-test-key-123456"})
    assert isinstance(service.make_tts_client(), TTSClient)
    monkeypatch.setattr(tts_module, "MOCK_MODE", True)  # the existing offline switch
    output = tmp_path / "manual.mp3"

    result = service.convert_text_to_speech_local("你好，世界。", output_path=str(output))

    assert output.exists() and result["file_size"] > 0 and result["mock_mode"] is True
    _assert_gateway_untouched(fake_gateway_manual)


@pytest.mark.asyncio
async def test_batch_concurrency_is_not_capped_in_manual_mode(fake_gateway_manual):
    assert cap_tts_concurrency(7) == 7


@pytest.mark.asyncio
async def test_voice_types_route_serves_the_static_table_without_stale_flag(fake_gateway_manual):
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/tts/voice-types")
    payload = response.json()
    assert response.status_code == 200
    assert payload["stale"] is False and len(payload["data"]) > 1
    _assert_gateway_untouched(fake_gateway_manual)


# ------------------------------------------------------------------ AI image


@pytest.fixture
def ark_env(monkeypatch, tmp_path):
    """Intercept ARK + CDN traffic inside ark_image_service.httpx (as the existing tests do)."""
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/images/generations"):
            return httpx.Response(200, json={"data": [{"url": "https://cdn.invalid/a.png"}]})
        return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    real = httpx.AsyncClient
    monkeypatch.setattr(ark_image_service.httpx, "AsyncClient", lambda *a, **k: real(
        *a, **{**k, "transport": httpx.MockTransport(handler)}))
    monkeypatch.setattr(ark_image_service.settings, "ark_image_api_key", "ark-test-key")
    monkeypatch.setattr(ark_image_service.settings.storage, "root", str(tmp_path))
    return seen


def _image_request() -> ArkImageGenerateRequest:
    return ArkImageGenerateRequest(prompt="duck", mode="basic", size="1280x720", count=1,
                                   watermark=False, grid_mode=False)


@pytest.mark.asyncio
async def test_image_manual_path_posts_to_ark_and_downloads_from_the_cdn(
        fake_gateway_manual, ark_env, tmp_path):
    images, pack = await ark_image_service.generate_images_with_pack(_image_request())

    assert pack is None and len(images) == 1
    (image,) = images
    today = date.today().strftime("%Y%m%d")
    assert image.local_url.startswith(f"/api/storage/files/images/ark/{today}/")
    assert (tmp_path / "images" / "ark" / today / image.local_url.rsplit("/", 1)[1]).read_bytes() == PNG
    assert (image.width, image.height, image.notes) == (1280, 720, [])
    ark_post = next(r for r in ark_env if r.method == "POST")
    assert ark_post.headers["authorization"] == "Bearer ark-test-key"
    assert json.loads(ark_post.read())["model"] == ark_image_service.ARK_IMAGE_MODEL
    assert [r.url.host for r in ark_env] == ["ark.cn-beijing.volces.com", "cdn.invalid"]
    _assert_gateway_untouched(fake_gateway_manual)


@pytest.mark.asyncio
async def test_image_defer_download_still_returns_the_cdn_url_in_manual_mode(
        fake_gateway_manual, ark_env):
    (image,), _ = await ark_image_service.generate_images_with_pack(
        _image_request(), defer_download=True)
    assert image.image_url == "https://cdn.invalid/a.png" and image.local_url is None
    assert [r.url.host for r in ark_env] == ["ark.cn-beijing.volces.com"]  # nothing downloaded
    _assert_gateway_untouched(fake_gateway_manual)


@pytest.mark.asyncio
async def test_image_without_a_seedream_key_keeps_the_original_error(fake_gateway_manual, monkeypatch):
    monkeypatch.setattr(ark_image_service.settings, "ark_image_api_key", "")
    with pytest.raises(ValueError):
        await ark_image_service.generate_images_with_pack(_image_request())
    _assert_gateway_untouched(fake_gateway_manual)


# ------------------------------------------------------------------ search


def _json_response(payload: dict) -> Mock:
    response = Mock()
    response.status_code = 200
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


@pytest.mark.asyncio
async def test_image_search_manual_path_calls_unsplash(fake_gateway_manual, monkeypatch):
    await integration_credentials.save("unsplash", {"access_keys": "unsplash-key-1"})
    photo = {"id": "u1", "width": 10, "height": 8, "urls": {"thumb": "t", "small": "s",
             "regular": "r", "full": "f", "raw": "w"}, "user": {"id": "1", "name": "Zed",
             "username": "zed"}, "links": {"html": "h", "download_location": "d"}}
    get = Mock(return_value=_json_response({"total": 1, "results": [photo]}))
    monkeypatch.setattr(requests, "get", get)

    response = ImageSearchService().search_images("sea", max_images=1)

    assert [i.id for i in response.images] == ["u1"] and response.message == "Found 1 images"
    assert get.call_args.args[0] == "https://api.unsplash.com/search/photos"
    _assert_gateway_untouched(fake_gateway_manual)


@pytest.mark.asyncio
async def test_video_search_manual_path_calls_pexels(fake_gateway_manual, monkeypatch):
    await integration_credentials.save("pexels", {"api_keys": "pexels-key-1"})
    video = {"id": 7, "duration": 9, "user": {"name": "Ann"},
             "video_files": [{"width": 1280, "height": 720, "link": "https://p/7.mp4"}],
             "video_pictures": [{"picture": "https://p/7.jpg"}]}
    get = Mock(return_value=_json_response({"videos": [video]}))
    monkeypatch.setattr(requests, "get", get)

    response = VideoSearchService().search_videos("sea", max_videos=1)

    assert [v.id for v in response.videos] == [7] and response.videos[0].video_url == "https://p/7.mp4"
    assert get.call_args.args[0] == "https://api.pexels.com/videos/search"
    _assert_gateway_untouched(fake_gateway_manual)


@pytest.mark.asyncio
async def test_audio_search_manual_path_calls_freesound(fake_gateway_manual, monkeypatch):
    await integration_credentials.save("freesound", {"api_key": "freesound-key-1"})
    sound = {"id": 5, "name": "Rain", "username": "ann", "duration": 3,
             "previews": {"preview-hq-mp3": "https://f/5.mp3", "preview-lq-mp3": "https://f/5l.mp3"}}
    get = Mock(return_value=_json_response({"count": 1, "results": [sound]}))
    monkeypatch.setattr(requests, "get", get)

    response = AudioSearchService().search_audios("rain", max_audios=1)

    assert [a.id for a in response.audios] == [5] and response.total_found == 1
    assert get.call_args.args[0] == "https://freesound.org/apiv2/search/text/"
    _assert_gateway_untouched(fake_gateway_manual)


@pytest.mark.asyncio
@pytest.mark.parametrize("route,payload", [
    ("/api/image/search", {"query": "x"}),
    ("/api/video/search", {"query": "x"}),
    ("/api/audio/search", {"query": "x"}),
])
async def test_search_routes_keep_the_manual_credential_gate(fake_gateway_manual, route, payload):
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(route, json=payload)
    body = response.json()
    assert response.status_code == 409 and body["error_code"] == "credential_not_configured"
    assert body["error_details"]["integration_id"] in {"unsplash", "pexels", "freesound"}
    _assert_gateway_untouched(fake_gateway_manual)
