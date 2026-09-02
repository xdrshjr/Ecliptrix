"""
Security response headers middleware.

Adds three hardening response headers to every HTTP response:

  - ``X-Content-Type-Options: nosniff``         (MIME-sniffing guard)
  - ``Referrer-Policy: strict-origin-when-cross-origin``
  - ``Permissions-Policy: camera=(), microphone=(), geolocation=()``

``nosniff`` is the one that still earns its keep on a local-only build: it
protects ``/api/storage/files``, which serves arbitrary media the user
imported, from MIME confusion.

``X-Frame-Options`` and HSTS were dropped with the `desktop-only-refactor` —
there is no hostile embedder and no TLS on a loopback ``http://`` origin, so
both were noise.

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


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach hardening response headers to every outgoing response."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)

        # We use setdefault so any downstream handler that already chose a
        # different policy for a specific endpoint wins.
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin"
        )
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=()",
        )

        return response
