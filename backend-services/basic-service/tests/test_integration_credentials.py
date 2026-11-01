"""Credential store + resolver + HTTP API (setup-wizard-full-capability-coverage
§3.2, §3.5, §5, §7.2): resolution priority, validation matrix, persistence,
zero-secret contract and the Origin gate.

The developer's real ``.env`` never leaks in: ``conftest`` neutralises the
registry's settings/env sources before every test and ``integration_db`` binds
an in-memory database.
"""

from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models.db_models import IntegrationCredential, SettingsAuditLog
from app.routers.integrations_router import router as integrations_router
from app.services import integration_credentials_service as service_module
from app.services.credential_errors import (
    NOT_CONFIGURED_STATUS,
    CredentialNotConfigured,
    require_configured,
)
from app.services.integration_credentials_service import (
    CredentialValidationError,
    IntegrationSaveFailed,
    validate_patch,
)
from app.services.integration_credentials_service import (
    integration_credentials as creds,
)
from app.services.integration_registry import get_spec

CANARY = "CANARY-secret-value-9f3a1c77"
CANARY2 = "CANARY-second-key-5b8e2d10"
ORIGIN = {"Origin": "http://localhost:3000"}
# validate_ui_origin(write=True) also demands JSON content type on bodiless DELETE.
JSON_ORIGIN = {**ORIGIN, "Content-Type": "application/json"}


@pytest_asyncio.fixture
async def store(integration_db):
    creds.reset()
    return creds


@pytest.fixture
def client(store):
    from app.main import credential_not_configured_handler

    app = FastAPI()
    app.include_router(integrations_router, prefix="/api")
    app.add_exception_handler(
        CredentialNotConfigured, credential_not_configured_handler
    )
    return TestClient(app)


def _use_settings(monkeypatch, **attrs):
    from app import config as config_module

    for name, value in attrs.items():
        monkeypatch.setattr(config_module.settings, name, value)


# ---------------------------------------------------------------- resolution


@pytest.mark.asyncio
async def test_database_value_beats_environment_beats_default(store, monkeypatch):
    _use_settings(monkeypatch, volcano_tts_api_key="env-key-aaaaaaaa")
    assert store.value("volcano_tts", "api_key") == "env-key-aaaaaaaa"
    assert store.resolve("volcano_tts").source == "environment"

    await store.save("volcano_tts", {"api_key": "db-key-bbbbbbbb"})

    assert store.value("volcano_tts", "api_key") == "db-key-bbbbbbbb"
    assert store.resolve("volcano_tts").source == "database"


@pytest.mark.asyncio
async def test_placeholder_env_values_fall_through_every_layer(store, monkeypatch):
    _use_settings(
        monkeypatch,
        volcano_tts_api_key="your_volcano_tts_api_key",
        ark_api_key="your_ark_api_key_here",
        pexels_api_keys=["your_pexels_api_key_here"],
    )

    assert store.value("volcano_tts", "api_key") == ""
    assert not store.is_usable("volcano_tts")
    assert not store.is_usable("ark")
    assert store.values("pexels", "api_keys") == []


@pytest.mark.asyncio
async def test_choice_default_is_not_counted_as_user_filled(store):
    resolved = store.resolve("volcano_asr")
    resource = resolved.field("resource_id")

    assert resource.source == "default"
    assert resource.value == "volc.bigasr.sauc.duration"
    assert resolved.filled_required == 0
    assert not resolved.usable


@pytest.mark.asyncio
async def test_asr_environment_baseline_keeps_the_legacy_tts_fallback(
    store, monkeypatch
):
    # config.py already folds VOLCANO_TTS_APPID/ACCESS_TOKEN into the ASR
    # settings fields; the resolver must honour that environment layer.
    _use_settings(
        monkeypatch,
        volcano_asr_appid="1234567890",
        volcano_asr_access_token="legacy-token-1234",
    )
    assert store.is_usable("volcano_asr")
    assert store.resolve("volcano_asr").source == "environment"


