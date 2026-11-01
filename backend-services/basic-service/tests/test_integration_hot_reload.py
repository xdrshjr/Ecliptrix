"""Saving a credential takes effect without a restart
(setup-wizard-full-capability-coverage §3.3, §7.2).

Real path on purpose (CLAUDE.md: do not mock high-risk paths): every service
below is constructed ONCE, then the resolver is written through
``integration_credentials.save`` and the very same instance must see it.
"""

from __future__ import annotations

import logging
from unittest.mock import Mock, patch

import pytest
import pytest_asyncio

from app.services.integration_credentials_service import (
    ark_api_key,
)
from app.services.integration_credentials_service import (
    integration_credentials as creds,
)

KEY = "hot-reload-key-12345678"


@pytest_asyncio.fixture
async def store(integration_db):
    creds.reset()
    return creds


def _override_keys(instance) -> list:
    return [name for name in vars(instance) if name.startswith("_cred_override_")]


@pytest.mark.asyncio
async def test_tts_service_validates_against_the_live_credential(store):
    from app.services.tts_errors import TTSServiceError
    from app.services.tts_service import TTSService

    service = TTSService()
    with pytest.raises(TTSServiceError) as raised:
        service.validate_config()
    assert raised.value.error_code == "TTS_CONFIG_MISSING"

    await store.save("volcano_tts", {"api_key": KEY, "resource_id": "seed-tts-1.0"})

    service.validate_config()
    assert service.api_key == KEY
    assert service.resource_id == "seed-tts-1.0"
    assert _override_keys(service) == []


@pytest.mark.asyncio
async def test_asr_service_sees_credentials_saved_after_construction(store):
    from app.services.audio_transcription_service import AudioTranscriptionService

    service = AudioTranscriptionService()
    assert service._missing_credentials() == "VOLCANO_ASR_APPID"

    await store.save("volcano_asr", {"appid": "1234567890", "access_token": KEY})

    assert service._missing_credentials() is None
    assert service.appid == "1234567890" and service.access_token == KEY
    assert _override_keys(service) == []


@pytest.mark.asyncio
async def test_voice_clone_service_reads_keys_and_resource_at_call_time(store):
    from app.services.voice_clone_service import VoiceCloneService

    service = VoiceCloneService()
    assert not service.app_key and not service.access_key

    await store.save(
        "volcano_voice_clone",
        {"app_key": "9876543210", "access_key": KEY,
         "tts_resource_id": "seed-icl-1.0-concurr"},
    )

    assert service.app_key == "9876543210" and service.access_key == KEY
    assert store.value("volcano_voice_clone", "tts_resource_id") == "seed-icl-1.0-concurr"
    assert _override_keys(service) == []


@pytest.mark.asyncio
async def test_library_search_services_follow_saved_keys(store):
    from app.services.audio_search_service import AudioSearchService
    from app.services.image_search_service import ImageSearchService
    from app.services.video_search_service import VideoSearchService

    video, image, audio = VideoSearchService(), ImageSearchService(), AudioSearchService()
    assert video.api_keys == [] and image.api_keys == [] and not audio.api_key

    await store.save("pexels", {"api_keys": ["pexels-key-11111111"]})
    await store.save("unsplash", {"access_keys": ["unsplash-key-1111111", "unsplash-key-2222222"]})
    await store.save("freesound", {"api_key": "freesound-key-1111"})

    assert video.api_keys == ["pexels-key-11111111"]
    assert image.api_keys == ["unsplash-key-1111111", "unsplash-key-2222222"]
    assert audio.api_key == "freesound-key-1111"
    for service in (video, image, audio):
        assert _override_keys(service) == []


@pytest.mark.asyncio
async def test_unsplash_rotation_survives_the_key_list_shrinking(store):
    from app.services.image_search_service import ImageSearchService

    await store.save("unsplash", {"access_keys": ["unsplash-key-1111111", "unsplash-key-2222222"]})
    service = ImageSearchService()
    service.current_key_index = 1

    await store.save("unsplash", {"access_keys": ["unsplash-key-3333333"]})

    assert service._get_current_api_key() == "unsplash-key-3333333"


@pytest.mark.asyncio
async def test_ark_api_key_helper_tracks_saves_and_clears(store):
    assert ark_api_key() == ""
    await store.save("ark", {"api_key": KEY})
    assert ark_api_key() == KEY
    await store.clear("ark")
    assert ark_api_key() == ""


def test_test_overrides_still_work_and_win_over_the_resolver(store):
    """Existing tests assign ``service.api_key = ''`` to simulate unconfigured."""
    from app.services.tts_service import TTSService

    service = TTSService()
    service.api_key = "invalid-configured-fixture"
    service.validate_config()
    service.api_key = ""
    assert service.api_key == ""


@pytest.mark.asyncio
async def test_freesound_sends_the_key_in_a_header_never_in_the_url(store, caplog):
    from app.services.audio_search_service import AudioSearchService

    await store.save("freesound", {"api_key": KEY})
    response = Mock(status_code=200)
    response.json.return_value = {"count": 0, "results": []}
    response.raise_for_status.return_value = None
    with patch("app.services.audio_search_service.requests.get", return_value=response) as get:
        with caplog.at_level(logging.DEBUG):
            AudioSearchService()._make_api_request("search/text/", {"query": "rain"})

    args, kwargs = get.call_args
    assert KEY not in str(args) and "token" not in kwargs["params"]
    assert kwargs["headers"] == {"Authorization": f"Token {KEY}"}
    assert KEY not in caplog.text


@pytest.mark.asyncio
async def test_pexels_no_longer_logs_key_fragments(store, caplog):
    from app.services.video_search_service import VideoSearchService

    await store.save("pexels", {"api_keys": [KEY]})
    with caplog.at_level(logging.DEBUG):
        picked = VideoSearchService()._get_random_api_key()

    assert picked == KEY
    assert KEY[:10] not in caplog.text and KEY[-5:] not in caplog.text
