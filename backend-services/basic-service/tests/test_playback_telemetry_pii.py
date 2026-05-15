"""
Tests for PII validation in POST /api/telemetry/playback (Phase 4 §3.2.5 / INV11).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.telemetry_router import router as telemetry_router
from app.services import playback_metrics_aggregator as agg_mod


@pytest.fixture(autouse=True)
def _reset_aggregator():
    agg_mod.reset_playback_metrics_aggregator_for_tests()
    yield
    agg_mod.reset_playback_metrics_aggregator_for_tests()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(telemetry_router, prefix="/api")
    return TestClient(app)


def _payload(**overrides):
    base = {
        "sessionId": "session-1",
        "taskId": "task-1",
        "flagVariant": "v2",
        "events": [
            {
                "name": "playback.playhead_regression",
                "value": None,
                "ts": 1_700_000_000_000,
            }
        ],
    }
    base.update(overrides)
    return base


def test_raw_userid_is_stripped(client):
    resp = client.post(
        "/api/telemetry/playback", json=_payload(userId="alice@example.com")
    )
    assert resp.status_code == 204


def test_hashed_userid_is_accepted(client):
    resp = client.post(
        "/api/telemetry/playback", json=_payload(userId="0123456789ab")
    )
    assert resp.status_code == 204


def test_uppercase_hex_is_normalized_lowercase(client):
    # Pydantic strips invalid shapes; uppercase 12-hex should be accepted.
    resp = client.post(
        "/api/telemetry/playback", json=_payload(userId="ABCDEF012345")
    )
    assert resp.status_code == 204


def test_too_short_userid_is_stripped(client):
    resp = client.post(
        "/api/telemetry/playback", json=_payload(userId="abc")
    )
    assert resp.status_code == 204
