"""
Tests for SessionAuthMiddleware (spec 01-backend-auth-middleware §6).

Covers cases T1-T12, T14, T15. T13 (concurrency) is the optional stretch goal
in the spec and is intentionally skipped.

Strategy
--------
We avoid importing ``app.main`` so that this test file does not pull in heavy
optional dependencies (cv2, ffmpeg, etc.). Instead we build a minimal FastAPI
``app`` per test that:
  1. Registers ``SessionAuthMiddleware`` directly
  2. Mounts a tiny set of ``/api/...`` endpoints that mirror the routes the
     middleware needs to make decisions about
  3. Patches ``app.middleware.auth_middleware.async_session_factory`` to point
     at the in-memory SQLite engine created by the ``db_session`` fixture

The patched session factory is the only piece of glue required: the middleware
itself is exercised exactly as it will run in production.
"""

from __future__ import annotations

import asyncio
import secrets
from typing import AsyncGenerator, Tuple

import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.dependencies.auth import get_current_user, require_admin
from app.middleware import auth_middleware as auth_middleware_module
from app.middleware.auth_middleware import (
    ALLOWLIST_EXACT,
    ALLOWLIST_PREFIX,
    SessionAuthMiddleware,
)
from app.models.db_models import Base, User


TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def session_factory_and_engine() -> AsyncGenerator[Tuple[async_sessionmaker, object], None]:
    """Create an in-memory SQLite engine + session factory for one test.

    Yields ``(session_factory, engine)``. The factory is what we patch into
    ``auth_middleware.async_session_factory`` so the middleware queries this
    in-memory DB instead of the real PostgreSQL one.
    """
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        yield factory, engine
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest.fixture(autouse=True)
def enforce_default_deny(monkeypatch):
    """Enable full default-deny enforcement for the middleware-behaviour tests.

    The ``AUTH_ENFORCE_DEFAULT_DENY`` flag (api-authz-rate-limiting spec/01 §5)
    defaults to False in production so the frontend cannot regress before the
    TODO 05 token-carry audit. The classic T3/T4/T6/T15/T18 cases here assert
    the middleware's REJECTION behaviour, which only fires when enforcement is
    on, so we flip the flag to True for the whole module. Flag-OFF passthrough
    is covered separately by the ``test_flag_off_*`` cases at the bottom.
    """
    monkeypatch.setattr(
        auth_middleware_module.settings,
        "auth_enforce_default_deny",
        True,
        raising=False,
    )


@pytest_asyncio.fixture
async def patched_middleware_factory(monkeypatch, session_factory_and_engine):
    """Patch the middleware's session factory to point at the test DB."""
    factory, _engine = session_factory_and_engine
    monkeypatch.setattr(
        auth_middleware_module,
        "async_session_factory",
        factory,
    )
    return factory


