"""SkillRouter configuration row, validation, routing decision and HTTP API
(docs/plans/skillrouter-capability-gateway §3.2, §3.6, §5.1, §9.1)."""

from __future__ import annotations

import logging

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models.model_settings_models import ModelFunctionType
from app.routers.integrations_router import router as integrations_router
from app.routers.skillrouter_router import router as skillrouter_router
from app.routers.skillrouter_router import router_error_response
from app.services.credential_errors import CredentialNotConfigured, require_configured
from app.services.integration_credentials_service import (
    CredentialValidationError, integration_credentials as creds, validate_patch,
)
from app.services.integration_registry import get_spec, serialize_registry
from app.services.skillrouter import catalog, get_snapshot, is_routed
from app.services.skillrouter import settings_service
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.validation import validate_base_url, validate_manual_capabilities

KEY = "ar-CANARY-key-0123456789"
ORIGIN = {"Origin": "http://localhost:3000", "Content-Type": "application/json"}


@pytest_asyncio.fixture
async def store(integration_db):
    creds.reset()
    settings_service.reset()
    return creds


def _build_client():
    app = FastAPI()
    app.include_router(skillrouter_router, prefix="/api")
    app.include_router(integrations_router, prefix="/api")
    app.add_exception_handler(RouterError, lambda r, e: router_error_response(e))
    return TestClient(app)


@pytest.fixture
def client(store):
    return _build_client()


@pytest.fixture
def gw_client(fake_gateway):
    """Client for gateway-backed tests: must not reset the router-mode credentials."""
    settings_service.reset()
    return _build_client()


# ------------------------------------------------------------ defaults / mode


@pytest.mark.asyncio
async def test_default_install_is_unset_and_routes_nothing(store):
    snapshot = get_snapshot()
    assert snapshot.mode == "manual" and snapshot.mode_state == "unset"
    assert not snapshot.has_key
    for capability in ("chat", "tts", "ai_image", "video_library", "web_search"):
        assert is_routed(capability) is False


@pytest.mark.asyncio
async def test_router_mode_requires_a_key(store):
    with pytest.raises(CredentialValidationError) as error:
        await store.save("skillrouter", {"mode": "router"})
    assert error.value.code == "router_key_required"
    assert get_snapshot().mode_state == "unset"


@pytest.mark.asyncio
async def test_router_mode_routes_eleven_and_never_manual_only(store):
    await store.save("skillrouter", {"mode": "router", "api_key": KEY})
    routed = {c for c in (
        "chat", "fast", "video_cut", "vision", "research", "tts", "ai_image",
        "ai_video", "video_library", "image_library", "audio_library") if is_routed(c)}
    assert len(routed) == 11
    for capability in ("web_search", "asr", "voice_clone"):
        assert is_routed(capability) is False


@pytest.mark.asyncio
async def test_manual_capabilities_override_and_manual_only_ignored(store):
    await store.save("skillrouter", {
        "mode": "router", "api_key": KEY,
        "manual_capabilities": "video_library, web_search,tts,tts"})
    assert get_snapshot().manual_capabilities == ("video_library", "tts")
    assert is_routed("video_library") is False and is_routed("image_library") is True


@pytest.mark.asyncio
async def test_kill_switch_forces_manual(store, monkeypatch):
    await store.save("skillrouter", {"mode": "router", "api_key": KEY})
    monkeypatch.setenv("SKILLROUTER_ENABLED", "0")
    assert is_routed("chat") is False


@pytest.mark.asyncio
async def test_switching_modes_keeps_manual_credentials(store):
    await store.save("volcano_tts", {"api_key": "manual-tts-key-1234"})
    await store.save("skillrouter", {"mode": "router", "api_key": KEY})
    await store.save("skillrouter", {"mode": "manual"})
    assert store.value("volcano_tts", "api_key") == "manual-tts-key-1234"
    assert is_routed("tts") is False


# ----------------------------------------------------------------- validation


