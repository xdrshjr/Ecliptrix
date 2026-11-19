"""TTS through the SkillRouter gateway (spec §4.3): real HTTP fake gateway and a
real ffmpeg for the chunk merge; the router client is never mocked."""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path

import httpx
import pytest

from app.services.integration_credentials_service import integration_credentials
from app.services.skillrouter import catalog
from app.services.skillrouter.sync_support import reset_sync_cache
from app.services.skillrouter.tts_adapter import (
    RouterTTSClient, cap_tts_concurrency, router_voice_types, split_text,
)
from app.services.tts_errors import TTSServiceError
from app.services.tts_service import TTSClient, TTSService

SPEECH = "/api/v1/media/audio/speech"
VOICE = "zh_female_vv_uranus_bigtts"


@pytest.fixture(autouse=True)
def _clean_caches():
    reset_sync_cache()
    catalog.reset()
    yield
    reset_sync_cache()


@pytest.fixture(scope="module")
def mp3_bytes(tmp_path_factory) -> bytes:
    """A real half-second mp3, so the ffmpeg concat has something to merge."""
    target = tmp_path_factory.mktemp("mp3") / "tone.mp3"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=0.5", "-c:a", "libmp3lame", "-y", str(target)],
        check=True)
    return target.read_bytes()


def _duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


async def _synthesize(text: str, output: Path, voice: str = VOICE, speed: float = 1.0) -> bool:
    return await asyncio.to_thread(RouterTTSClient().synthesize_speech, text, str(output), voice, speed)


def _speech_bodies(gateway) -> list:
    return [json.loads(r["body"]) for r in gateway.requests
            if r["method"] == "POST" and r["path"] == SPEECH]


# ------------------------------------------------------------------ happy path


@pytest.mark.asyncio
async def test_short_text_is_written_to_output_file(fake_gateway, tmp_path):
    output = tmp_path / "out.mp3"
    assert await _synthesize("你好，世界。", output) is True
    assert output.read_bytes() == fake_gateway.speech_bytes
    (body,) = _speech_bodies(fake_gateway)
    assert body == {"text": "你好，世界。", "voice": VOICE, "speed": 1.0, "response": "url"}
    sent = fake_gateway.last("POST", SPEECH)["headers"]
    assert sent["x-api-key"] == fake_gateway.api_key
    asset_gets = [r for r in fake_gateway.requests if r["path"].startswith("/api/v1/media/assets/")]
    assert len(asset_gets) == 1 and asset_gets[0]["headers"]["x-api-key"] == fake_gateway.api_key
    assert list(tmp_path.iterdir()) == [output]


@pytest.mark.asyncio
@pytest.mark.parametrize("requested,expected", [(5.0, 2.0), (0.1, 0.5), (1.25, 1.25)])
async def test_speed_is_clamped_to_gateway_limits(fake_gateway, tmp_path, requested, expected):
    await _synthesize("你好。", tmp_path / "out.mp3", speed=requested)
    assert _speech_bodies(fake_gateway)[0]["speed"] == expected


@pytest.mark.asyncio
async def test_long_text_is_chunked_sequentially_and_merged_with_real_ffmpeg(
        fake_gateway, mp3_bytes, tmp_path):
    fake_gateway.speech_bytes = mp3_bytes
    sentence = "这是一个用来测试分块合并的句子" * 30 + "。"  # 451 chars
    text = sentence * 5
    assert len(text) > 1000
    output = tmp_path / "long.mp3"

    assert await _synthesize(text, output) is True

    bodies = _speech_bodies(fake_gateway)
    assert len(bodies) == 3
    assert all(len(b["text"]) <= 1000 for b in bodies)
    assert "".join(b["text"] for b in bodies) == text
    assert _duration(output) == pytest.approx(0.5 * len(bodies), abs=0.35)
    assert [p.name for p in tmp_path.iterdir()] == ["long.mp3"]


@pytest.mark.asyncio
async def test_chunk_failure_leaves_no_output_or_partial_files(fake_gateway, mp3_bytes, tmp_path):
    fake_gateway.speech_bytes = mp3_bytes
    fake_gateway.fail("POST", SPEECH, 502, "upstream_unavailable", after=1)
    text = ("甲" * 600 + "。") + ("乙" * 600 + "。")
    output = tmp_path / "broken.mp3"

    with pytest.raises(TTSServiceError) as error:
        await _synthesize(text, output)

    assert error.value.error_code == "TTS_PROVIDER_ERROR"
    assert fake_gateway.count("POST", SPEECH) == 2  # no retry of the failed chunk
    assert list(tmp_path.iterdir()) == []


def test_split_text_prefers_sentence_boundaries_and_hard_cuts_long_runs():
    assert split_text("一。二。三。", 4) == ["一。二。", "三。"]
    assert split_text("a" * 25, 10) == ["a" * 10, "a" * 10, "a" * 5]
    assert split_text("short", 1000) == ["short"]


# ------------------------------------------------------------------ voices


@pytest.mark.asyncio
async def test_cloned_voice_is_refused_before_any_gateway_call(fake_gateway, tmp_path):
    output = tmp_path / "clone.mp3"
    with pytest.raises(TTSServiceError) as error:
        await _synthesize("你好。", output, voice="S_abcdef123456")
    assert error.value.error_code == "TTS_VOICE_UNAVAILABLE"
    assert error.value.error_details.suggest == "manual_capability:tts"
    assert fake_gateway.requests == []
    assert not output.exists()