def _build_app(session_factory: async_sessionmaker) -> FastAPI:
    """Build a minimal FastAPI app with the middleware wired up.

    The mounted endpoints intentionally mirror the real production paths the
    middleware reasons about (``/api/health``, ``/api/auth/login``,
    ``/api/video/search``, ``/api/storage/files/...``, ``/static/...``,
    ``/api/system-settings/categories``).
    """
    app = FastAPI()

    # Register in the SAME order as production main.py: SessionAuth first,
    # CORS second. LIFO means CORS becomes outermost and answers OPTIONS.
    app.add_middleware(SessionAuthMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    async def health():
        return {"success": True, "status": "healthy"}

    @app.post("/api/auth/login")
    async def login_endpoint():
        # In production this would actually authenticate. For middleware tests
        # we only care that the middleware lets the request through.
        return {"success": True, "data": {"token": "fake"}}

    @app.get("/api/video/search")
    async def video_search(current_user: User = Depends(get_current_user)):
        return {"success": True, "user_id": str(current_user.id)}

    @app.get("/api/storage/files/{filename:path}")
    async def storage_file(filename: str):
        return {"success": True, "filename": filename}

    @app.get("/api/audio/generated/{filename:path}")
    async def generated_audio_file(filename: str):
        return {"success": True, "filename": filename}

    @app.get("/api/audio/subtitles/{filename:path}")
    async def subtitle_file(filename: str):
        return {"success": True, "filename": filename}

    @app.get("/static/{path:path}")
    async def static_file(path: str):
        return {"success": True, "path": path}

    @app.get("/api/system-settings/categories")
    async def system_settings(current_user: User = Depends(require_admin)):
        return {"success": True, "categories": []}

    @app.get("/api/storage/files-other")
    async def files_other(current_user: User = Depends(get_current_user)):
        return {"success": True, "data": "needs auth"}

    # An ordinary protected endpoint WITHOUT a get_current_user dependency, so
    # we can observe the middleware's own passthrough/reject decision in
    # isolation (no dependency-layer 401 to confuse the result).
    @app.get("/api/workflow/list")
    async def workflow_list(request: Request):
        cached = getattr(request.state, "user", None)
        return {"success": True, "has_user": cached is not None}

    # A HARD_PROTECT_PATHS endpoint — must be enforced regardless of the flag.
    @app.post("/api/workflow/ai-video-generate")
    async def ai_video_generate(request: Request):
        cached = getattr(request.state, "user", None)
        return {"success": True, "has_user": cached is not None}

    # Allowlisted runtime-config endpoint (spec/01 §3.2 — /api/config/ prefix).
    @app.get("/api/config/playback-flag")
    async def playback_flag():
        return {"success": True, "data": {"enabled": False}}

    return app


async def _create_user(
    session_factory: async_sessionmaker,
    *,
    username: str = "alice",
    is_active: bool = True,
    is_admin: bool = False,
    is_root: bool = False,
) -> Tuple[User, str]:
    """Insert a User row into the test DB and return (user, token)."""
    token = secrets.token_urlsafe(32)
    async with session_factory() as session:
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


# ---------------------------------------------------------------------------
# Allowlist constants sanity check (catches accidental drift from spec §4)
# ---------------------------------------------------------------------------


def test_allowlist_constants_match_spec():
    """Verify the allowlist constants match the api-authz-rate-limiting
    spec/01 §3.2 target (8 exact paths, 5 prefix paths)."""
    assert ALLOWLIST_EXACT == frozenset({
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/validate-session",
        "/api/health",
        "/api/health/",
        "/docs",
        "/redoc",
        "/openapi.json",
    }), "ALLOWLIST_EXACT drifted from spec/01 §3.2"
    assert ALLOWLIST_PREFIX == (
        "/static/",
        "/api/storage/files/",
        "/api/audio/generated/",
        "/api/audio/subtitles/",
        "/api/config/",
    ), (
        "ALLOWLIST_PREFIX drifted from spec/01 §3.2 (Phase 3.7 added the 2 "
        "audio mounts; api-authz-rate-limiting T01 added /api/config/)"
    )


# ---------------------------------------------------------------------------
# Test cases T1 - T12 + T14 + T15 (per spec §6)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_T1_health_no_headers_returns_200(patched_middleware_factory):
    """T1: GET /api/health no headers → 200."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


@pytest.mark.asyncio
async def test_T2_login_no_headers_passes_through(patched_middleware_factory):
    """T2: POST /api/auth/login no headers → router decides (200 here)."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.post("/api/auth/login")
    assert response.status_code == 200, (
        "/api/auth/login is in the allowlist; middleware must let it through"
    )


@pytest.mark.asyncio
async def test_T3_video_search_no_token_returns_401(patched_middleware_factory):
    """T3: GET /api/video/search no headers → 401 + UNAUTHORIZED."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/video/search")
    assert response.status_code == 401
    body = response.json()
    assert body["success"] is False
    assert body["error_code"] == "UNAUTHORIZED"
    assert body["error_details"]["reason"] == "Missing session token"


@pytest.mark.asyncio
async def test_T4_video_search_invalid_bearer_returns_401(
    patched_middleware_factory,
):
    """T4: GET /api/video/search with Bearer invalid → 401 + UNAUTHORIZED."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/video/search",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert response.status_code == 401
    body = response.json()
    assert body["error_code"] == "UNAUTHORIZED"
    assert body["error_details"]["reason"] == "Invalid or expired session token"


@pytest.mark.asyncio
async def test_T5_video_search_valid_bearer_returns_200(
    patched_middleware_factory,
):
    """T5: GET /api/video/search with valid token → 200 with user injected."""
    user, token = await _create_user(
        patched_middleware_factory, username="bob", is_active=True
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/video/search",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["user_id"] == str(user.id), (
        "request.state.user should have been populated and consumed by "
        "get_current_user via the fast-path"
    )


@pytest.mark.asyncio
async def test_T6_inactive_user_returns_403_account_disabled(
    patched_middleware_factory,
):
    """T6: valid token but is_active=False → 403 + ACCOUNT_DISABLED."""
    _user, token = await _create_user(
        patched_middleware_factory, username="carol", is_active=False
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/video/search",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error_code"] == "ACCOUNT_DISABLED"
    assert body["error_details"]["reason"] == "User account is disabled"


@pytest.mark.asyncio
async def test_T7_legacy_x_session_token_header_works(
    patched_middleware_factory,
):
    """T7: legacy X-Session-Token header is still accepted → 200."""
    user, token = await _create_user(
        patched_middleware_factory, username="dave", is_active=True
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/video/search",
        headers={"x-session-token": token},
    )
    assert response.status_code == 200
    assert response.json()["user_id"] == str(user.id)


@pytest.mark.asyncio
async def test_T7b_raw_authorization_header_legacy_works(
    patched_middleware_factory,
):
    """T7 variant: legacy raw Authorization header (no Bearer) still works."""
    user, token = await _create_user(
        patched_middleware_factory, username="eve", is_active=True
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/video/search",
        headers={"Authorization": token},
    )
    assert response.status_code == 200
    assert response.json()["user_id"] == str(user.id)


@pytest.mark.asyncio
async def test_T8_options_preflight_passes(patched_middleware_factory):
    """T8: OPTIONS /api/video/search no auth → CORS preflight returns 200."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.options(
        "/api/video/search",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    # CORS middleware answers preflight; auth middleware also short-circuits
    # OPTIONS defensively. Either way, status is 200/204 — never 401.
    assert response.status_code in (200, 204)
    assert response.status_code != 401


@pytest.mark.asyncio
async def test_T9_static_path_passes_without_auth(patched_middleware_factory):
    """T9: GET /static/test.png no auth → middleware passes (router 200)."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/static/test.png")
    # No 401 — middleware lets it through. Router returns 200.
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_T10_storage_files_passes_without_auth(
    patched_middleware_factory,
):
    """T10: GET /api/storage/files/foo.jpg no auth → passthrough."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/storage/files/foo.jpg")
    assert response.status_code == 200
    assert response.json()["filename"] == "foo.jpg"


@pytest.mark.asyncio
async def test_T11_admin_user_can_reach_admin_endpoint(
    patched_middleware_factory,
):
    """T11: admin user → 200 on /api/system-settings/categories."""
    user, token = await _create_user(
        patched_middleware_factory,
        username="admin1",
        is_active=True,
        is_admin=True,
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/system-settings/categories",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["categories"] == []


@pytest.mark.asyncio
async def test_T12_non_admin_blocked_by_require_admin(
    patched_middleware_factory,
):
    """T12: non-admin user → 403 (require_admin still enforced after middleware)."""
    _user, token = await _create_user(
        patched_middleware_factory,
        username="regular1",
        is_active=True,
        is_admin=False,
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/system-settings/categories",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    # The body envelope is FORBIDDEN from require_admin, NOT ACCOUNT_DISABLED.
    body = response.json()
    assert "error_code" in body or body.get("detail") is not None


@pytest.mark.asyncio
async def test_T14_storage_files_prefix_match_nested_path(
    patched_middleware_factory,
):
    """T14: GET /api/storage/files/sub/dir/file.jpg → passthrough (prefix match)."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/storage/files/sub/dir/file.jpg")
    assert response.status_code == 200
    assert response.json()["filename"] == "sub/dir/file.jpg"


