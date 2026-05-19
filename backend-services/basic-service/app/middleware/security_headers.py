"""
Security response headers middleware (spec 02 §3 V02-B).

Adds the standard hardening response headers to every HTTP response:

  - ``X-Content-Type-Options: nosniff``         (MIME-sniffing guard)
  - ``X-Frame-Options: DENY``                    (clickjacking guard)
  - ``Referrer-Policy: strict-origin-when-cross-origin``
  - ``Permissions-Policy: camera=(), microphone=(), geolocation=()``

In addition, when ``settings.env == "production"`` the middleware emits:

  - ``Strict-Transport-Security: max-age=31536000; includeSubDomains``

Path-based exceptions
---------------------
``/docs``, ``/redoc`` and ``/openapi.json`` skip ``X-Frame-Options`` so that the
Swagger / ReDoc UIs continue to render their assets in dev environments. They
still get ``nosniff`` and ``Referrer-Policy``.

This is registered AFTER ``CORSMiddleware`` in ``app/main.py`` (Starlette
``add_middleware`` is LIFO — the LATER call is OUTERMOST). That ordering means
the security headers wrapper sees the final response *after* the CORS layer
has already attached ``Access-Control-*`` headers, so we never overwrite them.
"""

from __future__ import annotations

from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings


# Path prefixes that should not receive X-Frame-Options. These are interactive
# documentation UIs that load their JS/CSS into iframes in some hosting setups.
_FRAME_EXEMPT_PREFIXES: tuple[str, ...] = ("/docs", "/redoc", "/openapi.json")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach hardening response headers to every outgoing response."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)

        # Always-on headers. We use setdefault so any downstream handler that
        # already chose a different policy for a specific endpoint wins.
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin"
        )
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=()",
        )

        # X-Frame-Options: skip for docs UIs so they can render in iframes.
        path = request.url.path or ""
        if not any(path.startswith(p) for p in _FRAME_EXEMPT_PREFIXES):
            response.headers.setdefault("X-Frame-Options", "DENY")

        # HSTS is only meaningful over HTTPS and should not be sent from dev
        # / staging environments where the cert chain may differ. Gate it on
        # the deployment-environment marker.
        env_marker = (getattr(settings, "env", "production") or "production").lower()
        if env_marker == "production":
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )

        return response
