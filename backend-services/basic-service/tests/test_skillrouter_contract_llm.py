"""LLM contract with the gateway (spec §3.4, §4.1, §4.2), against the real fake.

The backend ``llm_client`` is exercised for real: the assertions are about the
FINAL URL and auth headers the fake gateway actually received, which is what the
resolve contract (``api_url`` + ``api_type``) promises. The frontend twin of this
contract lives in vitest.
"""
import json
import os
import re
import subprocess
import sys
from types import SimpleNamespace

import pytest

from app.models.model_settings_models import ModelFunctionType
from app.services import model_settings_service as model_settings_module
from app.services.integration_credentials_service import integration_credentials
from app.services.llm_call_config import (
    LLMNotConfiguredError, resolve_llm_call_config, resolve_vision_target,
)
from app.services.llm_client import call_chat, normalize_api_type, stream_chat
from app.services.llm_client import LLMCallConfig
from app.services.skillrouter.errors import RouterError

SLOTS = {
    "chat": ("gpt-4o-mini", "openai"),
    "fast": ("claude-haiku-x", "anthropic"),
    "video_cut": ("claude-sonnet-4", "anthropic"),
    "vision": ("gpt-4o", "openai"),
    "research": ("ecliptrix-research", "openai"),
}
MESSAGES = [{"role": "system", "content": "s"}, {"role": "user", "content": "ping"}]


async def save_slots(slots=SLOTS):
    await integration_credentials.save("skillrouter", {
        **{f"model_{slot}": model for slot, (model, _) in slots.items()},
        "slot_protocols": json.dumps({slot: proto for slot, (_, proto) in slots.items()}),
    })


