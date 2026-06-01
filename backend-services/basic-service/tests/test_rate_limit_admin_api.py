"""
Integration tests for the rate-limit admin API (spec 03 §2.4).

Drives the REAL ``rate_limit_settings_router`` behind a real ``require_admin``
dependency and a ``SessionAuthMiddleware`` substitute, with the real
``get_db_session`` commit/rollback semantics (the router ``flush()``es and
relies on the dependency to commit). In-memory SQLite (StaticPool, single
connection) backs ``SystemSetting`` / ``SettingsAuditLog`` / ``User``.

Covers:
  * GET /config — meta (default/type/min/max/description) + defaults; admin only.
  * non-admin → 403 on every endpoint.
  * PUT valid subset → 200, echoes the new effective config, provider reflects
    the change immediately (``invalidate()`` fired), persisted to DB.
  * PUT out-of-range / unknown key → 422 and NOTHING written.
  * window_seconds 10–3600 boundary (10/3600 ok, 9/3601 → 422).
  * POST /reset → all keys back to factory defaults.
  * GET /status — exact field set.
  * audit rows written (category='rate_limiting', setting_type='system_setting').
"""

from __future__ import annotations

import secrets
from typing import Tuple

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app import database as database_module
from app.config import RATE_LIMIT_DEFAULTS
from app.database import get_db_session
from app.middleware import auth_middleware as auth_middleware_module
from app.middleware.auth_middleware import SessionAuthMiddleware
from app.models.db_models import Base, SettingsAuditLog, SystemSetting, User
from app.routers.rate_limit_settings_router import router as rate_limit_router
from app.services import rate_limit_config as cfg_module
from app.services.rate_limit_config import (
    RATE_LIMIT_CATEGORY,
    RATE_LIMIT_KEYS,
    rate_limit_config_provider,
)
from app.services.rate_limiter import rate_limiter


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


@pytest_asyncio.fixture(autouse=True)
async def reset_provider_and_limiter():
    """Provider cache + limiter stats must be clean before AND after each test."""
    rate_limit_config_provider.invalidate()
    await rate_limiter.reset()
    yield
    rate_limit_config_provider.invalidate()
    await rate_limiter.reset()


@pytest_asyncio.fixture
async def app_and_factory(monkeypatch, session_factory):
    """Build a FastAPI app with the real router + auth, wired to the test DB."""
    # The middleware + provider + get_current_user slow-path all read these.
    monkeypatch.setattr(
        auth_middleware_module, "async_session_factory", session_factory
    )
    monkeypatch.setattr(database_module, "async_session_factory", session_factory)
    monkeypatch.setattr(cfg_module, "DEFAULT_TTL_SECONDS", 0.0, raising=False)
    # Force full default-deny so anonymous requests are rejected by the middleware.
    monkeypatch.setattr(
        auth_middleware_module.settings,
        "auth_enforce_default_deny",
        True,
        raising=False,
    )

    app = FastAPI()
    app.add_middleware(SessionAuthMiddleware)
    app.include_router(rate_limit_router, prefix="/api")

    # Override get_db_session with a test-bound session that commits on success
    # (mirrors app.database.get_db_session — the router relies on the commit).
    async def _override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_session] = _override_get_db
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


async def _read_rows(factory) -> dict:
    async with factory() as session:
        rows = (
            await session.execute(
                select(SystemSetting).where(
                    SystemSetting.category == RATE_LIMIT_CATEGORY
                )
            )
        ).scalars().all()
        return {r.key: r.value for r in rows}


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_get_config_returns_defaults_and_meta(app_and_factory):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)

    resp = client.get("/api/rate-limit/config", headers=_auth(token))
    assert resp.status_code == 200
    cfg = resp.json()["config"]
    assert cfg["enabled"] == RATE_LIMIT_DEFAULTS["enabled"]
    assert cfg["window_seconds"] == RATE_LIMIT_DEFAULTS["window_seconds"]
    assert cfg["limits"]["ai_generation_per_min"] == 30
    assert cfg["limits"]["media_serving_per_min"] == 6000

    meta = cfg["meta"]
    # All 7 keys present with default/type/min/max/description.
    assert set(meta.keys()) == set(RATE_LIMIT_KEYS)
    for key in RATE_LIMIT_KEYS:
        assert {"default", "type", "min", "max", "description"} <= set(meta[key].keys())
    assert meta["enabled"]["type"] == "boolean"
    assert meta["window_seconds"]["min"] == 10
    assert meta["window_seconds"]["max"] == 3600
    assert meta["media_serving_per_min"]["max"] == 1000000


@pytest.mark.asyncio
async def test_non_admin_forbidden_on_all_endpoints(app_and_factory):
    app, factory = app_and_factory
    _user, token = await _create_user(factory, username="bob", is_admin=False)
    client = TestClient(app)

    assert client.get("/api/rate-limit/config", headers=_auth(token)).status_code == 403
    assert client.get("/api/rate-limit/status", headers=_auth(token)).status_code == 403
    assert (
        client.put(
            "/api/rate-limit/config",
            json={"ai_generation_per_min": 50},
            headers=_auth(token),
        ).status_code
        == 403
    )
    assert client.post("/api/rate-limit/reset", headers=_auth(token)).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(app_and_factory):
    app, _factory = app_and_factory
    client = TestClient(app)
    # No token + default-deny on → 401 from the middleware.
    assert client.get("/api/rate-limit/config").status_code == 401