@pytest.mark.asyncio
async def test_app_storage_layer_has_no_cross_integration_fallback(store):
    await store.save("volcano_tts", {"api_key": "tts-key-12345678"})

    assert not store.is_usable("volcano_asr")
    assert not store.is_usable("volcano_voice_clone")


@pytest.mark.asyncio
async def test_baseline_reader_tolerates_stub_settings_without_attributes(
    store, monkeypatch
):
    from app import config as config_module

    monkeypatch.setattr(config_module, "settings", SimpleNamespace())

    assert store.value("ark", "api_key") == ""
    assert store.values("pexels", "api_keys") == []


@pytest.mark.asyncio
async def test_unsplash_and_freesound_read_the_process_environment(
    store, monkeypatch
):
    monkeypatch.setenv("UNSPLASH_ACCESS_KEYS", "key-one-11111111, key-two-22222222")
    monkeypatch.setenv("FREESOUND_API_KEY", "freesound-key-1234")

    assert store.values("unsplash", "access_keys") == [
        "key-one-11111111",
        "key-two-22222222",
    ]
    assert store.value("freesound", "api_key") == "freesound-key-1234"


# ---------------------------------------------------------------- validation


def _expect_rejected(integration_id, patch, code, field):
    with pytest.raises(CredentialValidationError) as raised:
        validate_patch(get_spec(integration_id), patch)
    assert (raised.value.code, raised.value.field_name) == (code, field)


SIX_TOO_MANY = [f"key-number-{index:04d}" for index in range(6)]


@pytest.mark.parametrize(
    "integration_id, patch, code, field",
    [
        ("ark", {"api_key": "your_ark_api_key_here"}, "credential_placeholder", "api_key"),
        (
            "volcano_tts",
            {"api_key": "your_volcano_tts_api_key"},
            "credential_placeholder",
            "api_key",
        ),
        ("ark", {"api_key": "short"}, "credential_malformed", "api_key"),
        ("ark", {"api_key": "has a space inside key"}, "credential_malformed", "api_key"),
        ("ark", {"api_key": "line\nbreak-key-123456"}, "credential_malformed", "api_key"),
        ("ark", {"api_key": "k" * 513}, "credential_malformed", "api_key"),
        ("ark", {"api_key": 12345678}, "credential_malformed", "api_key"),
        ("ark", {"nope": "value"}, "unknown_field", "nope"),
        ("volcano_asr", {"appid": "bad appid!"}, "credential_malformed", "appid"),
        ("volcano_asr", {"appid": "your_appid_here"}, "credential_placeholder", "appid"),
        ("volcano_tts", {"resource_id": "seed-tts-9.9"}, "invalid_choice", "resource_id"),
        ("pexels", {"api_keys": SIX_TOO_MANY}, "too_many_values", "api_keys"),
    ],
)
def test_validation_matrix_rejects_with_a_stable_code(
    integration_id, patch, code, field
):
    _expect_rejected(integration_id, patch, code, field)


def test_validation_never_echoes_the_rejected_value():
    with pytest.raises(CredentialValidationError) as raised:
        validate_patch(get_spec("ark"), {"api_key": CANARY + " x"})
    assert CANARY not in str(raised.value)


def test_validation_trims_dedupes_and_marks_clears():
    cleaned = validate_patch(
        get_spec("pexels"), {"api_keys": [" key-aaaa-1111 ", "key-aaaa-1111", ""]}
    )
    assert cleaned == {"api_keys": ["key-aaaa-1111"]}
    assert validate_patch(get_spec("ark"), {"api_key": ""}) == {"api_key": None}
    assert validate_patch(get_spec("pexels"), {"api_keys": []}) == {"api_keys": None}


def test_a_comma_separated_string_is_accepted_for_list_fields():
    cleaned = validate_patch(
        get_spec("unsplash"), {"access_keys": "key-aaaa-1111, key-bbbb-2222"}
    )
    assert cleaned == {"access_keys": ["key-aaaa-1111", "key-bbbb-2222"]}


# ----------------------------------------------------------- patch semantics


