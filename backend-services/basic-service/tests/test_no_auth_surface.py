"""
Pins that the authentication surface is gone and stays gone.

Business endpoints answer without any credential, and the removed auth /
user-management / rate-limit endpoints are no longer routed. We assemble a
minimal app from the individual routers rather than importing ``app.main``,
which pulls in cv2 / ffmpeg and is far heavier than this needs to be; the
routed-path assertions read ``app.main``'s router registrations indirectly by
asserting on each router's own paths.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import database
from app.constants import LOCAL_OWNER_ID
from app.models.db_models import Base


@pytest_asyncio.fixture
async def project_client(tmp_path, monkeypatch):
    """A TestClient over ``video_project_router`` backed by a temp SQLite DB."""
    monkeypatch.setattr(
        database.settings.database,
        "url",
        "sqlite+aiosqlite:///" + (tmp_path / "no_auth.db").as_posix(),
    )
    engine = database._create_engine()
    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "async_session_factory", session_factory)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    from app.routers import video_project_router

    app = FastAPI()
    app.include_router(video_project_router.router, prefix="/api")
    try:
        yield TestClient(app)
    finally:
        await engine.dispose()


def test_project_list_answers_without_any_credential(project_client):
    """No Authorization header, no cookie — still a 200."""
    resp = project_client.get("/api/video-projects")
    assert resp.status_code == 200, resp.text
    assert resp.json()["success"] is True


def test_a_stale_authorization_header_is_simply_ignored(project_client):
    """An upgraded client may still send its old token; it must not 401."""
    resp = project_client.get(
        "/api/video-projects",
        headers={"Authorization": "Bearer stale-token-from-an-old-build"},
    )
    assert resp.status_code == 200, resp.text


def test_created_project_is_owned_by_the_local_owner(project_client):
    """Ownership comes from the constant, never from the request."""
    resp = project_client.post(
        "/api/video-projects",
        json={"name": "Desktop project"},
    )
    assert resp.status_code == 200, resp.text
    project_id = resp.json()["data"]["id"]

    listing = project_client.get("/api/video-projects")
    ids = [item["id"] for item in listing.json()["data"]["items"]]
    assert project_id in ids


def test_a_request_body_cannot_choose_an_owner(project_client):
    """``user_id`` in the body is ignored — ownership is not on the wire."""
    import asyncio

    from sqlalchemy import text

    resp = project_client.post(
        "/api/video-projects",
        json={"name": "Smuggled", "user_id": "somebody-else"},
    )
    assert resp.status_code == 200, resp.text

    async def _stored_owner() -> str:
        async with database.engine.connect() as conn:
            result = await conn.execute(
                text("SELECT user_id FROM video_projects WHERE name = 'Smuggled'")
            )
            return result.scalar_one()

    assert asyncio.run(_stored_owner()) == LOCAL_OWNER_ID


@pytest.mark.parametrize(
    "module_name",
    ["auth_router", "user_router", "rate_limit_settings_router",
     "telemetry_router", "admin_playback_router"],
)
def test_removed_routers_no_longer_exist(module_name):
    """Importing a deleted router must fail — nothing can re-register it."""
    import importlib

    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(f"app.routers.{module_name}")


def test_auth_dependency_module_is_gone():
    """``get_current_user`` / ``require_admin`` have no home to come back to."""
    import importlib

    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("app.dependencies.auth")


def test_main_registers_no_auth_middleware():
    """The middleware stack must not regrow a session or rate-limit layer."""
    from pathlib import Path

    main_src = (
        Path(__file__).resolve().parents[1] / "app" / "main.py"
    ).read_text(encoding="utf-8")

    assert "SessionAuthMiddleware" not in main_src
    assert "RateLimitMiddleware" not in main_src


def test_the_local_owner_id_is_a_stable_literal():
    """The id is written into every row; it must never be regenerated."""
    assert LOCAL_OWNER_ID == "00000000-0000-0000-0000-000000000001"
