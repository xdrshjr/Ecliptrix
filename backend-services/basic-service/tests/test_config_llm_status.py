"""
Tests for GET /api/config/llm-status (desktop-config-free-startup spec §4.1).

Covers the four credential states (unconfigured / placeholder env / real env /
DB assignment), the R4 indeterminate signal on resolution failure, and the
secret-free response contract. Uses the in-memory SQLite factory from the
authz-integration pattern; ``model_settings_service`` binds
``async_session_factory`` at import time, so the patch targets that module.
"""

from __future__ import annotations

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
from app.services import model_settings_service as model_settings_service_module


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        yield factory
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def client(monkeypatch, session_factory):
    # get_effective_config reads the factory bound inside the service module.
    monkeypatch.setattr(
        model_settings_service_module, "async_session_factory", session_factory
    )
    app = FastAPI()
    app.include_router(config_router, prefix="/api")
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_llm_env(monkeypatch):
    """Each test starts from a zero-credential environment."""
    for key in ("LLM_API_KEY", "LLM_API_URL", "LLM_MODEL", "LLM_API_TYPE"):
        monkeypatch.delenv(key, raising=False)
    yield


async def _seed_chat_assignment(factory: async_sessionmaker) -> None:
    async with factory() as session:
        provider = ModelProvider(
            name="Test DeepSeek",
            provider_type="deepseek",
            api_url="https://api.deepseek.com/v1",
            api_key="sk-real-test-key",
            api_format="openai",
        )
        session.add(provider)
        await session.flush()
        session.add(
            ModelAssignment(
                function_type="chat",
                provider_id=provider.id,
                model_name="deepseek-chat",
                temperature=0.7,
                max_tokens=128000,
            )
        )
        await session.commit()


@pytest.mark.asyncio
async def test_rejects_nothing_when_unconfigured(client):
    resp = client.get("/api/config/llm-status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["configured"] is False
    assert body["data"]["source"] == "none"


@pytest.mark.asyncio
async def test_treats_placeholder_env_as_unconfigured(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "your_llm_api_key_here")
    monkeypatch.setenv("LLM_API_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    body = client.get("/api/config/llm-status").json()
    assert body["success"] is True
    assert body["data"]["configured"] is False
    assert body["data"]["source"] == "none"


@pytest.mark.asyncio
async def test_reports_environment_source(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "sk-real-env-key")
    monkeypatch.setenv("LLM_API_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    body = client.get("/api/config/llm-status").json()
    assert body["success"] is True
    assert body["data"]["configured"] is True
    assert body["data"]["source"] == "environment"


@pytest.mark.asyncio
async def test_prefers_database_assignment(client, session_factory):
    await _seed_chat_assignment(session_factory)
    body = client.get("/api/config/llm-status").json()
    assert body["success"] is True
    assert body["data"]["configured"] is True
    assert body["data"]["source"] == "database"


@pytest.mark.asyncio
async def test_signals_indeterminate_on_resolution_failure(client, monkeypatch):
    async def _boom(_function_type):
        raise RuntimeError("simulated DB outage")

    monkeypatch.setattr(
        model_settings_service_module.model_settings_service,
        "get_effective_config",
        _boom,
    )
    resp = client.get("/api/config/llm-status")
    # R4: still HTTP 200, but success=false → renderer maps to 'unknown'.
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False
    assert body["data"]["configured"] is False
    assert body["data"]["source"] == "none"


@pytest.mark.asyncio
async def test_response_never_contains_credentials(client, session_factory, monkeypatch):
    """Security contract: no api_key/api_url/model fields in any state."""
    await _seed_chat_assignment(session_factory)
    monkeypatch.setenv("LLM_API_KEY", "sk-real-env-key")
    monkeypatch.setenv("LLM_API_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    body = client.get("/api/config/llm-status").json()
    assert set(body.keys()) == {"success", "data"}
    assert set(body["data"].keys()) == {"configured", "source"}
    flattened = str(body)
    assert "sk-real" not in flattened
    assert "api_key" not in flattened
    assert "api_url" not in flattened
