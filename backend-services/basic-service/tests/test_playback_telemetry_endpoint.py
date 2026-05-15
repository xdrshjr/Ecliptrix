"""
Tests for POST /api/telemetry/playback (spec 08 §5.1).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.telemetry_router import router as telemetry_router


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(telemetry_router, prefix="/api")
    return TestClient(app)


def test_accepts_batch_payload(client):
    resp = client.post(
        "/api/telemetry/playback",
        json={
            "sessionId": "session-1",
            "taskId": "task-1",
            "flagVariant": "v2",
            "events": [
                {
                    "name": "playback.click_to_first_frame_ms",
                    "value": 87,
                    "tags": {"source": "pexels"},
                    "ts": 1234567890,
                },
                {"name": "playback.playhead_regression", "value": 1, "ts": 1234567891},
            ],
        },
    )
    assert resp.status_code == 204
    assert resp.content == b""


def test_rejects_invalid_flag_variant(client):
    resp = client.post(
        "/api/telemetry/playback",
        json={
            "sessionId": "session-1",
            "taskId": "task-1",
            "flagVariant": "bogus",
            "events": [],
        },
    )
    assert resp.status_code == 422


def test_empty_events_is_no_op(client):
    resp = client.post(
        "/api/telemetry/playback",
        json={
            "sessionId": "session-1",
            "taskId": "",
            "flagVariant": "legacy",
            "events": [],
        },
    )
    assert resp.status_code == 204
