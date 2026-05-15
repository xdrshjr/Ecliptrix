"""
Router-level regression tests for the duplicate ``/audio/health`` route bug.

Before this PR, ``audio_router.py`` declared two ``@router.get("/health")``
handlers — the second one (Freesound) silently shadowed the ASR transcription
health endpoint. This module asserts the post-fix shape so future drift fails
loudly:

* ``GET /audio/health`` returns the ASR transcription health payload, including
  ``appid_configured`` and ``resource_id_configured`` keys.
* ``GET /audio/search/health`` returns the Freesound audio-search payload with
  ``api_key_configured``.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


def _build_test_app():
    """Build a minimal FastAPI app that mounts only audio_router."""
    from app.routers.audio_router import router as audio_router

    app = FastAPI()
    app.include_router(audio_router)
    return app


@pytest.mark.asyncio
async def test_audio_health_returns_transcription_payload():
    app = _build_test_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/audio/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["service"] == "audio_transcription"
    assert "appid_configured" in body["config"]
    assert "access_token_configured" in body["config"]
    assert "resource_id_configured" in body["config"]


@pytest.mark.asyncio
async def test_audio_search_health_returns_freesound_payload():
    app = _build_test_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/audio/search/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["service"] == "audio_search"
    assert "api_key_configured" in body