@pytest.fixture(autouse=True)
def _unreachable_system_proxy(monkeypatch):
    """A dead system proxy: the loopback fake gateway only answers when ``llm_client``
    itself opts out of ``trust_env`` (R2-03). httpx reads the environment when the
    client is constructed, so this must be set before any call."""
    for name in ("NO_PROXY", "no_proxy"):
        monkeypatch.delenv(name, raising=False)
    for name in ("HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.setenv(name, "http://127.0.0.1:9")


def env_settings(**overrides):
    values = {
        "llm_api_url": "https://env.test/v1", "llm_api_key": "sk-env", "llm_model": "env-model",
        "llm_api_type": "openai",
        "fast_llm_api_url": "", "fast_llm_api_key": "", "fast_llm_model": "", "fast_llm_api_type": "openai",
        "video_cut_llm_api_url": "", "video_cut_llm_api_key": "", "video_cut_llm_model": "",
        "video_cut_llm_api_type": "openai",
        "vl_llm_api_url": "https://vl.test/v1", "vl_llm_api_key": "sk-vl", "vl_llm_model": "vl-env",
        "vl_llm_api_type": "openai",
        "research_llm_api_url": "", "research_llm_api_key": "", "research_llm_model": "",
        "research_llm_api_type": "openai",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.fixture
def env_fallback(monkeypatch, integration_db):
    """Empty assignment table + stub env settings (no developer .env leaks in)."""
    monkeypatch.setattr(model_settings_module, "async_session_factory", integration_db)
    monkeypatch.setattr(model_settings_module, "get_settings", lambda: env_settings())


# --- final URL + auth header actually sent -----------------------------------

@pytest.mark.asyncio
async def test_openai_model_hits_chat_completions_with_bearer(fake_gateway):
    await save_slots()
    config = await model_settings_module.model_settings_service.get_effective_config(
        ModelFunctionType.CHAT)
    assert config.api_url == f"{fake_gateway.base_url}/api/v1" and config.api_type == "openai"
    reply = await call_chat(MESSAGES, config=LLMCallConfig(
        api_url=config.api_url, api_key=config.api_key, model=config.model_name,
        api_type=normalize_api_type(config.api_type)))
    assert reply == "pong"
    request = fake_gateway.last("POST", "/api/v1/chat/completions")
    assert request["headers"]["authorization"] == f"Bearer {fake_gateway.api_key}"
    assert json.loads(request["body"])["model"] == "gpt-4o-mini"
    assert fake_gateway.count("POST", "/api/v1/messages") == 0


@pytest.mark.asyncio
async def test_anthropic_model_hits_messages_with_x_api_key(fake_gateway):
    await save_slots()
    config = await model_settings_module.model_settings_service.get_effective_config(
        ModelFunctionType.VIDEO_CUT)
    assert config.api_url == f"{fake_gateway.base_url}/api" and config.api_type == "anthropic"
    reply = await call_chat(MESSAGES, config=LLMCallConfig(
        api_url=config.api_url, api_key=config.api_key, model=config.model_name,
        api_type=normalize_api_type(config.api_type)))
    assert reply == "pong"
    request = fake_gateway.last("POST", "/api/v1/messages")
    assert request["headers"]["x-api-key"] == fake_gateway.api_key
    body = json.loads(request["body"])
    assert body["model"] == "claude-sonnet-4" and body["system"] == "s"
    assert fake_gateway.count("POST", "/api/v1/chat/completions") == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("slot", ["chat", "fast"])
async def test_streaming_uses_the_same_final_urls(fake_gateway, slot):
    await save_slots()
    config = await model_settings_module.model_settings_service.get_effective_config(
        ModelFunctionType(slot))
    chunks = [c async for c in stream_chat(
        MESSAGES, config=LLMCallConfig(
            api_url=config.api_url, api_key=config.api_key, model=config.model_name,
            api_type=normalize_api_type(config.api_type)),
        temperature=0.2, max_tokens=50, timeout=10.0)]
    assert isinstance(chunks, list)
    path = "/api/v1/chat/completions" if slot == "chat" else "/api/v1/messages"
    assert fake_gateway.count("POST", path) == 1


@pytest.mark.asyncio
async def test_services_resolve_through_llm_call_config_to_the_gateway(fake_gateway):
    """Services (chat, scripts, storyboard, export) get the gateway without env."""
    await save_slots()
    for function_type, path in ((ModelFunctionType.CHAT, "/api/v1/chat/completions"),
                                (ModelFunctionType.VIDEO_CUT, "/api/v1/messages")):
        config = await resolve_llm_call_config(function_type)
        assert (await call_chat(MESSAGES, config=config)) == "pong"
        assert fake_gateway.count("POST", path) >= 1


# --- resolve contract ----------------------------------------------------------

@pytest.mark.asyncio
async def test_resolve_contract_for_every_slot(fake_gateway):
    await save_slots()
    service = model_settings_module.model_settings_service
    for slot, (model, protocol) in SLOTS.items():
        config = await service.get_effective_config(ModelFunctionType(slot))
        suffix = "/api" if protocol == "anthropic" else "/api/v1"
        assert (config.source, config.model_name, config.api_type, config.api_key) == (
            "skillrouter", model, protocol, fake_gateway.api_key), slot
        assert config.api_url == fake_gateway.base_url + suffix, slot
    coding = await service.get_effective_config(ModelFunctionType.CODING)
    assert coding.model_name == "gpt-4o-mini" and coding.source == "skillrouter"  # folds into chat


@pytest.mark.asyncio
async def test_resolve_never_touches_the_network_for_saved_slots(fake_gateway):
    """RV-02: a gateway outage cannot break conversation for a configured user."""
    await save_slots()
    for slot in SLOTS:
        await model_settings_module.model_settings_service.get_effective_config(
            ModelFunctionType(slot))
    assert fake_gateway.requests == []


@pytest.mark.asyncio
async def test_staged_vision_resolution_hits_the_overlay(fake_gateway):
    await save_slots()
    vision = await resolve_vision_target()
    assert vision is not None and vision.source == "skillrouter" and vision.model_name == "gpt-4o"
    assert fake_gateway.requests == []


@pytest.mark.asyncio
async def test_unsaved_slot_uses_the_operator_convention_model(fake_gateway):
    config = await model_settings_module.model_settings_service.get_effective_config(
        ModelFunctionType.CHAT)
    assert config.model_name == "ecliptrix-chat" and config.api_type == "openai"
    assert fake_gateway.count("GET", "/api/v1/models") == 1


@pytest.mark.asyncio
async def test_unsaved_slot_with_empty_catalogue_is_a_clear_error(fake_gateway):
    fake_gateway.models.clear()
    with pytest.raises(RouterError) as error:
        await model_settings_module.model_settings_service.get_effective_config(
            ModelFunctionType.CHAT)
    assert error.value.code == "models_unavailable" and error.value.error_code == "router_models_unavailable"


@pytest.mark.asyncio
async def test_manual_override_of_one_slot_falls_back_to_that_slots_manual_path(
        fake_gateway, env_fallback):
    await save_slots()
    await integration_credentials.save("skillrouter", {"manual_capabilities": "vision"})
    service = model_settings_module.model_settings_service
    vision = await service.get_effective_config(ModelFunctionType.VISION)
    assert (vision.source, vision.api_url, vision.model_name) == (
        "environment", "https://vl.test/v1", "vl-env")
    chat = await service.get_effective_config(ModelFunctionType.CHAT)
    assert chat.source == "skillrouter"


@pytest.mark.asyncio
async def test_resolve_endpoint_is_never_cached(fake_gateway):
    from fastapi.testclient import TestClient
    from app.main import app
    await save_slots()
    response = TestClient(app).get("/api/model-settings/resolve/chat")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["source"] == "skillrouter"


# --- manual mode: unchanged behaviour, gateway never touched ------------------

@pytest.mark.asyncio
async def test_manual_mode_resolves_from_env_without_touching_the_gateway(
        fake_gateway_manual, env_fallback):
    service = model_settings_module.model_settings_service
    chat = await service.get_effective_config(ModelFunctionType.CHAT)
    assert (chat.source, chat.api_url, chat.api_key, chat.model_name) == (
        "environment", "https://env.test/v1", "sk-env", "env-model")
    video_cut = await service.get_effective_config(ModelFunctionType.VIDEO_CUT)
    assert (video_cut.source, video_cut.api_url) == ("environment", "https://env.test/v1")
    vision = await resolve_vision_target()
    assert vision is not None and vision.source == "environment" and vision.model_name == "vl-env"
    assert fake_gateway_manual.requests == []


@pytest.mark.asyncio
async def test_manual_mode_database_assignment_wins_over_env(
        fake_gateway_manual, env_fallback, integration_db):
    from app.models.db_models import ModelAssignment, ModelProvider
    async with integration_db() as session:
        provider = ModelProvider(name="P", provider_type="openai", api_url="https://db.test/v1",
                                 api_key="sk-db", api_format="openai")
        session.add(provider)
        await session.flush()
        session.add(ModelAssignment(function_type="chat", provider_id=provider.id,
                                    model_name="db-model", temperature=0.5, max_tokens=100))
        await session.commit()
    config = await resolve_llm_call_config(ModelFunctionType.CHAT)
    assert (config.api_url, config.api_key, config.model) == (
        "https://db.test/v1", "sk-db", "db-model")
    assert fake_gateway_manual.requests == []


@pytest.mark.asyncio
async def test_unconfigured_manual_slot_raises_not_configured(
        fake_gateway_manual, monkeypatch, integration_db):
    monkeypatch.setattr(model_settings_module, "async_session_factory", integration_db)
    monkeypatch.setattr(model_settings_module, "get_settings", lambda: env_settings(
        llm_api_url="", llm_api_key=""))
    with pytest.raises(LLMNotConfiguredError):
        await resolve_llm_call_config(ModelFunctionType.CHAT)
    assert isinstance(LLMNotConfiguredError("x"), ValueError)


@pytest.mark.asyncio
async def test_config_changes_apply_on_the_next_call_not_at_construction(
        fake_gateway, env_fallback):
    """Resolution is per call: switching mode between two calls is visible at once."""
    await save_slots()
    routed = await resolve_llm_call_config(ModelFunctionType.CHAT)
    assert routed.api_url.startswith(fake_gateway.base_url)
    await integration_credentials.save("skillrouter", {"mode": "manual"})
    manual = await resolve_llm_call_config(ModelFunctionType.CHAT)
    assert manual.api_url == "https://env.test/v1"


# --- startup with no LLM_* environment (spec §4.1 last bullet) -----------------

_STARTUP_PROBE = r'''
import os, sys, json
sys.path.insert(0, os.environ["BACKEND_ROOT"])
import dotenv
dotenv.load_dotenv = lambda *a, **k: False  # a developer's real .env must not leak in
from fastapi.testclient import TestClient
import app.main as main
assert main.settings.llm_api_key == "" and main.settings.llm_api_url == ""
headers = {"Origin": "http://localhost:3000", "Content-Type": "application/json"}
with TestClient(main.app) as client:
    out = {"health": client.get("/api/health").status_code}
    out["before"] = client.get("/api/skillrouter").json()["data"]["modeState"]
    put = client.put("/api/skillrouter", headers=headers, json={
        "mode": "router", "apiKey": "ar-startup-probe-0123456789",
        "slotModels": {"chat": "gpt-4o-mini"}, "slotProtocols": {"chat": "openai"}})
    out["put"] = put.status_code
    resolved = client.get("/api/model-settings/resolve/chat")
    out["resolve"] = [resolved.status_code, resolved.json().get("source"),
                      resolved.json().get("api_url")]
print("RESULT" + json.dumps(out))
'''


def test_app_boots_and_serves_router_llm_config_without_any_llm_env(tmp_path):
    """Real lifespan in a clean process: no LLM_* env, fresh database."""
    env = {k: v for k, v in os.environ.items() if not re.search(r"LLM|_API_KEY|_API_URL", k)}
    backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env.update(BACKEND_ROOT=backend_root, DATABASE_URL="sqlite+aiosqlite:///./boot.db")
    done = subprocess.run([sys.executable, "-c", _STARTUP_PROBE], env=env, cwd=tmp_path,
                          capture_output=True, text=True, timeout=240)
    assert done.returncode == 0, done.stderr[-2000:]
    line = next(l for l in done.stdout.splitlines() if l.startswith("RESULT"))
    out = json.loads(line[len("RESULT"):])
    assert out["health"] == 200 and out["before"] == "unset" and out["put"] == 200
    assert out["resolve"] == [200, "skillrouter", "https://www.skillrouter.net/api/v1"]
