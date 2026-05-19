"""
Tests for GET /api/admin/playback-metrics (Phase 4 §4.1.2).
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dependencies.auth import require_admin
from app.routers.admin_playback_router import router as admin_router
from app.services import playback_metrics_aggregator as agg_mod
from app.services.playback_metrics_aggregator import (
    PlaybackMetricsAggregator,
    get_playback_metrics_aggregator,
)


class _FakeAdmin:
    id = "admin-uuid"
    username = "admin"
    is_admin = True
    is_root = True
    is_active = True
    user_role = "admin"


class _FakeUser:
    id = "user-uuid"
    username = "alice"
    is_admin = False
    is_root = False
    is_active = True
    user_role = "user"


@pytest.fixture
def app_with_admin():
    agg_mod.reset_playback_metrics_aggregator_for_tests()
    app = FastAPI()
    app.include_router(admin_router, prefix="/api")
    app.dependency_overrides[require_admin] = lambda: _FakeAdmin()
    return app


@pytest.fixture
def admin_client(app_with_admin):
    return TestClient(app_with_admin)


def test_aggregator_returns_zero_when_empty(admin_client):
    resp = admin_client.get("/api/admin/playback-metrics?window=15m")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["sampleCount"] == 0
    assert body["data"]["window"] == "15m"
    assert "worker_pid" in body
    assert "degraded" in body


def test_aggregator_returns_data_after_records(admin_client):
    agg = get_playback_metrics_aggregator()
    import asyncio

    async def push():
        for _ in range(1000):
            await agg.record_event(
                name="playback.playhead_regression",
                value=None,
            )

    asyncio.run(push())
    resp = admin_client.get("/api/admin/playback-metrics?window=15m")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["playheadRegressionLast24h"] >= 1000


def test_window_query_validation(admin_client):
    resp = admin_client.get("/api/admin/playback-metrics?window=not-a-window")
    assert resp.status_code == 422


def test_degraded_flag_when_multi_worker(monkeypatch, admin_client):
    monkeypatch.setenv("GUNICORN_WORKERS", "4")
    resp = admin_client.get("/api/admin/playback-metrics")
    assert resp.status_code == 200
    body = resp.json()
    assert body["degraded"] is True
    assert "aggregator" in (body["degraded_reason"] or "")
