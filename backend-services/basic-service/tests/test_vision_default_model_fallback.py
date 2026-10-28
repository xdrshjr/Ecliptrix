"""
RV-01 (first-run-setup-wizard B0): ``vl_llm_model`` defaults to
``qwen-vl-plus`` while its url/key default to empty. On a clean install that
used to make the vision env group look "partly configured", so
``resolve_vision_config`` raised ``configuration_invalid`` instead of falling
back to chat.

``get_settings`` is stubbed so the developer's real ``.env`` cannot leak in.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.models.db_models import Base, ModelAssignment, ModelProvider
from app.models.web_research_models import WebResearchError
from app.services import model_settings_service as model_settings_module


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


def _clean_install_settings(**overrides: Any) -> SimpleNamespace:
    values = {}
    for prefix in ("llm", "fast_llm", "vl_llm", "research_llm"):
        for suffix, default in (
            ("_api_url", ""),
            ("_api_key", ""),
            ("_model", ""),
            ("_api_type", "openai"),
        ):
            values[prefix + suffix] = default
    values["vl_llm_model"] = "qwen-vl-plus"  # config.py default
    values.update(overrides)
    return SimpleNamespace(**values)


async def _seed_chat(factory: async_sessionmaker) -> None:
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


def _install(monkeypatch, factory, settings) -> None:
    monkeypatch.setattr(model_settings_module, "async_session_factory", factory)
    monkeypatch.setattr(model_settings_module, "get_settings", lambda: settings)


@pytest.mark.asyncio
async def test_vision_falls_back_to_chat_when_only_default_model_is_set(
    monkeypatch, session_factory
):
    await _seed_chat(session_factory)
    monkeypatch.delenv("VL_LLM_MODEL", raising=False)
    _install(monkeypatch, session_factory, _clean_install_settings())

    resolved = await model_settings_module.model_settings_service.resolve_vision_config()

    assert resolved.source == "database"
    assert resolved.model_name == "deepseek-chat"


@pytest.mark.asyncio
async def test_vision_stays_invalid_when_url_set_without_key(
    monkeypatch, session_factory
):
    await _seed_chat(session_factory)
    monkeypatch.setenv("VL_LLM_MODEL", "qwen-vl-max")
    _install(
        monkeypatch,
        session_factory,
        _clean_install_settings(
            vl_llm_api_url="https://vl.test/v1", vl_llm_model="qwen-vl-max"
        ),
    )

    with pytest.raises(WebResearchError) as caught:
        await model_settings_module.model_settings_service.resolve_vision_config()

    assert caught.value.args[0] == "configuration_invalid"


@pytest.mark.asyncio
async def test_vision_explicit_model_without_credentials_stays_invalid(
    monkeypatch, session_factory
):
    # The user set VL_LLM_MODEL themselves: an incomplete group is a real
    # misconfiguration, not the shipped default.
    monkeypatch.setenv("VL_LLM_MODEL", "qwen-vl-max")
    _install(
        monkeypatch,
        session_factory,
        _clean_install_settings(vl_llm_model="qwen-vl-max"),
    )

    with pytest.raises(WebResearchError) as caught:
        await model_settings_module.model_settings_service.resolve_vision_config()

    assert caught.value.args[0] == "configuration_invalid"