@pytest.mark.asyncio
async def test_patch_omitted_unchanged_empty_clears_and_last_clear_deletes_row(
    store, integration_db
):
    await store.save(
        "volcano_asr", {"appid": "1234567890", "access_token": "token-aaaaaaaa"}
    )
    await store.save("volcano_asr", {"resource_id": "volc.bigasr.sauc.concurrent"})
    resolved = store.resolve("volcano_asr")
    assert resolved.field("appid").value == "1234567890"
    assert resolved.field("resource_id").value == "volc.bigasr.sauc.concurrent"

    await store.save("volcano_asr", {"access_token": ""})
    assert store.resolve("volcano_asr").filled_required == 1
    assert store.resolve("volcano_asr").usable is False

    await store.save("volcano_asr", {"appid": None, "resource_id": ""})
    async with integration_db() as session:
        rows = (await session.execute(select(IntegrationCredential))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_clear_falls_back_to_the_environment(store, monkeypatch):
    _use_settings(monkeypatch, ark_api_key="env-ark-key-1234")
    await store.save("ark", {"api_key": "db-ark-key-12345"})
    assert store.value("ark", "api_key") == "db-ark-key-12345"

    await store.clear("ark")

    assert store.value("ark", "api_key") == "env-ark-key-1234"
    assert store.resolve("ark").source == "environment"


@pytest.mark.asyncio
async def test_saved_values_survive_a_restart_via_load_all(store):
    await store.save("pexels", {"api_keys": ["key-aaaa-1111", "key-bbbb-2222"]})
    store.reset()
    assert store.values("pexels", "api_keys") == []

    await store.load_all()

    assert store.values("pexels", "api_keys") == ["key-aaaa-1111", "key-bbbb-2222"]
    assert store.load_failed is False


@pytest.mark.asyncio
async def test_load_failure_sets_the_flag_instead_of_raising(store, monkeypatch):
    def broken():
        raise RuntimeError(f"db down {CANARY}")

    monkeypatch.setattr(service_module, "async_session_factory", broken)

    await store.load_all()

    assert store.load_failed is True


@pytest.mark.asyncio
async def test_failed_write_leaves_the_cache_unchanged_and_hides_the_error(
    store, monkeypatch, caplog
):
    await store.save("ark", {"api_key": "first-ark-key-111"})

    def broken():
        raise RuntimeError(f"disk full {CANARY}")

    monkeypatch.setattr(service_module, "async_session_factory", broken)
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(IntegrationSaveFailed):
            await store.save("ark", {"api_key": CANARY})

    assert store.value("ark", "api_key") == "first-ark-key-111"
    assert CANARY not in caplog.text


@pytest.mark.asyncio
async def test_concurrent_saves_never_produce_a_half_entry(store):
    await asyncio.gather(
        store.save(
            "volcano_asr", {"appid": "1111111111", "access_token": "token-first-111"}
        ),
        store.save(
            "volcano_asr", {"appid": "2222222222", "access_token": "token-second-22"}
        ),
    )

    resolved = store.resolve("volcano_asr")
    assert resolved.usable
    assert resolved.field("appid").value in {"1111111111", "2222222222"}
    assert resolved.field("access_token").value in {"token-first-111", "token-second-22"}


@pytest.mark.asyncio
async def test_audit_rows_record_the_action_but_never_the_value(store, integration_db):
    await store.save("ark", {"api_key": CANARY})
    await store.save("ark", {"api_key": CANARY2})
    await store.clear("ark")

    async with integration_db() as session:
        rows = (await session.execute(select(SettingsAuditLog))).scalars().all()
    assert sorted(row.action for row in rows) == ["create", "delete", "update"]
    assert {row.key for row in rows} == {"ark"}
    dump = " ".join(str(vars(row)) for row in rows)
    assert CANARY not in dump and CANARY2 not in dump


# ------------------------------------------------------------------ HTTP API


def test_get_lists_every_integration_without_secrets(client):
    body = client.get("/api/integrations").json()

    ids = [item["id"] for item in body["data"]["integrations"]]
    assert ids == [
        "volcano_tts", "volcano_asr", "volcano_voice_clone",
        "ark", "pexels", "unsplash", "freesound",
    ]
    assert body["data"]["load_failed"] is False
    asr = next(i for i in body["data"]["integrations"] if i["id"] == "volcano_asr")
    resource = next(f for f in asr["fields"] if f["name"] == "resource_id")
    assert resource["value"] == "volc.bigasr.sauc.duration"
    assert resource["source"] == "default"


def test_put_saves_and_the_response_never_contains_the_secret(client, caplog):
    with caplog.at_level(logging.DEBUG):
        response = client.put(
            "/api/integrations/volcano_asr",
            json={"fields": {"appid": "1234567890", "access_token": CANARY}},
            headers=ORIGIN,
        )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["usable"] is True and payload["source"] == "database"
    fields = {f["name"]: f for f in payload["fields"]}
    assert fields["appid"]["value"] == "1234567890"
    assert fields["access_token"].get("value") is None
    assert CANARY not in response.text and CANARY not in caplog.text
    assert CANARY not in client.get("/api/integrations").text


def test_put_reports_the_count_for_secret_lists_without_the_keys(client):
    response = client.put(
        "/api/integrations/pexels",
        json={"fields": {"api_keys": [CANARY, CANARY2]}},
        headers=ORIGIN,
    )

    field = response.json()["data"]["fields"][0]
    assert field["count"] == 2 and field["max_items"] == 5
    assert CANARY not in response.text and CANARY2 not in response.text


def test_put_validation_error_is_422_with_a_code_and_no_value(client):
    response = client.put(
        "/api/integrations/ark",
        json={"fields": {"api_key": "your_ark_api_key_here"}},
        headers=ORIGIN,
    )

    body = response.json()
    assert response.status_code == 422
    assert body["error_code"] == "credential_placeholder"
    assert body["error_details"] == {"field": "api_key"}
    assert "your_ark_api_key_here" not in response.text


def test_put_unknown_integration_is_404(client):
    response = client.put(
        "/api/integrations/nope", json={"fields": {}}, headers=ORIGIN
    )
    assert response.status_code == 404
    assert response.json()["error_code"] == "unknown_integration"


def test_writes_without_an_origin_are_forbidden(client):
    calls = (
        lambda: client.put(
            "/api/integrations/ark", json={"fields": {"api_key": CANARY}}
        ),
        lambda: client.delete("/api/integrations/ark"),
        lambda: client.post("/api/integrations/ark/test", json={}),
    )
    for call in calls:
        response = call()
        assert response.status_code == 403
        assert response.json()["error_code"] == "origin_forbidden"
    assert not creds.is_usable("ark")


def test_delete_without_a_json_content_type_is_rejected(client):
    response = client.delete("/api/integrations/ark", headers=ORIGIN)
    assert response.status_code == 415


def test_a_foreign_origin_is_forbidden(client):
    response = client.delete(
        "/api/integrations/ark", headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403


def test_delete_clears_and_returns_the_fallback_state(client):
    client.put(
        "/api/integrations/ark", json={"fields": {"api_key": CANARY}}, headers=ORIGIN
    )
    assert creds.is_usable("ark")

    response = client.delete("/api/integrations/ark", headers=JSON_ORIGIN)

    assert response.status_code == 200
    assert response.json()["data"]["usable"] is False
    assert not creds.is_usable("ark")


def test_test_endpoint_refuses_an_unconfigured_integration(client):
    response = client.post("/api/integrations/ark/test", json={}, headers=ORIGIN)

    assert response.status_code == NOT_CONFIGURED_STATUS
    body = response.json()
    assert body["error_code"] == "credential_not_configured"
    assert body["error_details"] == {"integration_id": "ark"}


# --------------------------------------------------------- not-configured API


def test_require_configured_raises_while_unconfigured(store):
    with pytest.raises(CredentialNotConfigured) as raised:
        require_configured("freesound")
    assert raised.value.integration_id == "freesound"


@pytest.mark.asyncio
async def test_require_configured_passes_once_saved(store):
    await store.save("freesound", {"api_key": "freesound-key-1234"})
    require_configured("freesound")
