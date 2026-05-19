"""
Tests for CORS hardening + SecurityHeadersMiddleware (spec 02).

Covers:
  V02-A — CORS allowlist replaces ``allow_origins=['*']`` + credentials anti-pattern.
  V02-B — SecurityHeadersMiddleware attaches X-Content-Type-Options / X-Frame-Options /
           Referrer-Policy / Permissions-Policy / HSTS (prod-only).

Strategy
--------
Mirrors ``test_auth_middleware.py``: we DO NOT import ``app.main`` (it would
pull in cv2/ffmpeg/etc.). Instead each test builds a minimal FastAPI app that
wires up CORSMiddleware + SecurityHeadersMiddleware using the SAME helper
that ``app.main`` will use after the spec 02 patches land (see the
``_build_cors_origins`` helper below — kept in lock-step with the patch in the
summary doc).
"""

from __future__ import annotations

from typing import List

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.config import settings as _settings
from app.middleware.security_headers import SecurityHeadersMiddleware


# ---------------------------------------------------------------------------
# Mirror of the helper used in app/main.py (kept in summary "main.py patches"
# section). The duplication is intentional: importing app.main pulls cv2.
# ---------------------------------------------------------------------------

_DEV_LOCALHOST_ORIGINS: tuple[str, ...] = (
    "http://localhost:3000",
    "http://localhost:3010",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3010",
)


def _build_cors_origins(env_marker: str, configured: list[str]) -> list[str]:
    """Compose the final allow_origins list for CORSMiddleware.

    Production: exactly what is in CORS_ALLOWED_ORIGINS (may be empty → deny).
    Dev/staging: also include localhost / 127.0.0.1 fallbacks.
    """
    env_lc = (env_marker or "production").lower()
    if env_lc in ("development", "dev"):
        merged = list(dict.fromkeys(list(configured) + list(_DEV_LOCALHOST_ORIGINS)))
        return merged
    return list(configured)


def _build_app(
    env_marker: str,
    cors_allowed_origins: list[str],
    *,
    legacy_wildcard: bool = False,
    monkeypatch: pytest.MonkeyPatch | None = None,
) -> FastAPI:
    """Build a minimal FastAPI app matching the post-patch main.py wiring.

    Order matches the production main.py change documented in the spec 02
    summary doc: SessionAuth (omitted here — not under test) → CORS → Security.
    Starlette ``add_middleware`` is LIFO, so the LAST added is OUTERMOST.
    We therefore add CORS first, then SecurityHeadersMiddleware second — the
    same way production will register them. The headers wrapper sits OUTSIDE
    of CORS, which is correct: it observes the final response and only sets
    headers that CORS did not already set.
    """
    # The SecurityHeadersMiddleware reads settings.env at request time. Patch it
    # for the duration of the test so we can exercise prod vs dev behavior
    # without re-importing config.
    if monkeypatch is not None:
        monkeypatch.setattr(_settings, "env", env_marker, raising=False)

    app = FastAPI()

    if legacy_wildcard:
        # Rollback path — preserved for ops emergencies only.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        origins = _build_cors_origins(env_marker, cors_allowed_origins)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
            allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
        )

    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/api/health")
    async def health():
        return {"success": True, "status": "healthy"}

    @app.get("/docs")
    async def fake_docs():
        # Stand-in for the Swagger UI route — used only to verify the
        # X-Frame-Options exemption.
        return {"swagger": "stand-in"}

    return app


# ---------------------------------------------------------------------------
# V02-A — CORS allowlist behavior
# ---------------------------------------------------------------------------