@pytest.mark.parametrize("value,ok", [
    ("https://www.skillrouter.net", True),
    ("https://www.skillrouter.net/", True),
    ("http://localhost:3000", True),
    ("http://127.0.0.1:8080", True),
    ("http://evil.example.com", False),
    ("https://user:pw@host.example", False),
    ("https://host.example/?a=1", False),
    ("https://host.example/#frag", False),
    ("ftp://host.example", False),
    ("https://" + "a" * 200 + ".com", False),
    ("", False),
])
def test_base_url_validation(value, ok):
    if ok:
        assert validate_base_url(value) == value.rstrip("/")
    else:
        with pytest.raises(CredentialValidationError):
            validate_base_url(value)


def test_unknown_capability_rejected():
    with pytest.raises(CredentialValidationError) as error:
        validate_manual_capabilities("tts,nope")
    assert error.value.code == "unknown_capability"


@pytest.mark.parametrize("key", ["short", "has space in key 123456", "x" * 300])
def test_api_key_validation(key):
    with pytest.raises(CredentialValidationError):
        validate_patch(get_spec("skillrouter"), {"api_key": key})


def test_api_key_prefix_not_enforced():
    assert validate_patch(get_spec("skillrouter"), {"api_key": "no-prefix-key-12345"})


# -------------------------------------------------------------------- the API


def test_status_and_update_round_trip_is_zero_secret(client, caplog):
    caplog.set_level(logging.DEBUG)
    put = client.put("/api/skillrouter", headers=ORIGIN, json={
        "mode": "router", "apiKey": KEY, "baseUrl": "http://localhost:3999"})
    assert put.status_code == 200, put.text
    data = put.json()["data"]
    assert data["mode"] == "router" and data["keyConfigured"] is True
    assert data["keyHint"].endswith("6789") and KEY not in put.text
    assert KEY not in client.get("/api/skillrouter").text
    assert KEY not in caplog.text


def test_put_router_without_key_is_422(client):
    response = client.put("/api/skillrouter", headers=ORIGIN, json={"mode": "router"})
    assert response.status_code == 422
    assert response.json()["error_code"] == "router_key_required"


def test_put_rejects_cross_origin(client):
    response = client.put("/api/skillrouter", headers={"Origin": "https://evil.example",
                          "Content-Type": "application/json"}, json={"mode": "manual"})
    assert response.status_code in (400, 403)


def test_delete_clears_key_and_keeps_other_fields(client):
    client.put("/api/skillrouter", headers=ORIGIN, json={
        "mode": "router", "apiKey": KEY, "baseUrl": "http://localhost:3999",
        "manualCapabilities": ["tts"]})
    data = client.delete("/api/skillrouter", headers=ORIGIN).json()["data"]
    assert data["mode"] == "manual" and data["keyConfigured"] is False
    assert data["baseUrl"] == "http://localhost:3999"
    assert data["manualCapabilities"] == ["tts"]


def test_generic_integrations_api_hides_skillrouter(client):
    listing = client.get("/api/integrations").json()["data"]["integrations"]
    assert "skillrouter" not in {item["id"] for item in listing}
    assert client.put("/api/integrations/skillrouter", headers=ORIGIN,
                      json={"fields": {"mode": "manual"}}).status_code == 404
    assert client.delete("/api/integrations/skillrouter", headers=ORIGIN).status_code == 404
    assert client.post("/api/integrations/skillrouter/test", headers=ORIGIN).status_code == 404


def test_registry_fixture_excludes_internal_integration():
    ids = [item["id"] for item in serialize_registry([])["integrations"]]
    assert "skillrouter" not in ids


# ------------------------------------------------------------------ the gate


@pytest.mark.asyncio
async def test_gate_routed_capability_checks_router_key_not_manual_key(store):
    await store.save("skillrouter", {"mode": "router", "api_key": KEY})
    require_configured("ark_image")  # routed: no manual key needed
    require_configured("pexels")


