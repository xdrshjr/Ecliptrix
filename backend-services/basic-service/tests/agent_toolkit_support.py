"""Agent Toolkit 测试共用支撑：临时工作区 + 独立 SQLite 引擎 + 假 Request。

刻意不放进 `conftest.py`：这些夹具只服务本域测试，避免影响既有 111 个测试
文件的收集行为。
"""
import asyncio
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models.agent_toolkit_db_models  # noqa: F401  (注册两张新表)
from app.models.db_models import Base
from app.services.agent_toolkit import workspace_store


class FakeRequest:
    """最小 Request 替身：只提供 headers（闸门只看它）。"""

    def __init__(self, headers=None):
        self.headers = dict(headers or {})


def origin_headers(**extra):
    headers = {"origin": "http://localhost:3000"}
    headers.update(extra)
    return headers


@pytest_asyncio.fixture
async def toolkit_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False)
    try:
        yield factory
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest.fixture
def toolkit_workspace(tmp_path, monkeypatch):
    """把工作区根指到 tmp_path/agent_workspace（生产代码路径不变）。"""
    root = tmp_path / "agent_workspace"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(workspace_store, "workspace_root", lambda: root)
    return root


@pytest.fixture
def toolkit_settings_override(monkeypatch):
    """按需覆盖 `toolkit_settings()` 的返回值。"""

    def apply(**overrides):
        from app.services import system_settings_service as module

        base = module.AGENT_TOOLKIT_DEFAULTS.copy()
        base.update(overrides)
        monkeypatch.setattr(module, "toolkit_settings", lambda: base)
        return base

    return apply


def run(coroutine):
    return asyncio.get_event_loop().run_until_complete(coroutine)


def write_project_file(root, project_id, relative, content):
    """直接在测试里铺一个工作区文件（用于配额/二进制用例）。"""
    directory = workspace_store.project_directory(project_id, root)
    target = Path(directory) / "files" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content if isinstance(content, bytes)
                       else content.encode("utf-8"))
    return target
