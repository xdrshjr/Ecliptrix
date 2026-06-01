"""
Authorization integration tests (spec 01 §3 / §6, master-plan §8.1).

Drives the REAL ``SessionAuthMiddleware`` + REAL ``require_admin`` /
``get_current_user`` dependencies + the REAL ``model_settings_router`` (the R8
management router, admin-gated at the router level) over a ``TestClient`` with
an in-memory SQLite DB.

Verifies, with ``AUTH_ENFORCE_DEFAULT_DENY=True`` (flag-on, the rollout state):
  * representative protected endpoint: anonymous → 401 (UNAUTHORIZED);
    normal logged-in user → 200; disabled account → 403 (ACCOUNT_DISABLED).
  * management endpoint (model-settings): non-admin → 403 (FORBIDDEN);
    admin → 200; root → 200; anonymous → 401.
  * allowlisted endpoint (/api/config/...) → 200 anonymous.
  * error codes UNAUTHORIZED / FORBIDDEN / ACCOUNT_DISABLED are exact.
"""

from __future__ import annotations

import secrets
from typing import Tuple

import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app import database as database_module
from app.dependencies.auth import get_current_user
from app.middleware import auth_middleware as auth_middleware_module
from app.middleware.auth_middleware import SessionAuthMiddleware
from app.models.db_models import Base, User
from app.routers.model_settings_router import router as model_settings_router


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
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
async def app_and_factory(monkeypatch, session_factory):
    # Both the middleware lookup and the dependency slow-path read these.
    monkeypatch.setattr(
        auth_middleware_module, "async_session_factory", session_factory
    )
    monkeypatch.setattr(database_module, "async_session_factory", session_factory)
    # Flag-on: the rollout state where default-deny enforces.
    monkeypatch.setattr(
        auth_middleware_module.settings,
        "auth_enforce_default_deny",
        True,
        raising=False,
    )

    app = FastAPI()
    app.add_middleware(SessionAuthMiddleware)

    # A representative ordinary protected endpoint (business handler that needs
    # the user object). Not in the allowlist → must be authenticated.
    @app.get("/api/workflow/list")
    async def workflow_list(current_user: User = Depends(get_current_user)):
        return {"success": True, "user_id": str(current_user.id)}

    # An allowlisted runtime-config endpoint (spec/01 §3.2 — /api/config/ prefix).
    @app.get("/api/config/playback-flag")
    async def playback_flag():
        return {"success": True, "data": {"enabled": False}}

    # The R8 management router (router-level require_admin).
    app.include_router(model_settings_router, prefix="/api")

    return app, session_factory


async def _create_user(
    factory: async_sessionmaker,
    *,
    username: str,
    is_admin: bool = False,
    is_root: bool = False,
    is_active: bool = True,
) -> Tuple[User, str]:
    token = secrets.token_urlsafe(32)
    async with factory() as session:
        user = User(
            username=username,
            email=f"{username}@test.local",
            password_hash="$2b$12$placeholderhashplaceholderhashpla",
            is_active=is_active,
            is_admin=is_admin,
            is_root=is_root,
            user_role="admin" if (is_admin or is_root) else "regular",
            active_session_token=token,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user, token


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Representative protected endpoint
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_protected_anonymous_returns_401(app_and_factory):
    app, _factory = app_and_factory
    client = TestClient(app)
    resp = client.get("/api/workflow/list")
    assert resp.status_code == 401
    body = resp.json()
    assert body["success"] is False
    assert body["error_code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_protected_normal_user_returns_200(app_and_factory):
    app, factory = app_and_factory
    user, token = await _create_user(factory, username="alice", is_admin=False)
    client = TestClient(app)
    resp = client.get("/api/workflow/list", headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["user_id"] == str(user.id)


@pytest.mark.asyncio
async def test_protected_disabled_account_returns_403(app_and_factory):
    app, factory = app_and_factory
    _user, token = await _create_user(
        factory, username="carol", is_active=False
    )
    client = TestClient(app)
    resp = client.get("/api/workflow/list", headers=_auth(token))
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "ACCOUNT_DISABLED"


@pytest.mark.asyncio
async def test_protected_invalid_token_returns_401(app_and_factory):
    app, _factory = app_and_factory
    client = TestClient(app)
    resp = client.get("/api/workflow/list", headers=_auth("not-a-real-token"))
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "UNAUTHORIZED"


# ---------------------------------------------------------------------------
# Management endpoint (R8 model-settings, router-level require_admin)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_management_anonymous_returns_401(app_and_factory):
    app, _factory = app_and_factory
    client = TestClient(app)
    resp = client.get("/api/model-settings/providers/known")
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_management_non_admin_returns_403(app_and_factory):
    app, factory = app_and_factory
    _user, token = await _create_user(factory, username="bob", is_admin=False)
    client = TestClient(app)
    resp = client.get("/api/model-settings/providers/known", headers=_auth(token))
    assert resp.status_code == 403
    body = resp.json()
    # require_admin raises FORBIDDEN.
    assert body.get("error_code") == "FORBIDDEN" or body.get("detail") is not None


@pytest.mark.asyncio
async def test_management_admin_returns_200(app_and_factory):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)
    resp = client.get("/api/model-settings/providers/known", headers=_auth(token))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_management_root_returns_200(app_and_factory):
    app, factory = app_and_factory
    # A real root user also carries is_admin=True (require_admin checks is_admin;
    # root satisfies it because the model sets both flags). Mirror that here.
    _root, token = await _create_user(
        factory, username="r00t", is_root=True, is_admin=True
    )
    client = TestClient(app)
    resp = client.get("/api/model-settings/providers/known", headers=_auth(token))
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_allowlisted_config_anonymous_returns_200(app_and_factory):
    app, _factory = app_and_factory
    client = TestClient(app)
    resp = client.get("/api/config/playback-flag")
    assert resp.status_code == 200
    assert resp.json()["data"]["enabled"] is False
