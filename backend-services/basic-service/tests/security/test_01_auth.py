"""
Security regression tests for spec 01 (Auth & Access Control).

Covers V01-A / V01-B / V01-C / V01-D from
``docs/plans/high-risk-security-fixes/specs/01-auth-and-access-control.md``.

Strategy
--------
Mirrors ``tests/test_auth_middleware.py``: we DO NOT import ``app.main``
because it pulls in heavy optional deps (cv2, ffmpeg, etc.). Instead each
test builds a minimal FastAPI app that wires up:

  * ``SessionAuthMiddleware`` (the actual production middleware)
  * The three root-level routers being audited
  * The new ``storage_files_router``

Patching is done in the ``patched_auth_factories`` conftest fixture, which
redirects both the middleware's and the dependency's session factories to
the same in-memory SQLite engine.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Tuple

import pytest
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.dependencies.auth import get_current_user, require_admin
from app.middleware.auth_middleware import (
    HARD_PROTECT_PATHS,
    SessionAuthMiddleware,
)
from app.models.db_models import User


# ===========================================================================
# Helpers
# ===========================================================================


def _build_root_router_app() -> FastAPI:
    """Build a minimal app that mounts the root-level routers.

    We mount them WITHOUT ``prefix="/api"`` to exactly mirror the production
    ``main.py`` lines:

        app.include_router(ai_video_generate_router.router)
        app.include_router(video_export_router.router)
    """
    app = FastAPI()
    app.add_middleware(SessionAuthMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.routers import (
        ai_video_generate_router,
        video_export_router,
    )

    app.include_router(ai_video_generate_router.router)
    app.include_router(video_export_router.router)
    return app


def _build_storage_files_app(storage_root: Path) -> FastAPI:
    """Build a minimal app that mounts the new ``storage_files_router``.

    We register the router under the ``/api`` prefix to mirror the production
    ``main.py`` patch: ``app.include_router(storage_files_router, prefix='/api')``.

    The middleware is also registered so the test fully simulates how
    requests will be authenticated in production. Critically:
      - ``/api/storage/files/`` is in the middleware allowlist (so static
        media-tag requests can pass through) BUT the router-level
        ``Depends(get_current_user)`` enforces auth via its slow path.
    """
    # Force StorageService to use a temp root for the duration of this test
    # by monkey-patching its singleton state. We mutate ``.root`` rather than
    # rebuild the singleton to avoid cascading import-time side effects.
    from app.services import storage_service as storage_service_module

    storage_service_module.storage_service.root = storage_root

    app = FastAPI()
    app.add_middleware(SessionAuthMiddleware)

    from app.routers import storage_files_router

    app.include_router(storage_files_router.router, prefix="/api")
    return app


# ===========================================================================
# V01-A — root-level routers reject anonymous requests
# ===========================================================================


@pytest.mark.asyncio
async def test_V01A_hard_protect_paths_constant_matches_spec():
    """The middleware's hard-protect list must match the routers in spec/01."""
    assert HARD_PROTECT_PATHS == (
        "/api/workflow/ai-video-generate",
        "/api/workflow/video-export",
    ), "HARD_PROTECT_PATHS drifted from spec/01 §V01-A"


@pytest.mark.asyncio
async def test_V01A_ai_video_generate_anonymous_returns_401(
    patched_auth_factories,
):
    """Anonymous POST /api/workflow/ai-video-generate → 401."""
    app = _build_root_router_app()
    client = TestClient(app)
    resp = client.post(
        "/api/workflow/ai-video-generate",
        json={
            "nodeId": "n1",
            "taskId": "t1",
            "inputs": {},
        },
    )
    assert resp.status_code == 401, resp.text
    body = resp.json()
    assert body.get("error_code") == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_V01A_video_export_anonymous_returns_401(patched_auth_factories):
    """Anonymous POST /api/workflow/video-export → 401."""
    app = _build_root_router_app()
    client = TestClient(app)
    resp = client.post(
        "/api/workflow/video-export",
        json={"nodeId": "n1", "taskId": "t1", "videoUrls": []},
    )
    assert resp.status_code == 401, resp.text
    body = resp.json()
    assert body.get("error_code") == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_V01A_authenticated_request_reaches_router(
    patched_auth_factories, create_user
):
    """A valid token reaches the router (we then expect a non-401 status).

    We do not care whether the underlying service call succeeds (it will
    likely 5xx because LLM is not configured in tests); we only care that
    the auth gate was passed (i.e. NOT 401).
    """
    _user, token = await create_user(username="alice", is_active=True)
    app = _build_root_router_app()
    client = TestClient(app)
    resp = client.post(
        "/api/workflow/ai-video-generate",
        headers={"Authorization": f"Bearer {token}"},
        json={"nodeId": "n1", "taskId": "t1", "inputs": {}},
    )
    assert resp.status_code != 401, (
        f"Authenticated request should pass auth gate, got 401: {resp.text}"
    )