@pytest.mark.asyncio
async def test_voice_catalogue_comes_from_gateway_limits(fake_gateway):
    voices, stale = await router_voice_types(lambda: {})
    assert stale is False
    assert set(voices) == {VOICE}
    assert voices[VOICE].name == "Vivi" and voices[VOICE].gender == "female"


@pytest.mark.asyncio
async def test_voice_catalogue_falls_back_to_static_table_and_marks_stale(fake_gateway):
    fake_gateway.fail("GET", "/api/v1/capabilities", 503, "upstream_unavailable", retry_after=0)
    sentinel = object()
    voices, stale = await router_voice_types(lambda: {"static": sentinel})
    assert stale is True and voices == {"static": sentinel}


@pytest.mark.asyncio
async def test_voice_types_route_reports_gateway_voices(fake_gateway):
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/tts/voice-types")
    payload = response.json()
    assert response.status_code == 200
    assert payload["stale"] is False and list(payload["data"]) == [VOICE]


# ------------------------------------------------------------------ errors


@pytest.mark.asyncio
@pytest.mark.parametrize("status,gateway_code,tts_code,retryable", [
    (401, "authentication_error", "TTS_AUTH_FAILED", False),
    (429, "quota_exceeded", "TTS_QUOTA_EXHAUSTED", False),
    (429, "too_many_inflight", "TTS_RATE_LIMITED", True),
    (429, "upstream_rate_limited", "TTS_RATE_LIMITED", True),
    (504, "upstream_timeout", "TTS_TIMEOUT", True),
    (502, "upstream_unavailable", "TTS_PROVIDER_ERROR", False),
    (502, "invalid_provider_response", "TTS_INVALID_RESPONSE", False),
    (403, "capability_disabled", "TTS_PERMISSION_DENIED", False),
    (400, "invalid_request", "TTS_INVALID_REQUEST", False),
])
async def test_gateway_errors_map_to_existing_tts_codes_without_retrying(
        fake_gateway, tmp_path, status, gateway_code, tts_code, retryable):
    fake_gateway.fail("POST", SPEECH, status, gateway_code, retry_after=0)
    output = tmp_path / "out.mp3"

    with pytest.raises(TTSServiceError) as error:
        await _synthesize("你好。", output)

    assert error.value.error_code == tts_code
    assert error.value.error_details.retryable is retryable
    assert error.value.error_details.provider_code == gateway_code
    assert fake_gateway.count("POST", SPEECH) == 1
    assert not output.exists()


@pytest.mark.asyncio
async def test_unreachable_gateway_maps_to_network_error(fake_gateway, tmp_path):
    await integration_credentials.save("skillrouter", {"base_url": "http://127.0.0.1:9"})
    with pytest.raises(TTSServiceError) as error:
        await _synthesize("你好。", tmp_path / "out.mp3")
    assert error.value.error_code == "TTS_NETWORK_ERROR"
    assert error.value.error_details.retryable is True


@pytest.mark.asyncio
async def test_asset_redirect_to_another_origin_is_refused(fake_gateway, tmp_path):
    fake_gateway.redirect_paths["/api/v1/media/assets/asset1"] = "http://evil.example/steal"
    output = tmp_path / "out.mp3"
    with pytest.raises(TTSServiceError) as error:
        await _synthesize("你好。", output)
    assert error.value.error_code == "TTS_UNKNOWN_ERROR"
    assert error.value.error_details.provider_code == "router_redirect_blocked"
    assert not output.exists() and list(tmp_path.iterdir()) == []


# ------------------------------------------------------------------ service seam


@pytest.mark.asyncio
async def test_tts_service_uses_router_client_end_to_end(fake_gateway, mp3_bytes, tmp_path):
    fake_gateway.speech_bytes = mp3_bytes
    service = TTSService()
    assert isinstance(service.make_tts_client(), RouterTTSClient)
    output = tmp_path / "svc.mp3"

    result = await asyncio.to_thread(
        service.convert_text_to_speech_local, "你好，世界。", VOICE, 1.0, str(output))

    assert result["file_size"] == len(mp3_bytes)
    assert result["duration"] == pytest.approx(0.5, abs=0.2)
    assert result["audio_url"].startswith("/api/audio/generated/")
    assert fake_gateway.count("POST", SPEECH) == 1


@pytest.mark.asyncio
async def test_router_mode_does_not_require_the_volcano_key(fake_gateway):
    TTSService().validate_config()  # would raise TTS_CONFIG_MISSING in manual mode


@pytest.mark.asyncio
async def test_batch_concurrency_is_capped_at_two_in_router_mode(fake_gateway):
    assert cap_tts_concurrency(5) == 2
    assert cap_tts_concurrency(1) == 1


@pytest.mark.asyncio
async def test_manual_capability_override_restores_the_volcano_client(fake_gateway):
    await integration_credentials.save("skillrouter", {"manual_capabilities": "tts"})
    assert isinstance(TTSService().make_tts_client(), TTSClient)
    assert cap_tts_concurrency(5) == 5
    assert fake_gateway.requests == []
