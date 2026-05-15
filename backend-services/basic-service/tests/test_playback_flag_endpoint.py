"""
Tests for GET /api/config/playback-flag (spec 08 §4.2).
"""

from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.config_router import router as config_router


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(config_router, prefix="/api")
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("PLAYBACK_V2_ROLLOUT_PERCENT", raising=False)
    monkeypatch.delenv("PLAYBACK_V2_FORCE_ENABLED_USER_IDS", raising=False)
    monkeypatch.delenv("PLAYBACK_V2_ENABLED", raising=False)
    yield


def test_anonymous_request_with_zero_rollout_is_disabled(client):
    resp = client.get("/api/config/playback-flag")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["enabled"] is False
    assert body["data"]["rolloutPercent"] == 0
    assert body["data"]["reason"] == "anonymous"


def test_force_enabled_user_id_overrides_rollout(client, monkeypatch):
    monkeypatch.setenv("PLAYBACK_V2_FORCE_ENABLED_USER_IDS", "alice,bob")
    monkeypatch.setenv("PLAYBACK_V2_ROLLOUT_PERCENT", "0")
    resp = client.get("/api/config/playback-flag", params={"userId": "alice"})
    assert resp.json()["data"]["enabled"] is True
    assert resp.json()["data"]["reason"] == "force-enabled"


def test_master_disabled_returns_false(client, monkeypatch):
    monkeypatch.setenv("PLAYBACK_V2_ENABLED", "false")
    monkeypatch.setenv("PLAYBACK_V2_ROLLOUT_PERCENT", "100")
    resp = client.get("/api/config/playback-flag", params={"userId": "alice"})
    body = resp.json()["data"]
    assert body["enabled"] is False
    assert body["reason"] == "master-disabled"


def test_bucket_is_stable_for_same_user(client, monkeypatch):
    monkeypatch.setenv("PLAYBACK_V2_ROLLOUT_PERCENT", "100")
    r1 = client.get("/api/config/playback-flag", params={"userId": "alice"}).json()
    r2 = client.get("/api/config/playback-flag", params={"userId": "alice"}).json()
    assert r1["data"]["enabled"] is True
    assert r1["data"]["reason"] == r2["data"]["reason"]


def test_rollout_zero_disables_all_known_users(client, monkeypatch):
    monkeypatch.setenv("PLAYBACK_V2_ROLLOUT_PERCENT", "0")
    resp = client.get("/api/config/playback-flag", params={"userId": "alice"}).json()
    assert resp["data"]["enabled"] is False
    assert resp["data"]["reason"].startswith("bucket=")