# ===========================================================================
# V01-B — workflow/test-node session guard (TS-level — covered by the
# sessionGuard module unit and via a runtime smoke test of the validate-session
# backend endpoint). We exercise the backend endpoint contract here.
# ===========================================================================


@pytest.mark.asyncio
async def test_V01B_validate_session_endpoint_rejects_bogus_token(
    patched_auth_factories, create_user
):
    """The BFF sessionGuard calls /api/auth/validate-session; verify that
    endpoint reports valid=False for a token that doesn't match the user."""
    from app.services.session_service import session_service

    user, _real_token = await create_user(username="alice_v01b", is_active=True)
    async with patched_auth_factories() as db:
        result = await session_service.validate_session(
            db=db,
            user_id=str(user.id),
            session_token="not-a-real-token-" + "x" * 16,
        )
    # validate_session returns success=True with valid indicating the result.
    # The invariant we need is: an attacker presenting a bogus token cannot
    # be considered valid, regardless of the success flag semantics.
    assert result.get("valid") is False, result


@pytest.mark.asyncio
async def test_V01B_validate_session_endpoint_accepts_valid_token(
    patched_auth_factories, create_user
):
    """Validate-session must return valid=True for a live session token."""
    from app.services.session_service import session_service

    user, token = await create_user(username="bob_v01b", is_active=True)
    async with patched_auth_factories() as db:
        result = await session_service.validate_session(
            db=db,
            user_id=str(user.id),
            session_token=token,
        )
    assert result.get("valid") is True, result


# ===========================================================================
# V01-C — storage_files_router ownership enforcement
# ===========================================================================


def _make_file(storage_root: Path, relative: str, content: bytes = b"hello") -> Path:
    """Create a file under ``storage_root`` and return the absolute path."""
    target = storage_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


@pytest.mark.asyncio
async def test_V01C_anonymous_returns_401(patched_auth_factories, tmp_path):
    """Anonymous GET /api/storage/files/<anything> → 401."""
    _make_file(tmp_path, "video/foo.mp4")
    app = _build_storage_files_app(tmp_path)
    client = TestClient(app)
    resp = client.get("/api/storage/files/video/foo.mp4")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_V01C_owner_can_read_own_file(
    patched_auth_factories, create_user, tmp_path
):
    """User A authenticated → GET /api/storage/files/.../user_<A>/... → 200."""
    user, token = await create_user(username="carol", is_active=True)
    rel = f"video/2026/05/20/user_{user.id}/clip.mp4"
    _make_file(tmp_path, rel, b"clip-bytes")
    app = _build_storage_files_app(tmp_path)
    client = TestClient(app)
    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content == b"clip-bytes"
    # X-Content-Type-Options nosniff must be set by the router
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"


@pytest.mark.asyncio
async def test_V01C_non_owner_denied(
    patched_auth_factories, create_user, tmp_path
):
    """User A authenticated → GET .../user_<B>/... → 403 (cross-user)."""
    user_a, token_a = await create_user(username="dan", is_active=True)
    user_b, _token_b = await create_user(username="erin", is_active=True)
    rel = f"video/2026/05/20/user_{user_b.id}/clip.mp4"
    _make_file(tmp_path, rel, b"bytes")
    app = _build_storage_files_app(tmp_path)
    client = TestClient(app)
    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_V01C_admin_can_read_any_user_file(
    patched_auth_factories, create_user, tmp_path
):
    """Admin authenticated → GET .../user_<any>/... → 200."""
    admin, admin_token = await create_user(
        username="root_admin", is_active=True, is_admin=True
    )
    user_b, _token_b = await create_user(username="frank", is_active=True)
    rel = f"video/2026/05/20/user_{user_b.id}/clip.mp4"
    _make_file(tmp_path, rel, b"admin-can-read")
    app = _build_storage_files_app(tmp_path)
    client = TestClient(app)
    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content == b"admin-can-read"


