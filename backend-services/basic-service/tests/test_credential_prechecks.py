"""Feature routes refuse BEFORE doing any work when their credentials are
missing (setup-wizard-full-capability-coverage §3.9, RV2-13).

Some services answer a missing key with ``None`` / an empty result that the
UI would render as "no search results"; the router-level precheck turns that
into the stable ``credential_not_configured`` error the wizard can act on.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.integration_credentials_service import (
    integration_credentials as creds,
)

ROUTES = [
    ("pexels", "/api/video/search", {"query": "nature"}),
    ("unsplash", "/api/image/search", {"query": "nature"}),
    ("freesound", "/api/audio/search", {"query": "rain"}),
    ("ark", "/api/ark-video/generate", {"prompt": "a cat"}),
    ("ark", "/api/ark-image/generate", {"prompt": "a cat"}),
    ("ark", "/api/storyboard/generate", {"prompt": "a cat", "project_id": "p-1"}),
    ("ark", "/api/storyboard/batch-video", {"pack_id": "x", "segments": []}),
    ("volcano_voice_clone", "/api/voice-clone/train",
     {"audio_url": "a.wav", "text": "hello", "speaker_id": "S_1"}),
    ("volcano_voice_clone", "/api/voice-clone/synthesize",
     {"text": "hello", "voice_type": "S_1"}),
]


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.parametrize("integration_id, path, body", ROUTES)
def test_unconfigured_feature_route_answers_credential_not_configured(
    client, integration_id, path, body
):
    response = client.post(path, json=body)

    assert response.status_code == 409, response.text
    payload = response.json()
    assert payload["error_code"] == "credential_not_configured"
    assert payload["error_details"] == {"integration_id": integration_id}
    assert payload["success"] is False


def test_a_saved_key_lets_the_request_through_to_the_service(client, monkeypatch):
    from app.config import settings
    from app.routers import audio_router

    monkeypatch.setattr(settings, "volcano_tts_api_key", "unrelated-key-12345")
    monkeypatch.setenv("FREESOUND_API_KEY", "freesound-key-12345")
    reached = []

    def fake_search(**kwargs):
        reached.append(kwargs["query"])
        raise RuntimeError("stop here")

    monkeypatch.setattr(audio_router.audio_search_service, "search_audios", fake_search)

    response = client.post("/api/audio/search", json={"query": "rain"})

    assert reached == ["rain"]
    assert response.status_code != 409
    assert creds.is_usable("freesound")
