"""
Tests for GET /api/admin/playback-proxies (Phase 4 §4.1.1).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import get_db_session
from app.dependencies.auth import get_current_user, require_admin
from app.models.db_models import Base, CachedMaterial
from app.routers.admin_playback_router import router as admin_router


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


class _FakeAdmin:
    id = "admin-uuid"
    username = "admin"
    is_admin = True
    is_root = True
    is_active = True
    user_role = "admin"


class _FakeUser:
    id = "user-uuid"
    username = "alice"
    is_admin = False
    is_root = False
    is_active = True
    user_role = "user"


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def seeded_factory(session_factory):
    """Insert a small batch of rows in mixed proxy states."""
    async with session_factory() as session:
        for i in range(3):
            row = CachedMaterial(
                source="pexels",
                source_id=f"running-{i}",
                source_url=f"https://example.com/run-{i}.mp4",
                local_path=f"/tmp/run-{i}.mp4",
                status="ready",
                preview_proxy_status="running",
                preview_proxy_progress=10 * i,
                preview_proxy_profile="preview-480p",
            )
            session.add(row)
        cached_row = CachedMaterial(
            source="pexels",
            source_id="cached-1",
            source_url="https://example.com/cached.mp4",
            local_path="/tmp/cached.mp4",
            status="ready",
            preview_proxy_status="cached",
            preview_proxy_progress=100,
            preview_proxy_profile="preview-480p",
            preview_proxy_transcoded_at=datetime.now(timezone.utc),
        )
        session.add(cached_row)
        failed_row = CachedMaterial(
            source="pexels",
            source_id="failed-1",
            source_url="https://example.com/failed.mp4",
            local_path="/tmp/failed.mp4",
            status="ready",
            preview_proxy_status="failed",
            preview_proxy_last_error="ffmpeg exit=1",
            preview_proxy_progress=0,
            preview_proxy_profile="preview-480p",
        )
        session.add(failed_row)
        await session.commit()
    return session_factory


@pytest.fixture
def admin_app(seeded_factory):
    factory = seeded_factory
    app = FastAPI()
    app.include_router(admin_router, prefix="/api")

    async def _get_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = _get_session
    app.dependency_overrides[require_admin] = lambda: _FakeAdmin()
    return app


@pytest.fixture
def user_app(seeded_factory):
    """Same DB but require_admin raises 403."""
    factory = seeded_factory
    from fastapi import HTTPException, status

    app = FastAPI()
    app.include_router(admin_router, prefix="/api")

    async def _get_session():
        async with factory() as session:
            yield session

    def _block_admin():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error_code": "FORBIDDEN", "message": "admin required"},
        )

    app.dependency_overrides[get_db_session] = _get_session
    app.dependency_overrides[require_admin] = _block_admin
    return app


def test_default_filter_excludes_cached_and_absent(admin_app):
    client = TestClient(admin_app)
    resp = client.get("/api/admin/playback-proxies")
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    statuses = {item["status"] for item in items}
    assert statuses == {"running", "failed"}


def test_status_filter_specific(admin_app):
    client = TestClient(admin_app)
    resp = client.get("/api/admin/playback-proxies?status=cached")
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["status"] == "cached"


def test_status_filter_invalid_returns_400(admin_app):
    client = TestClient(admin_app)
    resp = client.get("/api/admin/playback-proxies?status=mystery")
    assert resp.status_code == 400


def test_limit_query_validation(admin_app):
    client = TestClient(admin_app)
    resp = client.get("/api/admin/playback-proxies?limit=0")
    assert resp.status_code == 422


def test_non_admin_is_forbidden(user_app):
    client = TestClient(user_app)
    resp = client.get("/api/admin/playback-proxies")
    assert resp.status_code == 403


def test_response_short_names_match_spec(admin_app):
    client = TestClient(admin_app)
    resp = client.get("/api/admin/playback-proxies?status=running")
    body = resp.json()
    item = body["data"]["items"][0]
    assert set(item.keys()) == {
        "material_id",
        "profile",
        "status",
        "progress",
        "transcoded_at",
        "bytes",
        "error",
    }


def test_pagination_limit_one(admin_app):
    client = TestClient(admin_app)
    resp = client.get("/api/admin/playback-proxies?status=running&limit=1")
    assert resp.status_code == 200
    body = resp.json()
    items = body["data"]["items"]
    assert len(items) == 1
    # When more rows remain we expect a nextCursor.
    assert body["data"]["nextCursor"] is not None
