"""
AM-04: the VIDEO_CUT env fallback of ``get_effective_config`` resolves as one
group, so ``LLM_API_URL`` is never paired with ``VIDEO_CUT_LLM_API_TYPE``.

``get_settings`` is replaced with a stub so the developer's real ``.env``
cannot leak into the assertions; the DB is an empty in-memory SQLite.
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

from app.models.db_models import Base
from app.models.model_settings_models import (
    ModelFunctionType,
    ResolvedConfigResponse,
)
from app.services import model_settings_service as model_settings_module


@pytest_asyncio.fixture
async def empty_session_factory():
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


def _env_settings(**overrides: Any) -> SimpleNamespace:
    values = {
        "llm_api_url": "https://llm.test/anthropic",
        "llm_api_key": "sk-llm",
        "llm_model": "glm-4.6",
        "llm_api_type": "anthropic",
        "video_cut_llm_api_url": "",
        "video_cut_llm_api_key": "",
        "video_cut_llm_model": "claude-sonnet-4-20250514",
        "video_cut_llm_api_type": "openai",
        "fast_llm_api_url": "",
        "fast_llm_api_key": "",
        "fast_llm_model": "",
        "fast_llm_api_type": "openai",
        "vl_llm_api_url": "",
        "vl_llm_api_key": "",
        "vl_llm_model": "",
        "vl_llm_api_type": "openai",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


async def _resolve_video_cut(
    monkeypatch, session_factory, settings: SimpleNamespace
) -> ResolvedConfigResponse:
    monkeypatch.setattr(
        model_settings_module, "async_session_factory", session_factory
    )
    monkeypatch.setattr(model_settings_module, "get_settings", lambda: settings)
    return await model_settings_module.model_settings_service.get_effective_config(
        ModelFunctionType.VIDEO_CUT
    )


@pytest.mark.asyncio
async def test_video_cut_env_fallback_uses_llm_group_when_video_cut_url_missing(
    monkeypatch, empty_session_factory
):
    settings = _env_settings(video_cut_llm_api_key="sk-stale-video-cut")

    resolved = await _resolve_video_cut(
        monkeypatch, empty_session_factory, settings
    )

    assert resolved.source == "environment"
    assert (
        resolved.api_url,
        resolved.api_key,
        resolved.model_name,
        resolved.api_type,
    ) == ("https://llm.test/anthropic", "sk-llm", "glm-4.6", "anthropic")


@pytest.mark.asyncio
async def test_video_cut_env_fallback_keeps_llm_key_when_only_url_is_set(
    monkeypatch, empty_session_factory
):
    # RV-10: an old .env with only VIDEO_CUT_LLM_API_URL must keep working.
    settings = _env_settings(
        video_cut_llm_api_url="https://cut.test/v1", video_cut_llm_model=""
    )

    resolved = await _resolve_video_cut(
        monkeypatch, empty_session_factory, settings
    )

    assert (
        resolved.api_url,
        resolved.api_key,
        resolved.model_name,
        resolved.api_type,
    ) == ("https://cut.test/v1", "sk-llm", "glm-4.6", "openai")