def test_dev_localhost_origin_preflight_succeeds(monkeypatch):
    """Dev env: OPTIONS preflight from http://localhost:3000 must be allowed."""
    app = _build_app("development", [], monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert resp.headers.get("access-control-allow-credentials") == "true"


def test_dev_localhost_simple_get_includes_acao(monkeypatch):
    """Dev env: actual GET from localhost:3010 echoes the origin back."""
    app = _build_app("development", [], monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "http://localhost:3010"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3010"


def test_prod_configured_origin_allowed(monkeypatch):
    """Prod env: configured allowlisted origin gets ACAO echoed back."""
    app = _build_app(
        "production",
        ["https://app.example.com"],
        monkeypatch=monkeypatch,
    )
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "https://app.example.com"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://app.example.com"
    assert resp.headers.get("access-control-allow-credentials") == "true"


def test_prod_unauthorized_origin_blocked(monkeypatch):
    """Prod env: evil.com origin gets NO Access-Control-Allow-Origin header.

    This is the V02-A regression test. Pre-fix code echoed ANY Origin back
    when allow_origins=['*'] + allow_credentials=True; post-fix the absence
    of the ACAO response header is what the browser uses to block the
    cross-origin read.
    """
    app = _build_app(
        "production",
        ["https://app.example.com"],
        monkeypatch=monkeypatch,
    )
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "https://evil.example.com"},
    )
    # Same-origin handling: endpoint itself still returns 200 (CORS is
    # advisory; the server processes the request but does not advertise that
    # cross-origin reads are permitted).
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in {
        k.lower() for k in resp.headers.keys()
    }


def test_prod_empty_allowlist_denies_cross_origin(monkeypatch):
    """Prod env with empty CORS_ALLOWED_ORIGINS: no ACAO header at all."""
    app = _build_app("production", [], monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "https://app.example.com"},
    )
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in {
        k.lower() for k in resp.headers.keys()
    }


def test_same_origin_request_works(monkeypatch):
    """No Origin header (same-origin) — endpoint still works."""
    app = _build_app("production", [], monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"success": True, "status": "healthy"}


def test_legacy_wildcard_rollback_still_works(monkeypatch):
    """Emergency rollback path keeps the old wildcard behavior."""
    app = _build_app(
        "production",
        [],
        legacy_wildcard=True,
        monkeypatch=monkeypatch,
    )
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "https://anything.example.com"},
    )
    assert resp.status_code == 200
    # Legacy wildcard either echoes the Origin (FastAPI behavior with
    # credentials=True) or returns "*". Either way, it advertises CORS access.
    acao = resp.headers.get("access-control-allow-origin")
    assert acao is not None


# ---------------------------------------------------------------------------
# V02-B — Security response headers
# ---------------------------------------------------------------------------


def test_security_headers_present_on_every_response(monkeypatch):
    """All four always-on security headers must be on every response."""
    app = _build_app("production", [], monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("x-frame-options") == "DENY"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert (
        resp.headers.get("permissions-policy")
        == "camera=(), microphone=(), geolocation=()"
    )


def test_hsts_only_in_production(monkeypatch):
    """Strict-Transport-Security must only ship in production env."""
    app = _build_app("production", [], monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get("/api/health")
    hsts = resp.headers.get("strict-transport-security")
    assert hsts is not None
    assert "max-age=31536000" in hsts


def test_hsts_absent_in_development(monkeypatch):
    """Dev environment must NOT emit HSTS (untrusted certs / localhost)."""
    app = _build_app("development", [], monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get("/api/health")
    assert "strict-transport-security" not in {
        k.lower() for k in resp.headers.keys()
    }


def test_docs_path_skips_x_frame_options(monkeypatch):
    """Swagger / ReDoc paths skip X-Frame-Options so they can iframe assets."""
    app = _build_app("production", [], monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get("/docs")
    assert resp.status_code == 200
    # Other headers should still be present.
    assert resp.headers.get("x-content-type-options") == "nosniff"
    # X-Frame-Options must be omitted on /docs.
    assert "x-frame-options" not in {k.lower() for k in resp.headers.keys()}


# ---------------------------------------------------------------------------
# Cross-cutting — V02-A + V02-B together
# ---------------------------------------------------------------------------


def test_cors_and_security_headers_coexist(monkeypatch):
    """A single response should carry BOTH CORS and security headers cleanly."""
    app = _build_app(
        "production",
        ["https://app.example.com"],
        monkeypatch=monkeypatch,
    )
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "https://app.example.com"},
    )
    assert resp.status_code == 200
    # CORS
    assert resp.headers.get("access-control-allow-origin") == "https://app.example.com"
    # Security
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("x-frame-options") == "DENY"
    assert resp.headers.get("strict-transport-security") is not None
