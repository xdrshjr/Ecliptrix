"""
End-to-end integration tests for the rate-limit middleware (spec 02 + 03).

Drives the REAL ``RateLimitMiddleware`` over a ``TestClient`` with a tiny
auth-substitute middleware that mirrors what ``SessionAuthMiddleware`` does
(set ``request.state.user`` when a ``X-Test-User`` header is present), so we
exercise the real identity-selection / category-bucketing / 429-wire path
WITHOUT pulling in the DB-backed auth lookup.

Registration order mirrors production LIFO (spec §2.5 / R5): we register
``RateLimitMiddleware`` FIRST and the auth-substitute AFTER it, so execution
order is ``Auth → RateLimit`` and the limiter can read ``request.state.user``.

Config is injected by stubbing ``rate_limit_config_provider.get_config`` to
return a low-limit :class:`RateLimitConfig` (e.g. normal=3) so 429 trips fast
without firing hundreds of requests.

Asserts the full 429 contract: status 429, integer ``Retry-After`` >= 1,
``X-RateLimit-*`` headers, body ``error_code="rate_limit.exceeded"`` inside the
standard ``ErrorResponse`` shape, independent per-category buckets, per-user vs
per-IP identity, auth per-IP, ``enabled=false`` passthrough, media high quota.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from app.middleware.rate_limit_middleware import RateLimitMiddleware
from app.services import rate_limit_config as cfg_module
from app.services.rate_limit_config import RateLimitConfig, RateLimitLimits
from app.services.rate_limiter import rate_limiter


# ---------------------------------------------------------------------------
# Auth substitute: set request.state.user from a header (mirrors SessionAuth).
# ---------------------------------------------------------------------------
class _AuthSubstituteMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        uid = request.headers.get("x-test-user")
        if uid:
            request.state.user = SimpleNamespace(id=uid)
        return await call_next(request)


def _build_app() -> FastAPI:
    app = FastAPI()

    # LIFO: register RateLimit FIRST so it is INNER; auth-substitute AFTER so it
    # is OUTER and runs first → execution order Auth → RateLimit.
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(_AuthSubstituteMiddleware)

    @app.get("/api/workflow/list")
    async def normal_ep():
        return {"ok": True}

    @app.post("/api/tts/synthesize")
    async def ai_ep():
        return {"ok": True}

    @app.post("/api/auth/login")
    async def auth_ep():
        return {"ok": True}

    @app.get("/api/audio/generated/{name:path}")
    async def media_ep(name: str):
        return {"ok": True, "name": name}

    return app


def _config(**overrides) -> RateLimitConfig:
    """Low-limit config; override any field. Defaults trip 429 quickly."""
    limits = RateLimitLimits(
        normal_user=overrides.pop("normal_user", 3),
        normal_ip=overrides.pop("normal_ip", 3),
        ai_generation=overrides.pop("ai_generation", 2),
        auth_ip=overrides.pop("auth_ip", 2),
        media_serving=overrides.pop("media_serving", 6000),
    )
    return RateLimitConfig(
        enabled=overrides.pop("enabled", True),
        window_seconds=overrides.pop("window_seconds", 60),
        limits=limits,
    )


@pytest_asyncio.fixture(autouse=True)
async def reset_limiter():
    await rate_limiter.reset()
    yield
    await rate_limiter.reset()


@pytest.fixture
def patch_config(monkeypatch):
    """Return a setter that stubs the provider to a fixed config."""

    def _set(config: RateLimitConfig):
        async def _get_config():
            return config

        monkeypatch.setattr(
            cfg_module.rate_limit_config_provider, "get_config", _get_config
        )
        # The middleware imports the singleton by reference; patch that too.
        from app.middleware import rate_limit_middleware as mw_module

        monkeypatch.setattr(
            mw_module.rate_limit_config_provider, "get_config", _get_config
        )

    return _set


# ---------------------------------------------------------------------------
# normal over-limit → 429 + full contract (same-user)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_normal_user_over_limit_returns_429(patch_config):
    patch_config(_config(normal_user=3))
    app = _build_app()
    client = TestClient(app)
    h = {"x-test-user": "u1"}

    # First 3 allowed.
    for _ in range(3):
        r = client.get("/api/workflow/list", headers=h)
        assert r.status_code == 200
        assert r.headers.get("X-RateLimit-Limit") == "3"

    # 4th denied with the full 429 contract.
    r = client.get("/api/workflow/list", headers=h)
    assert r.status_code == 429
    retry_after = r.headers.get("Retry-After")
    assert retry_after is not None and int(retry_after) >= 1
    assert r.headers.get("X-RateLimit-Limit") == "3"
    assert r.headers.get("X-RateLimit-Remaining") == "0"

    body = r.json()
    # Standard ErrorResponse shape.
    assert body["success"] is False
    assert body["error_code"] == "rate_limit.exceeded"
    assert "message" in body and body["message"]
    assert "timestamp" in body
    assert body["error_details"]["retry_after"] == int(retry_after)
    assert body["error_details"]["limit"] == 3


# ---------------------------------------------------------------------------
# ai_generation trips earlier and is an independent bucket
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ai_trips_earlier_and_independent_bucket(patch_config):
    patch_config(_config(normal_user=10, ai_generation=2))
    app = _build_app()
    client = TestClient(app)
    h = {"x-test-user": "u1"}

    # ai_generation limit is 2 → 3rd is 429.
    assert client.post("/api/tts/synthesize", headers=h).status_code == 200
    assert client.post("/api/tts/synthesize", headers=h).status_code == 200
    assert client.post("/api/tts/synthesize", headers=h).status_code == 429

    # The normal bucket for the SAME user is untouched (independent category).
    assert client.get("/api/workflow/list", headers=h).status_code == 200


# ---------------------------------------------------------------------------
# auth category is per-IP (shared across different users from same IP)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_auth_is_per_ip(patch_config):
    patch_config(_config(auth_ip=2))
    app = _build_app()
    client = TestClient(app)

    # Same IP (TestClient default), even with DIFFERENT user headers, shares the
    # auth bucket because auth is forced per-IP.
    assert client.post("/api/auth/login", headers={"x-test-user": "a"}).status_code == 200
    assert client.post("/api/auth/login", headers={"x-test-user": "b"}).status_code == 200
    assert client.post("/api/auth/login", headers={"x-test-user": "c"}).status_code == 429


# ---------------------------------------------------------------------------
# per-user vs per-IP identity (proves Auth→RateLimit order works, R5)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_per_user_vs_per_ip_identity(patch_config):
    # normal_user is generous (100), normal_ip is tight (1). A logged-in user
    # uses normal_user; an anonymous request uses normal_ip.
    patch_config(_config(normal_user=100, normal_ip=1))
    app = _build_app()
    client = TestClient(app)

    # Anonymous: 2nd request exceeds normal_ip=1.
    assert client.get("/api/workflow/list").status_code == 200
    assert client.get("/api/workflow/list").status_code == 429

    # Logged-in user: many requests fit under normal_user=100.
    for _ in range(5):
        assert (
            client.get("/api/workflow/list", headers={"x-test-user": "u9"}).status_code
            == 200
        )


@pytest.mark.asyncio
async def test_distinct_users_have_independent_buckets(patch_config):
    patch_config(_config(normal_user=1))
    app = _build_app()
    client = TestClient(app)

    assert client.get("/api/workflow/list", headers={"x-test-user": "x"}).status_code == 200
    # user x is now over limit
    assert client.get("/api/workflow/list", headers={"x-test-user": "x"}).status_code == 429
    # user y is independent
    assert client.get("/api/workflow/list", headers={"x-test-user": "y"}).status_code == 200


# ---------------------------------------------------------------------------
# enabled=false → full passthrough (no counting, no headers)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_disabled_config_passes_through(patch_config):
    patch_config(_config(enabled=False, normal_user=1, normal_ip=1, ai_generation=1))
    app = _build_app()
    client = TestClient(app)
    h = {"x-test-user": "u1"}

    for _ in range(5):
        r = client.get("/api/workflow/list", headers=h)
        assert r.status_code == 200
        assert "X-RateLimit-Limit" not in r.headers
    # ai endpoint with limit 1 also passes through repeatedly.
    for _ in range(5):
        assert client.post("/api/tts/synthesize", headers=h).status_code == 200


# ---------------------------------------------------------------------------
# media_serving high quota → playback not interrupted
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_media_serving_high_quota_not_interrupted(patch_config):
    patch_config(_config(media_serving=6000))
    app = _build_app()
    client = TestClient(app)

    # Many rapid media requests (mirrors video Range chunking) all succeed.
    for i in range(30):
        r = client.get(f"/api/audio/generated/seg-{i}.mp3")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# OPTIONS preflight is never counted
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_options_not_counted(patch_config):
    patch_config(_config(normal_user=1, normal_ip=1))
    app = _build_app()
    client = TestClient(app)

    # Several OPTIONS do not consume the budget.
    for _ in range(5):
        client.options("/api/workflow/list")
    # A real GET still gets its 1 allowed slot.
    assert client.get("/api/workflow/list").status_code == 200


# ---------------------------------------------------------------------------
# window recovery over the wire (real short window)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_window_recovery_over_the_wire(patch_config):
    import asyncio

    patch_config(_config(normal_ip=1, window_seconds=1))
    app = _build_app()
    client = TestClient(app)

    assert client.get("/api/workflow/list").status_code == 200
    assert client.get("/api/workflow/list").status_code == 429
    await asyncio.sleep(1.1)
    assert client.get("/api/workflow/list").status_code == 200
