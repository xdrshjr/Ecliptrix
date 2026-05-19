"""Shared pytest fixtures for ``tests/security/``.

Provides reusable building blocks for the security-regression suite:

  * ``security_engine`` / ``security_session_factory`` — in-memory SQLite
    engine and a ``async_sessionmaker`` against it, so every test sees a
    fresh schema (no cross-test pollution).
  * ``patched_auth_factories`` — patches the
    ``async_session_factory`` symbols used both by ``SessionAuthMiddleware``
    and by ``app.database.get_db_session`` so router-level ``Depends`` chains
    see the same in-memory DB.
  * ``create_user`` — async helper to insert a ``User`` and return
    ``(user, session_token)``.
  * ``security_app`` — minimal FastAPI app builder. Tests assemble the app
    by composing the helpers exposed here; we deliberately do NOT import
    ``app.main`` because it pulls in heavy optional deps (cv2, ffmpeg, etc.).
"""

from __future__ import annotations

import secrets
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Callable, Tuple

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models.db_models import Base, User


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


@pytest_asyncio.fixture
async def patched_auth_factories(monkeypatch, security_session_factory):
    """Patch the session factories that auth code uses.

    Two places need to be redirected at the test DB:
      1. ``app.middleware.auth_middleware.async_session_factory`` — used by
         ``SessionAuthMiddleware.dispatch`` to look up the active token.
      2. ``app.database.async_session_factory`` — used by
         ``get_db_session`` and therefore by ``get_current_user`` slow-path.

    Without patching both, the middleware's lookup would succeed but the
    dependency's lookup (or vice versa) would hit a non-existent prod DB.
    """
    from app.middleware import auth_middleware as auth_middleware_module
    from app import database as database_module

    monkeypatch.setattr(
        auth_middleware_module, "async_session_factory", security_session_factory
    )
    monkeypatch.setattr(
        database_module, "async_session_factory", security_session_factory
    )
    return security_session_factory


@pytest_asyncio.fixture
async def create_user(security_session_factory) -> Callable:
    """Return an async helper that inserts a User row and returns (user, token)."""

    async def _create(
        *,
        username: str = "alice",
        is_active: bool = True,
        is_admin: bool = False,
        is_root: bool = False,
    ) -> Tuple[User, str]:
        token = secrets.token_urlsafe(32)
        async with security_session_factory() as session:
            user = User(
                username=username,
                email=f"{username}@test.local",
                password_hash="$2b$12$placeholderhashplaceholderhashpla",
                is_active=is_active,
                is_admin=is_admin,
                is_root=is_root,
                user_role="admin" if is_admin else "regular",
                active_session_token=token,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
        return user, token

    return _create
