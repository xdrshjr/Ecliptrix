"""
Tests for GET /api/config/capability-status (first-run-setup-wizard spec §3.1,
§5.1, §7.2): the state matrix per capability, the zero-secret contract and the
indeterminate fallbacks.

``get_settings`` is stubbed (the developer's real ``.env`` must not leak in)
and the DB is an in-memory SQLite bound into ``model_settings_service``.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.models.db_models import Base, ModelAssignment, ModelProvider
from app.routers.config_router import router as config_router
from app.services import model_settings_service as model_settings_module
from app.services import setup_status_service
from app.services.system_settings_service import system_settings_service
from app.services.web_research.web_search_service import WebSearchService

CHAT_KEY = "sk-secret-chat-key-123"
CHAT_URL = "https://api.deepseek.com/v1"


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
    finally:
        await engine.dispose()


def _settings(**overrides: Any) -> SimpleNamespace:
    values: Dict[str, Any] = {"tavily_api_keys": []}
    for prefix in (
        "llm", "fast_llm", "video_cut_llm", "vl_llm", "research_llm"
    ):
        values[prefix + "_api_url"] = ""
        values[prefix + "_api_key"] = ""
        values[prefix + "_model"] = ""
        values[prefix + "_api_type"] = "openai"
    values["vl_llm_model"] = "qwen-vl-plus"
    values.update(overrides)
    return SimpleNamespace(**values)


class Env:
    """Wires stubbed settings, DB factory and web-search storage."""

    def __init__(self, monkeypatch, factory):
        self.monkeypatch = monkeypatch
        self.factory = factory
        self.stored_tavily: Optional[List[Any]] = None
        self.use(_settings())
        monkeypatch.delenv("VL_LLM_MODEL", raising=False)
        monkeypatch.delenv("FAST_LLM_MODEL", raising=False)
        monkeypatch.setattr(
            model_settings_module, "async_session_factory", factory
        )
        monkeypatch.setattr(
            system_settings_service,
            "get",
            lambda category, key: self.stored_tavily,
        )

    def use(self, settings: SimpleNamespace) -> None:
        self.monkeypatch.setattr(
            model_settings_module, "get_settings", lambda: settings
        )
        self.monkeypatch.setattr(
            "app.services.web_research.web_search_service.get_settings",
            lambda: settings,
        )

    async def assign(self, function_type: str, model: str, key: str = CHAT_KEY):
        async with self.factory() as session:
            provider = ModelProvider(
                name=f"P-{function_type}",
                provider_type="deepseek",
                api_url=CHAT_URL,
                api_key=key,
                api_format="openai",
            )
            session.add(provider)
            await session.flush()
            session.add(
                ModelAssignment(
                    function_type=function_type,
                    provider_id=provider.id,
                    model_name=model,
                    temperature=0.7,
                    max_tokens=128000,
                )
            )
            await session.commit()


@pytest_asyncio.fixture
async def env(monkeypatch, session_factory):
    return Env(monkeypatch, session_factory)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(config_router, prefix="/api")
    return TestClient(app)


def _by_id(client: TestClient) -> Dict[str, Dict[str, Any]]:
    body = client.get("/api/config/capability-status").json()
    assert body["success"] is True
    return {item["id"]: item for item in body["data"]["capabilities"]}


def _states(client: TestClient) -> Dict[str, str]:
    return {key: item["state"] for key, item in _by_id(client).items()}


@pytest.mark.asyncio
async def test_clean_install_reports_every_capability_missing(env, client):
    body = client.get("/api/config/capability-status").json()

    assert set(_states(client).values()) == {"missing"}
    # 6 model/search slots (R1) + 8 credential-backed capabilities (R2).
    assert len(body["data"]["capabilities"]) == 14
    assert set(body["data"]["missing_core"]) == {
        "chat", "fast", "video_cut", "vision",
    }


@pytest.mark.asyncio
async def test_database_chat_only_leaves_fast_and_video_cut_missing(env, client):
    await env.assign("chat", "deepseek-chat")

    states = _states(client)

    assert states["chat"] == "ready"
    assert states["fast"] == "missing"
    assert states["video_cut"] == "missing"
    assert states["vision"] == "inherited"
    assert states["research"] == "inherited"


@pytest.mark.asyncio
async def test_vision_inherits_chat_on_clean_install_default_model(env, client):
    # RV-01: the shipped default vl model must not make vision "invalid".
    await env.assign("chat", "deepseek-chat")

    vision = _by_id(client)["vision"]

    assert vision["state"] == "inherited"
    assert vision["inherited_from"] == "chat"
    assert vision["model_name"] == "deepseek-chat"


@pytest.mark.asyncio
async def test_core_slots_ready_once_chat_fast_video_cut_assigned(env, client):
    for slot in ("chat", "fast", "video_cut"):
        await env.assign(slot, "deepseek-chat")

    body = client.get("/api/config/capability-status").json()

    assert body["data"]["missing_core"] == []
    items = _by_id(client)
    assert items["chat"]["source"] == "database"
    assert items["chat"]["provider_name"] == "DeepSeek"


@pytest.mark.asyncio
async def test_environment_llm_group_makes_fast_and_video_cut_ready(env, client):
    env.use(
        _settings(
            llm_api_url=CHAT_URL, llm_api_key=CHAT_KEY, llm_model="glm-4.6"
        )
    )

    items = _by_id(client)

    for slot in ("chat", "fast", "video_cut"):
        assert items[slot]["state"] == "ready"
        assert items[slot]["source"] == "environment"
    assert items["vision"]["state"] == "inherited"


@pytest.mark.asyncio
async def test_placeholder_key_counts_as_missing(env, client):
    env.use(
        _settings(
            llm_api_url=CHAT_URL,
            llm_api_key="your_llm_api_key_here",
            llm_model="glm-4.6",
        )
    )

    assert _states(client)["chat"] == "missing"


@pytest.mark.asyncio
async def test_vision_url_without_key_is_invalid(env, client):
    await env.assign("chat", "deepseek-chat")
    env.monkeypatch.setenv("VL_LLM_MODEL", "qwen-vl-max")
    env.use(
        _settings(vl_llm_api_url="https://vl.test/v1", vl_llm_model="qwen-vl-max")
    )

    body = client.get("/api/config/capability-status").json()

    assert _by_id(client)["vision"]["state"] == "invalid"
    assert "vision" in body["data"]["missing_core"]


@pytest.mark.asyncio
async def test_vision_own_assignment_is_ready(env, client):
    await env.assign("chat", "deepseek-chat")
    await env.assign("vision", "qwen-vl-max")

    vision = _by_id(client)["vision"]

    assert vision["state"] == "ready"
    assert vision["inherited_from"] is None


@pytest.mark.asyncio
async def test_web_search_user_cleared_list_wins_over_env(env, client):
    env.use(_settings(tavily_api_keys=["tvly-env-key"]))
    env.stored_tavily = []

    assert _states(client)["web_search"] == "missing"


@pytest.mark.asyncio
async def test_web_search_inherits_environment_when_unset(env, client):
    env.use(_settings(tavily_api_keys=["tvly-env-key"]))
    env.stored_tavily = None

    search = _by_id(client)["web_search"]

    assert search["state"] == "ready"
    assert search["source"] == "environment"


@pytest.mark.asyncio
async def test_web_search_database_key_is_ready(env, client):
    env.stored_tavily = ["tvly-db-key"]

    search = _by_id(client)["web_search"]

    assert search["state"] == "ready"
    assert search["source"] == "database"


@pytest.mark.asyncio
async def test_usable_keys_matches_the_set_search_would_use(env):
    env.stored_tavily = [" a ", "a", "", "b", "c", "d", 7]

    assert WebSearchService().usable_keys() == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_single_probe_failure_taints_only_that_row(env, client, monkeypatch):
    await env.assign("chat", "deepseek-chat")

    async def boom(*_args, **_kwargs):
        raise RuntimeError("resolver exploded")

    monkeypatch.setattr(
        model_settings_module.model_settings_service,
        "resolve_stage_origin",
        boom,
    )

    states = _states(client)

    assert states["vision"] == "indeterminate"
    assert states["research"] == "indeterminate"
    assert states["chat"] == "ready"


@pytest.mark.asyncio
async def test_total_failure_reports_success_false(env, client, monkeypatch):
    async def boom():
        raise RuntimeError("everything exploded")

    monkeypatch.setattr(
        "app.routers.config_router.compute_capability_status", boom
    )

    body = client.get("/api/config/capability-status").json()

    assert body["success"] is False
    assert body["data"]["capabilities"] == []


@pytest.mark.asyncio
async def test_response_never_contains_secrets(env, client):
    await env.assign("chat", "deepseek-chat")
    env.stored_tavily = ["tvly-super-secret"]

    raw = json.dumps(client.get("/api/config/capability-status").json())

    for secret in (CHAT_KEY, CHAT_URL, "tvly-super-secret", "api_key", "api_url"):
        assert secret not in raw


def test_placeholder_helper_rejects_blank_and_templates():
    assert not setup_status_service.is_usable_secret(None)
    assert not setup_status_service.is_usable_secret("  ")
    assert not setup_status_service.is_usable_secret("YOUR_X_HERE")
    assert setup_status_service.is_usable_secret("sk-real")


# ---------------------------------------------------------------------------
# Credential-backed capabilities (setup-wizard-full-capability-coverage §3.4)
# ---------------------------------------------------------------------------

INTEGRATION_CAPABILITIES = [
    "tts", "asr", "voice_clone", "ai_image", "ai_video",
    "video_library", "image_library", "audio_library",
]
CANARY = "CANARY-integration-secret-77aa"


def _use_app_settings(monkeypatch, **attrs):
    from app import config as config_module

    for name, value in attrs.items():
        monkeypatch.setattr(config_module.settings, name, value)


@pytest.mark.asyncio
async def test_integration_capabilities_are_extended_and_missing_on_clean_install(
    env, client, integration_db
):
    items = _by_id(client)

    for capability in INTEGRATION_CAPABILITIES:
        assert items[capability]["tier"] == "extended"
        assert items[capability]["state"] == "missing"
        assert items[capability]["source"] == "none"
    assert set(_by_id(client)["tts"]) <= {
        "id", "tier", "state", "source", "provider_name", "model_name", "inherited_from",
    }


@pytest.mark.asyncio
async def test_packaged_placeholders_never_read_as_ready(env, client, monkeypatch, integration_db):
    _use_app_settings(
        monkeypatch,
        volcano_tts_api_key="your_volcano_tts_api_key",
        ark_api_key="your_ark_api_key_here",
        pexels_api_keys=["your_pexels_api_key_here"],
        volcano_asr_appid="your_volcano_asr_appid_here",
        volcano_asr_access_token="your_volcano_asr_access_token_here",
    )

    states = _states(client)

    assert states["tts"] == "missing"
    assert states["ai_image"] == states["ai_video"] == "missing"
    assert states["video_library"] == "missing"
    assert states["asr"] == "missing"


@pytest.mark.asyncio
async def test_asr_with_only_an_app_id_is_invalid_then_ready_when_complete(
    env, client, integration_db
):
    from app.services.integration_credentials_service import integration_credentials

    await integration_credentials.save("volcano_asr", {"appid": "1234567890"})
    assert _states(client)["asr"] == "invalid"

    await integration_credentials.save("volcano_asr", {"access_token": "token-aaaaaaaa"})
    item = _by_id(client)["asr"]
    assert (item["state"], item["source"]) == ("ready", "database")


@pytest.mark.asyncio
async def test_one_ark_key_makes_image_and_video_ready_together(env, client, integration_db):
    from app.services.integration_credentials_service import integration_credentials

    await integration_credentials.save("ark", {"api_key": "ark-key-12345678"})

    states = _states(client)
    assert states["ai_image"] == states["ai_video"] == "ready"


@pytest.mark.asyncio
async def test_a_real_env_value_reports_environment_as_the_source(
    env, client, monkeypatch, integration_db
):
    _use_app_settings(monkeypatch, volcano_tts_api_key="real-env-key-12345")

    item = _by_id(client)["tts"]

    assert (item["state"], item["source"]) == ("ready", "environment")


@pytest.mark.asyncio
async def test_a_failed_credential_load_is_indeterminate_not_missing(
    env, client, integration_db
):
    from app.services.integration_credentials_service import integration_credentials

    integration_credentials.load_failed = True

    states = _states(client)

    assert all(states[c] == "indeterminate" for c in INTEGRATION_CAPABILITIES)
    assert states["chat"] == "missing"


@pytest.mark.asyncio
async def test_integration_rows_never_contain_credentials(env, client, integration_db):
    from app.services.integration_credentials_service import integration_credentials

    await integration_credentials.save("volcano_asr", {"appid": "1234567890", "access_token": CANARY})
    await integration_credentials.save("pexels", {"api_keys": [CANARY + "-p"]})

    raw = client.get("/api/config/capability-status").text

    assert CANARY not in raw and "1234567890" not in raw
