"""Shared pytest fixtures for ``tests/security/``.

Provides reusable building blocks for the security-regression suite:

  * ``security_engine`` / ``security_session_factory`` — in-memory SQLite
    engine and a ``async_sessionmaker`` against it, so every test sees a
    fresh schema (no cross-test pollution).

The ``patched_auth_factories`` / ``create_user`` fixtures went away with the
user system (`desktop-only-refactor`). The suites that used them —
``test_04_path_traversal`` and ``test_07_range_requests`` — kept every one of
their assertions: path traversal and HTTP Range have nothing to do with who
the caller is.

Tests assemble their app by composing the helpers exposed here; we
deliberately do NOT import ``app.main`` because it pulls in heavy optional
deps (cv2, ffmpeg, etc.).
"""

from __future__ import annotations

from typing import AsyncGenerator

import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models.db_models import Base


TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def security_engine() -> AsyncGenerator[object, None]:
    """Create an in-memory SQLite engine and run schema creation."""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest_asyncio.fixture
async def security_session_factory(security_engine) -> async_sessionmaker:
    """Return an ``async_sessionmaker`` bound to the in-memory engine."""
    return async_sessionmaker(security_engine, class_=AsyncSession, expire_on_commit=False)