# ---------------------------------------------------------------------------
# PUT /config — valid
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_put_valid_updates_persists_and_invalidates(app_and_factory):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)

    resp = client.put(
        "/api/rate-limit/config",
        json={"ai_generation_per_min": 55, "enabled": False},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    cfg = resp.json()["config"]
    assert cfg["limits"]["ai_generation_per_min"] == 55
    assert cfg["enabled"] is False

    # Persisted to DB.
    rows = await _read_rows(factory)
    assert rows["ai_generation_per_min"] == 55
    assert rows["enabled"] is False

    # Provider reflects it immediately (invalidate fired). Provider reads the
    # patched session_factory via app.database.
    effective = await rate_limit_config_provider.get_config()
    assert effective.limits.ai_generation == 55
    assert effective.enabled is False


@pytest.mark.asyncio
async def test_put_then_get_shows_persisted_value(app_and_factory):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)

    client.put(
        "/api/rate-limit/config",
        json={"default_per_user_per_min": 123},
        headers=_auth(token),
    )
    resp = client.get("/api/rate-limit/config", headers=_auth(token))
    assert resp.json()["config"]["limits"]["default_per_user_per_min"] == 123


# ---------------------------------------------------------------------------
# PUT /config — invalid (422, nothing written)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"ai_generation_per_min": 0},            # below min (1)
        {"ai_generation_per_min": -5},           # negative
        {"ai_generation_per_min": 9_999_999_999},  # above max (100000)
        {"default_per_user_per_min": 0},
        {"unknown_key": 5},                      # extra=forbid
    ],
)
async def test_put_invalid_returns_422_and_writes_nothing(app_and_factory, payload):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)

    before = await _read_rows(factory)
    resp = client.put("/api/rate-limit/config", json=payload, headers=_auth(token))
    assert resp.status_code == 422
    after = await _read_rows(factory)
    assert after == before, "a 422 must not write a single row"


@pytest.mark.asyncio
async def test_window_seconds_boundary(app_and_factory):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)

    # 10 and 3600 are inclusive-valid.
    assert (
        client.put(
            "/api/rate-limit/config",
            json={"window_seconds": 10},
            headers=_auth(token),
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/rate-limit/config",
            json={"window_seconds": 3600},
            headers=_auth(token),
        ).status_code
        == 200
    )
    # 9 and 3601 are out of range.
    assert (
        client.put(
            "/api/rate-limit/config",
            json={"window_seconds": 9},
            headers=_auth(token),
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/rate-limit/config",
            json={"window_seconds": 3601},
            headers=_auth(token),
        ).status_code
        == 422
    )


# ---------------------------------------------------------------------------
# POST /reset
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reset_restores_defaults(app_and_factory):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)

    # Change a couple of values first.
    client.put(
        "/api/rate-limit/config",
        json={"ai_generation_per_min": 99, "enabled": False},
        headers=_auth(token),
    )
    # Reset.
    resp = client.post("/api/rate-limit/reset", headers=_auth(token))
    assert resp.status_code == 200
    cfg = resp.json()["config"]
    assert cfg["limits"]["ai_generation_per_min"] == RATE_LIMIT_DEFAULTS[
        "ai_generation_per_min"
    ]
    assert cfg["enabled"] == RATE_LIMIT_DEFAULTS["enabled"]

    rows = await _read_rows(factory)
    for key in RATE_LIMIT_KEYS:
        assert rows[key] == RATE_LIMIT_DEFAULTS[key]


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_status_fields(app_and_factory):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)

    resp = client.get("/api/rate-limit/status", headers=_auth(token))
    assert resp.status_code == 200
    status = resp.json()["status"]
    assert set(status.keys()) == {
        "enabled",
        "active_keys",
        "total_checked",
        "total_blocked",
    }
    assert isinstance(status["enabled"], bool)
    assert isinstance(status["active_keys"], int)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_audit_rows_written_for_update_and_reset(app_and_factory):
    app, factory = app_and_factory
    _admin, token = await _create_user(factory, username="adm", is_admin=True)
    client = TestClient(app)

    client.put(
        "/api/rate-limit/config",
        json={"ai_generation_per_min": 40},
        headers=_auth(token),
    )
    client.post("/api/rate-limit/reset", headers=_auth(token))

    async with factory() as session:
        rows = (
            await session.execute(
                select(SettingsAuditLog).where(
                    SettingsAuditLog.category == RATE_LIMIT_CATEGORY
                )
            )
        ).scalars().all()

    actions = {r.action for r in rows}
    assert "update" in actions
    assert "reset" in actions
    for r in rows:
        assert r.setting_type == "system_setting"
        assert r.changed_by == "adm"