@pytest.mark.asyncio
async def test_gate_manual_override_reports_original_integration(store):
    await store.save("skillrouter", {
        "mode": "router", "api_key": KEY, "manual_capabilities": "video_library"})
    with pytest.raises(CredentialNotConfigured) as error:
        require_configured("pexels")
    assert error.value.integration_id == "pexels"


@pytest.mark.asyncio
async def test_gate_asr_and_clone_always_manual(store):
    await store.save("skillrouter", {"mode": "router", "api_key": KEY})
    for integration in ("volcano_asr", "volcano_voice_clone"):
        with pytest.raises(CredentialNotConfigured) as error:
            require_configured(integration)
        assert error.value.integration_id == integration


@pytest.mark.asyncio
async def test_gate_manual_mode_unchanged(store):
    with pytest.raises(CredentialNotConfigured) as error:
        require_configured("ark_image")
    assert error.value.integration_id == "ark_image"


# --------------------------------------------------- gateway-backed behaviours


@pytest.mark.asyncio
async def test_verify_ok_and_invalid_and_unreachable(fake_gateway, gw_client):
    ok = gw_client.post("/api/skillrouter/verify", headers=ORIGIN, json={})
    assert ok.status_code == 200 and ok.json()["data"]["outcome"] == "ok"
    assert len(ok.json()["data"]["capabilities"]) == 6
    settings_service.reset()
    bad = gw_client.post("/api/skillrouter/verify", headers=ORIGIN,
                      json={"apiKey": "ar-wrong-key-0000000"})
    assert bad.json()["data"]["outcome"] == "invalid_credentials"
    # a submitted key is verified but never stored
    assert get_snapshot().api_key == fake_gateway.api_key
    settings_service.reset()
    down = gw_client.post("/api/skillrouter/verify", headers=ORIGIN, json={
        "apiKey": KEY, "baseUrl": "http://127.0.0.1:9"})
    assert down.json()["data"]["outcome"] == "unreachable"


@pytest.mark.asyncio
async def test_verify_is_throttled(fake_gateway, gw_client):
    gw_client.post("/api/skillrouter/verify", headers=ORIGIN, json={})
    again = gw_client.post("/api/skillrouter/verify", headers=ORIGIN, json={})
    assert again.status_code == 429 and again.json()["error_code"] == "router_busy"


@pytest.mark.asyncio
async def test_catalog_normalises_models_and_picks_defaults(fake_gateway, gw_client):
    data = gw_client.get("/api/skillrouter/catalog?refresh=1").json()["data"]
    by_id = {m["id"]: m for m in data["models"]}
    assert by_id["claude-sonnet-4"]["protocol"] == "anthropic"
    assert by_id["ecliptrix-chat"]["isRoute"] is True
    assert data["defaults"]["chat"] == "ecliptrix-chat"  # operator convention wins
    # R2-08: additive millisecond twin of the legacy seconds field
    assert data["fetchedAtMs"] == int(data["fetchedAt"] * 1000)
    assert data["defaults"]["fast"] == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_entering_router_mode_prefills_slot_models(fake_gateway, gw_client):
    gw_client.put("/api/skillrouter", headers=ORIGIN, json={"mode": "manual"})
    data = gw_client.put("/api/skillrouter", headers=ORIGIN, json={"mode": "router"}).json()["data"]
    assert data["slotModels"]["chat"] == "ecliptrix-chat"
    assert set(data["slotModels"]) == {"chat", "fast", "video_cut", "vision", "research"}


@pytest.mark.asyncio
async def test_catalog_failure_keeps_stale_and_never_raises(fake_gateway):
    await catalog.get_models(force=True)
    fake_gateway.fail("GET", "/api/v1/models", 503, "upstream_unavailable")
    result = await catalog.get_models(force=True)
    assert result.stale is True and result.data  # previous value retained
    assert result.error == "upstream_unavailable"