@pytest.mark.asyncio
async def test_T15_files_other_path_requires_auth(patched_middleware_factory):
    """T15: GET /api/storage/files-other → requires auth (prefix MUST NOT match)."""
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/storage/files-other")
    assert response.status_code == 401
    body = response.json()
    assert body["error_code"] == "UNAUTHORIZED", (
        "files-other has the same prefix without trailing slash; the trailing "
        "slash in /api/storage/files/ is significant"
    )


@pytest.mark.asyncio
async def test_T16_generated_audio_prefix_passthrough(patched_middleware_factory):
    """T16 (Phase 3.7): GET /api/audio/generated/foo.mp3 no auth → passthrough.

    Static-mount allowlist regression test for the bug found on dev server
    2026-04-07: <audio src='/api/audio/generated/...'> requests cannot send
    Authorization headers, so the middleware MUST allowlist this prefix.
    """
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/audio/generated/agent-segment-0_concatenated_1.mp3")
    assert response.status_code == 200
    assert response.json()["filename"] == "agent-segment-0_concatenated_1.mp3"


@pytest.mark.asyncio
async def test_T17_subtitle_prefix_passthrough(patched_middleware_factory):
    """T17 (Phase 3.7): GET /api/audio/subtitles/foo.srt no auth → passthrough.

    Companion to T16 — the second audio static mount must also be allowlisted.
    """
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/audio/subtitles/agent-segment-0.srt")
    assert response.status_code == 200
    assert response.json()["filename"] == "agent-segment-0.srt"


