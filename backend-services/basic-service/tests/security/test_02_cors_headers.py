"""
Tests for the CORS allowlist + SecurityHeadersMiddleware.

After `desktop-only-refactor` there is no deployment-environment marker and no
emergency wildcard switch. The allowlist is exactly
``CORS_ALLOWED_ORIGINS`` (which the Electron main process fills with the
frontend port it actually resolved) plus a fixed set of dev fallbacks, and the
headers middleware emits three headers — ``X-Frame-Options`` and HSTS were
dropped as meaningless on a loopback ``http://`` origin.

Strategy
--------
We DO NOT import ``app.main`` (it would pull in cv2/ffmpeg/etc.). Instead each
test builds a minimal FastAPI app wiring CORSMiddleware +
SecurityHeadersMiddleware exactly the way ``app.main`` does. The origin list
helper below mirrors ``app.main._DEV_FALLBACK_ORIGINS`` — the duplication is
intentional and the two MUST stay in sync.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.middleware.security_headers import SecurityHeadersMiddleware


# Mirror of ``app.main._DEV_FALLBACK_ORIGINS``.
_DEV_FALLBACK_ORIGINS: tuple[str, ...] = (
    "http://localhost:3000",
    "http://localhost:3010",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3010",
    "http://localhost:18320",
    "http://127.0.0.1:18320",
)


def _build_app(configured_origins: list[str]) -> FastAPI:
    """Build a minimal app matching the production main.py wiring.

    Starlette ``add_middleware`` is LIFO, so the LAST added is OUTERMOST. We
    add CORS first and SecurityHeadersMiddleware second — the same order
    production uses — which puts the headers wrapper OUTSIDE of CORS so it
    observes the final response and only sets headers CORS did not.
    """
    origins = list(
        dict.fromkeys(list(configured_origins) + list(_DEV_FALLBACK_ORIGINS))
    )

    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["Content-Type", "X-Requested-With"],
    )
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/api/health")
    async def health():
        return {"success": True, "status": "healthy"}

    @app.get("/docs")
    async def fake_docs():
        # Stand-in for the Swagger UI route, which is always mounted now.
        return {"swagger": "stand-in"}

    return app


# ---------------------------------------------------------------------------
# CORS allowlist behaviour
# ---------------------------------------------------------------------------


def test_injected_origin_preflight_succeeds():
    """OPTIONS preflight from the injected frontend origin must be allowed."""
    app = _build_app(["http://127.0.0.1:18322"])
    client = TestClient(app)
    resp = client.options(
        "/api/health",
        headers={
            "Origin": "http://127.0.0.1:18322",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:18322"
    assert resp.headers.get("access-control-allow-credentials") == "true"


def test_injected_origin_simple_get_includes_acao():
    """An actual GET from the injected origin echoes the origin back.

    The port matters: ``ports.pickPort`` shifts off 18320 when it is taken, so
    the allowlist must come from the injected value, not a hardcoded literal.
    """
    app = _build_app(["http://127.0.0.1:18322"])
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "http://127.0.0.1:18322"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:18322"


def test_dev_fallback_localhost_origin_allowed():
    """`npm run dev` on :3000 keeps working with an empty env allowlist."""
    app = _build_app([])
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "http://localhost:3000"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_dev_fallback_default_frontend_port_allowed():
    """The default packaged frontend port is in the fallback list."""
    app = _build_app([])
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "http://127.0.0.1:18320"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:18320"


def test_unlisted_origin_blocked():
    """An origin outside the allowlist gets NO Access-Control-Allow-Origin.

    The absence of the ACAO response header is what the browser uses to block
    the cross-origin read; the endpoint itself still answers 200 because CORS
    is advisory.
    """
    app = _build_app(["http://127.0.0.1:18320"])
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "https://evil.example.com"},
    )
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in {
        k.lower() for k in resp.headers.keys()
    }


def test_unlisted_origin_preflight_is_not_advertised():
    """A preflight from an unlisted origin must not advertise access."""
    app = _build_app(["http://127.0.0.1:18320"])
    client = TestClient(app)
    resp = client.options(
        "/api/health",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in {
        k.lower() for k in resp.headers.keys()
    }


def test_same_origin_request_works():
    """No Origin header (same-origin) — endpoint still works."""
    app = _build_app([])
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"success": True, "status": "healthy"}


def test_authorization_header_is_not_in_the_allowlist():
    """``Authorization`` is gone from allow_headers — nothing sends it now."""
    app = _build_app([])
    client = TestClient(app)
    resp = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    allowed = resp.headers.get("access-control-allow-headers", "")
    assert "authorization" not in allowed.lower()


# ---------------------------------------------------------------------------
# Security response headers
# ---------------------------------------------------------------------------


def test_security_headers_present_on_every_response():
    """All three always-on security headers must be on every response."""
    app = _build_app([])
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert (
        resp.headers.get("permissions-policy")
        == "camera=(), microphone=(), geolocation=()"
    )


def test_x_frame_options_is_not_emitted():
    """X-Frame-Options was dropped — there is no hostile embedder locally."""
    app = _build_app([])
    client = TestClient(app)
    resp = client.get("/api/health")
    assert "x-frame-options" not in {k.lower() for k in resp.headers.keys()}


def test_hsts_is_not_emitted():
    """HSTS was dropped — the loopback origin is plain http, never TLS."""
    app = _build_app([])
    client = TestClient(app)
    resp = client.get("/api/health")
    assert "strict-transport-security" not in {
        k.lower() for k in resp.headers.keys()
    }


def test_docs_path_gets_the_same_headers():
    """The docs UI is no longer a header exception — it gets the same three."""
    app = _build_app([])
    client = TestClient(app)
    resp = client.get("/docs")
    assert resp.status_code == 200
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"


# ---------------------------------------------------------------------------
# Cross-cutting
# ---------------------------------------------------------------------------


def test_cors_and_security_headers_coexist():
    """A single response should carry BOTH CORS and security headers cleanly."""
    app = _build_app(["http://127.0.0.1:18320"])
    client = TestClient(app)
    resp = client.get(
        "/api/health",
        headers={"Origin": "http://127.0.0.1:18320"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:18320"
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
