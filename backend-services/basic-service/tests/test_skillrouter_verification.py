"""Persisted verification capsule + silent re-verification (spec R2-05, AC-20)."""

from __future__ import annotations

import json
import time

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.skillrouter_router import router as skillrouter_router
from app.services.integration_credentials_service import (
    CredentialValidationError, integration_credentials as creds, validate_patch,
)
from app.services.integration_registry import get_spec
from app.services.skillrouter import catalog, get_snapshot, is_routed, settings_service

HOUR_MS = 3_600_000


@pytest_asyncio.fixture
async def gateway(fake_gateway):
    settings_service.reset()
    yield fake_gateway
    settings_service.reset()


def entry_for(snapshot, *, ok=True, outcome="ok", age_ms=0):
    return {"ok": ok, "outcome": outcome, "revision": snapshot.credential_revision,
            "at": int(time.time() * 1000) - age_ms}


async def persist(entry):
    await creds.save("skillrouter", {"last_verified": json.dumps(entry)})


def _app():
    app = FastAPI()
    app.include_router(skillrouter_router, prefix="/api")
    return app


@pytest.mark.asyncio
async def test_verified_state_survives_a_restart(gateway):
    await catalog.get_capabilities(force=True)
    assert catalog.last_verified()["ok"] is True
    catalog.reset()  # a restart drops every in-memory cache
    verified = catalog.last_verified()
    assert verified and verified["ok"] is True and verified["stale"] is False


@pytest.mark.asyncio
async def test_a_different_key_or_base_url_inherits_nothing(gateway):
    await persist(entry_for(get_snapshot()))
    catalog.reset()
    assert catalog.last_verified() is not None
    await creds.save("skillrouter", {"api_key": "ar-another-key-0123456789"})
    assert catalog.last_verified() is None  # no write-path cleanup needed
    await creds.save("skillrouter", {"api_key": gateway.api_key})
    assert catalog.last_verified() is not None  # same key again: the record is valid again
    await creds.save("skillrouter", {"base_url": "http://localhost:1"})
    assert catalog.last_verified() is None


@pytest.mark.asyncio
async def test_a_record_for_another_revision_is_ignored(gateway):
    stale_owner = entry_for(get_snapshot())
    stale_owner["revision"] = "0" * 16
    await persist(stale_owner)
    catalog.reset()
    assert catalog.last_verified() is None


@pytest.mark.asyncio
async def test_mode_change_keeps_the_verification(gateway):
    await persist(entry_for(get_snapshot()))
    await creds.save("skillrouter", {"mode": "manual"})
    assert catalog.last_verified()["ok"] is True


@pytest.mark.asyncio
async def test_old_record_is_flagged_stale(gateway):
    await persist(entry_for(get_snapshot(), age_ms=25 * HOUR_MS))
    catalog.reset()
    assert catalog.last_verified()["stale"] is True


@pytest.mark.asyncio
async def test_last_verified_never_changes_readiness(gateway):
    before = (get_snapshot().revision, is_routed("tts"), is_routed("chat"))
    await persist(entry_for(get_snapshot(), ok=False, outcome="invalid_credentials"))
    assert (get_snapshot().revision, is_routed("tts"), is_routed("chat")) == before
    from app.services.skillrouter.status import routed_item
    item = await routed_item("chat", "core")
    assert item is not None and item.state == "ready"  # an old failure is not consulted


@pytest.mark.asyncio
async def test_clearing_the_key_drops_the_record(gateway):
    await persist(entry_for(get_snapshot()))
    await settings_service.clear_key()
    assert catalog.last_verified() is None
    assert get_snapshot().last_verified_raw == ""  # the stored value is gone too


@pytest.mark.asyncio
async def test_unchanged_outcome_is_not_rewritten_every_refresh(gateway, monkeypatch):
    writes = []
    original = creds.save

    async def counting_save(integration_id, patch):
        writes.append(patch)
        return await original(integration_id, patch)

    monkeypatch.setattr(creds, "save", counting_save)
    for _ in range(3):
        await catalog.get_capabilities(force=True)
    assert len(writes) == 1