@pytest.mark.asyncio
async def test_T18_audio_prefix_lookalike_requires_auth(
    patched_middleware_factory,
):
    """T18 (Phase 3.7): GET /api/audio/something-else → requires auth.

    Trailing-slash discipline: only the /api/audio/generated/ and
    /api/audio/subtitles/ prefixes are allowlisted. Anything else under
    /api/audio/* (e.g. /api/audio/transcribe) must still go through auth.
    """
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    # Register a sibling endpoint that's NOT a static mount
    response = client.get("/api/audio/transcribe")
    assert response.status_code == 401
    body = response.json()
    assert body["error_code"] == "UNAUTHORIZED"


# ---------------------------------------------------------------------------
# Extra branch coverage (per spec §3 — get the auth_middleware.py file ≥90%)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_token_mismatch_after_db_lookup_returns_401(
    patched_middleware_factory,
):
    """Defense-in-depth: blanking the user's session token between read and
    constant-time comparison should not happen in practice, but the branch
    must exist. We exercise the ``user.active_session_token is None`` check
    by directly nulling the column after the row was created with a token."""
    user, token = await _create_user(
        patched_middleware_factory, username="frank", is_active=True
    )
    # Wipe the token in the DB so the WHERE clause can no longer find the row
    # via that exact value — the lookup returns None, which is a 401 path.
    async with patched_middleware_factory() as session:
        db_user = await session.get(User, user.id)
        db_user.active_session_token = None
        await session.commit()
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/video/search",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 401
    body = response.json()
    assert body["error_code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_constant_time_mismatch_branch_returns_401(
    patched_middleware_factory,
    monkeypatch,
):
    """Force the defensive ``hmac.compare_digest`` branch to fail.

    In normal operation the WHERE clause has already matched the row exactly
    so the constant-time check is redundant. We monkeypatch ``compare_digest``
    in the middleware module to always return False so the defensive 401 path
    runs and is covered."""
    _user, token = await _create_user(
        patched_middleware_factory, username="hank", is_active=True
    )
    monkeypatch.setattr(
        auth_middleware_module.hmac,
        "compare_digest",
        lambda a, b: False,
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/video/search",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 401
    body = response.json()
    assert body["error_code"] == "UNAUTHORIZED"
    assert body["error_details"]["reason"] == "Token mismatch"


@pytest.mark.asyncio
async def test_get_current_user_fast_path_avoids_db_query(
    patched_middleware_factory,
    monkeypatch,
):
    """When middleware has set request.state.user, get_current_user must not
    re-query the database. We assert this by spying on the session factory."""
    user, token = await _create_user(
        patched_middleware_factory, username="grace", is_active=True
    )

    # Wrap the factory in a counter so we can verify it's called exactly once
    # per request (i.e. only by the middleware, NOT also by get_current_user).
    call_count = {"n": 0}
    original = patched_middleware_factory

    def counting_factory(*args, **kwargs):
        call_count["n"] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(
        auth_middleware_module,
        "async_session_factory",
        counting_factory,
    )

    app = _build_app(counting_factory)
    client = TestClient(app)
    response = client.get(
        "/api/video/search",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert call_count["n"] == 1, (
        "Expected exactly one DB session open per request (by the middleware); "
        "get_current_user fast-path must not open another."
    )


# ---------------------------------------------------------------------------
# AUTH_ENFORCE_DEFAULT_DENY flag behaviour (api-authz-rate-limiting spec/01 §5)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flag_off_ordinary_path_passes_through_without_token(
    patched_middleware_factory, monkeypatch
):
    """Flag OFF: a non-allowlisted, non-hard-protected path with NO token must
    pass through (no middleware 401) so the FE cannot regress pre-TODO-05."""
    monkeypatch.setattr(
        auth_middleware_module.settings, "auth_enforce_default_deny", False, raising=False
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/workflow/list")
    assert response.status_code == 200
    assert response.json()["has_user"] is False, (
        "no token present, so request.state.user must stay unset"
    )


@pytest.mark.asyncio
async def test_flag_off_invalid_token_passes_through(
    patched_middleware_factory, monkeypatch
):
    """Flag OFF: an invalid token on an ordinary path passes through with no
    user injected (the middleware does not reject, downstream may)."""
    monkeypatch.setattr(
        auth_middleware_module.settings, "auth_enforce_default_deny", False, raising=False
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/workflow/list", headers={"Authorization": "Bearer bogus-token"}
    )
    assert response.status_code == 200
    assert response.json()["has_user"] is False


@pytest.mark.asyncio
async def test_flag_off_valid_token_still_injects_user(
    patched_middleware_factory, monkeypatch
):
    """Flag OFF: a VALID token is still resolved and injected, so authenticated
    requests behave identically whether the flag is on or off (no regression)."""
    monkeypatch.setattr(
        auth_middleware_module.settings, "auth_enforce_default_deny", False, raising=False
    )
    _user, token = await _create_user(
        patched_middleware_factory, username="ivy", is_active=True
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get(
        "/api/workflow/list", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.json()["has_user"] is True, (
        "valid token must populate request.state.user even with the flag off"
    )


@pytest.mark.asyncio
async def test_flag_off_hard_protected_path_still_enforced(
    patched_middleware_factory, monkeypatch
):
    """Flag OFF: HARD_PROTECT_PATHS must STILL reject anonymous requests — the
    spec mandates these are never weakened (defence in depth)."""
    monkeypatch.setattr(
        auth_middleware_module.settings, "auth_enforce_default_deny", False, raising=False
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.post("/api/workflow/ai-video-generate")
    assert response.status_code == 401
    body = response.json()
    assert body["error_code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_config_prefix_allowlisted_passthrough(
    patched_middleware_factory, monkeypatch
):
    """/api/config/ prefix is allowlisted (spec/01 §3.2): anonymous GET on
    /api/config/playback-flag must pass through regardless of the flag."""
    monkeypatch.setattr(
        auth_middleware_module.settings, "auth_enforce_default_deny", True, raising=False
    )
    app = _build_app(patched_middleware_factory)
    client = TestClient(app)
    response = client.get("/api/config/playback-flag")
    assert response.status_code == 200
    assert response.json()["data"]["enabled"] is False