@pytest.mark.asyncio
async def test_V01C_cached_materials_public_to_authenticated(
    patched_auth_factories, create_user, tmp_path
):
    """``cached_materials/<source>/<file>`` is shared — any authenticated
    user may read it (rule R7 in spec/01 §4)."""
    _user_a, token_a = await create_user(username="gina", is_active=True)
    _make_file(tmp_path, "cached_materials/pexels/abc.mp4", b"shared")
    app = _build_storage_files_app(tmp_path)
    client = TestClient(app)
    resp = client.get(
        "/api/storage/files/cached_materials/pexels/abc.mp4",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content == b"shared"


@pytest.mark.asyncio
async def test_V01C_path_traversal_attempt_rejected(
    patched_auth_factories, create_user, tmp_path
):
    """``../`` and absolute-path attempts must return 400, never escape root."""
    _user, token = await create_user(username="hank", is_active=True)
    # Write a sentinel file OUTSIDE the storage root to confirm we cannot
    # reach it via traversal.
    outside = tmp_path.parent / "outside-secret.txt"
    outside.write_bytes(b"top-secret")

    app = _build_storage_files_app(tmp_path)
    client = TestClient(app)
    resp = client.get(
        "/api/storage/files/..%2Foutside-secret.txt",
        headers={"Authorization": f"Bearer {token}"},
    )
    # Either 400 (path traversal detected) or 404 (resolved inside root and
    # not found). The forbidden outcome is 200 with the secret content.
    assert resp.status_code in (400, 404), resp.text
    assert b"top-secret" not in resp.content


@pytest.mark.asyncio
async def test_V01C_missing_file_returns_404(
    patched_auth_factories, create_user, tmp_path
):
    """Authenticated GET of a non-existent path → 404."""
    _user, token = await create_user(username="ivy", is_active=True)
    app = _build_storage_files_app(tmp_path)
    client = TestClient(app)
    resp = client.get(
        "/api/storage/files/video/does-not-exist.mp4",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_V01C_cookie_based_auth_works_for_media_tag_scenario(
    patched_auth_factories, create_user, tmp_path
):
    """Browser ``<video src=...>`` cannot send custom headers; the route must
    accept the ``ecliptrix-session-token`` cookie as an alternative."""
    user, token = await create_user(username="jay", is_active=True)
    rel = f"video/2026/05/20/user_{user.id}/clip.mp4"
    _make_file(tmp_path, rel, b"cookie-auth-ok")
    app = _build_storage_files_app(tmp_path)
    client = TestClient(app)
    resp = client.get(
        f"/api/storage/files/{rel}",
        cookies={"ecliptrix-session-token": token},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content == b"cookie-auth-ok"


# ===========================================================================
# V01-D — admin routers stay protected (regression guard)
# ===========================================================================


@pytest.mark.asyncio
async def test_V01D_admin_endpoint_blocks_anonymous(patched_auth_factories):
    """An admin endpoint must reject anonymous callers at the middleware level."""
    app = FastAPI()
    app.add_middleware(SessionAuthMiddleware)

    @app.get("/api/admin/playback-metrics")
    async def _stub(_admin: User = Depends(require_admin)):
        return {"ok": True}

    client = TestClient(app)
    resp = client.get("/api/admin/playback-metrics")
    assert resp.status_code == 401
    body = resp.json()
    assert body.get("error_code") == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_V01D_admin_endpoint_blocks_non_admin(
    patched_auth_factories, create_user
):
    """Authenticated regular user → 403 from require_admin."""
    _user, token = await create_user(username="kara", is_active=True, is_admin=False)
    app = FastAPI()
    app.add_middleware(SessionAuthMiddleware)

    @app.get("/api/admin/playback-metrics")
    async def _stub(_admin: User = Depends(require_admin)):
        return {"ok": True}

    client = TestClient(app)
    resp = client.get(
        "/api/admin/playback-metrics",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_V01D_admin_endpoint_allows_admin(
    patched_auth_factories, create_user
):
    """Authenticated admin → 200."""
    _admin, token = await create_user(username="lina", is_active=True, is_admin=True)
    app = FastAPI()
    app.add_middleware(SessionAuthMiddleware)

    @app.get("/api/admin/playback-metrics")
    async def _stub(_admin: User = Depends(require_admin)):
        return {"ok": True}

    client = TestClient(app)
    resp = client.get(
        "/api/admin/playback-metrics",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True}