@pytest.mark.parametrize("raw", [
    "not json", "[]", json.dumps({"ok": True}),
    json.dumps({"ok": "yes", "outcome": "ok", "at": 1, "revision": "ab" * 8}),
    json.dumps({"ok": True, "outcome": "bogus", "at": 1, "revision": "ab" * 8}),
    json.dumps({"ok": True, "outcome": "ok", "at": 0, "revision": "ab" * 8}),
    json.dumps({"ok": True, "outcome": "ok", "at": 1, "revision": "NOT-HEX!"}),
])
def test_last_verified_field_rejects_malformed_values(raw):
    with pytest.raises(CredentialValidationError):
        validate_patch(get_spec("skillrouter"), {"last_verified": raw})


def test_last_verified_field_drops_unknown_keys():
    cleaned = validate_patch(get_spec("skillrouter"), {"last_verified": json.dumps({
        "ok": True, "outcome": "ok", "at": 5, "revision": "ab" * 8, "apiKey": "ar-leak"})})
    assert "ar-leak" not in cleaned["last_verified"]


# ---------------------------------------------------- silent re-verification


@pytest.mark.asyncio
async def test_router_mode_without_a_record_revalidates_in_background(gateway):
    catalog.reset()
    assert settings_service.schedule_revalidation() is True
    assert settings_service.schedule_revalidation() is False  # single flight
    await settings_service._revalidate_task
    assert gateway.count("GET", "/api/v1/capabilities") == 1
    assert catalog.last_verified()["ok"] is True
    assert settings_service.schedule_revalidation() is False  # fresh now


@pytest.mark.asyncio
async def test_a_stale_record_triggers_revalidation(gateway):
    await persist(entry_for(get_snapshot(), age_ms=25 * HOUR_MS))
    catalog.reset()
    assert settings_service.schedule_revalidation() is True
    await settings_service._revalidate_task
    assert catalog.last_verified()["stale"] is False


@pytest.mark.asyncio
async def test_manual_mode_sends_the_gateway_zero_requests(gateway):
    await creds.save("skillrouter", {"mode": "manual"})
    catalog.reset()
    assert settings_service.schedule_revalidation() is False
    assert TestClient(_app()).get("/api/skillrouter").status_code == 200
    assert gateway.requests == []


@pytest.mark.asyncio
async def test_no_key_sends_zero_requests(gateway):
    await settings_service.clear_key()
    assert settings_service.schedule_revalidation() is False
    assert gateway.requests == []


@pytest.mark.asyncio
async def test_kill_switch_sends_zero_requests(gateway, monkeypatch):
    monkeypatch.setenv("SKILLROUTER_ENABLED", "0")
    catalog.reset()
    assert settings_service.schedule_revalidation() is False
    assert gateway.requests == []


@pytest.mark.asyncio
async def test_failed_revalidation_backs_off_exponentially(gateway):
    gateway.fail("GET", "/api/v1/capabilities", 503, "upstream_unavailable")
    catalog.reset()
    assert settings_service.schedule_revalidation() is True
    await settings_service._revalidate_task
    assert settings_service._revalidate_failures == 1
    first_wait = settings_service._revalidate_not_before - time.monotonic()
    assert 0 < first_wait <= settings_service.REVALIDATE_BASE_DELAY_SECONDS
    assert settings_service.schedule_revalidation() is False  # inside the backoff window
    settings_service._revalidate_not_before = 0.0
    assert settings_service.schedule_revalidation() is True
    await settings_service._revalidate_task
    assert settings_service._revalidate_failures == 2
    assert catalog.last_verified() is None  # a failed probe never invents "connected"


@pytest.mark.asyncio
async def test_status_response_exposes_the_capsule_and_no_secret(gateway):
    await persist(entry_for(get_snapshot()))
    catalog.reset()
    body = TestClient(_app()).get("/api/skillrouter").text
    assert gateway.api_key not in body
    verified = json.loads(body)["data"]["lastVerified"]
    assert verified["ok"] is True and verified["stale"] is False
    assert "revision" not in verified
