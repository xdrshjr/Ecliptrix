"""
Session authentication middleware.

Enforces session-token authentication for every incoming HTTP request that is
NOT on the allowlist. Populates ``request.state.user`` with the authenticated
``User`` ORM instance so that downstream router-level dependencies
(``get_current_user`` / ``require_admin`` / ``require_root``) can read it
without performing another database lookup.

Design notes
------------
- This middleware is registered FIRST in ``app/main.py`` (LIFO order) so that
  ``CORSMiddleware`` ends up wrapping it on the outside. CORS preflight
  ``OPTIONS`` requests are therefore answered before they ever reach this
  middleware, but the middleware ALSO short-circuits ``OPTIONS`` defensively
  in case the ordering is ever changed.
- The error response shape exactly mirrors ``app.models.base_models.ErrorResponse``
  so that frontend clients which already branch on ``error_code`` continue to
  work without modification.
- Token extraction supports three forms in order of preference:
    1. ``Authorization: Bearer <token>`` (canonical, set by the new frontend
       HTTP wrapper as of S03)
    2. ``Authorization: <token>`` (legacy raw value — kept for in-flight
       pre-refactor clients during the rolling deploy)
    3. ``X-Session-Token: <token>`` (legacy header still emitted by older
       clients prior to D8)
- The middleware MUST NOT read the request body. Body bytes are streamed and
  consuming them here would break large-multipart endpoints (e.g. video
  upload).
"""

from __future__ import annotations

import hmac
from typing import Iterable, Optional, Tuple

from fastapi import status
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings
from app.database import async_session_factory
from app.logger import get_logger
from app.models.base_models import ErrorResponse
from app.models.db_models import User

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Allowlist (spec §4 — exhaustive)
# ---------------------------------------------------------------------------
#
# Exact-match paths: O(1) set lookup. The trailing-slash variant of /api/health
# is included because some monitoring clients normalize trailing slashes.
ALLOWLIST_EXACT: frozenset[str] = frozenset({
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/validate-session",
    "/api/health",
    "/api/health/",
    "/docs",
    "/redoc",
    "/openapi.json",
})

# Prefix-match paths: iterated linearly. Trailing slash IS significant —
# "/api/storage/files-other" must NOT match "/api/storage/files/".
#
# These prefixes correspond to FastAPI ``StaticFiles`` mounts in main.py.
# Static media cannot be middleware-protected because the browser requests
# them via ``<audio src="...">`` / ``<video src="...">`` / ``<img src="...">``
# tags which cannot send custom Authorization headers. Locking these down
# requires signed URLs (Risk R3 in master-plan; deferred to a separate
# follow-up ticket). Until that ticket lands, every static mount in main.py
# MUST also appear in this list.
#
# **Phase 3.7 (2026-04-07)** — added /api/audio/generated/ and /api/audio/
# subtitles/ after the dev-server test served a 401 on a TTS-generated audio
# file (/api/audio/generated/agent-segment-0_concatenated_*.mp3). The original
# T01 spec only enumerated /api/storage/files/, missing the two audio mounts
# documented in CLAUDE.md. /static/timeline_exports/ is covered by the
# /static/ prefix.
#
# **api-authz-rate-limiting T01 (spec/01 §3.2)** — added /api/config/ so the
# frontend can resolve runtime feature flags (e.g. GET /api/config/playback-flag,
# served by config_router) before a session exists. Note: the BARE /api/config
# endpoint (api_router's non-sensitive config dump) is deliberately NOT public —
# src/lib/api/config.ts documents that every caller must be authenticated, and
# the trailing slash here means "/api/config" (no slash) does NOT match this
# prefix, so it still requires auth.
ALLOWLIST_PREFIX: Tuple[str, ...] = (
    "/static/",
    "/api/storage/files/",
    "/api/audio/generated/",
    "/api/audio/subtitles/",
    "/api/config/",
)

# ---------------------------------------------------------------------------
# Hard-protect list (spec/01 §V01-A — root-level router defense in depth)
# ---------------------------------------------------------------------------
#
# Endpoints exposed by routers that are mounted at the FastAPI root (i.e.
# without ``prefix="/api"`` in ``main.py``) and whose URL therefore does not
# follow the conventional ``/api/...`` shape. The middleware's allowlist is
# already a deny-by-default policy, so any path not in the allowlist already
# requires auth. We keep this explicit "always require auth" list as defence
# in depth: if someone in the future re-mounts the allowlist patterns more
# permissively (e.g. allowlists ``/`` or extends prefixes by mistake), these
# entries still force a token check.
#
# Match algorithm: an exact path equality OR ``path == p`` / ``path.startswith(p + "/")``.
HARD_PROTECT_PATHS: Tuple[str, ...] = (
    "/api/workflow/ai-video-generate",
    "/api/workflow/video-export",
    "/api/intent-detection",
)


def _is_hard_protected(path: str) -> bool:
    """Return True if ``path`` falls under a hard-protect rule (defence in depth)."""
    for p in HARD_PROTECT_PATHS:
        if path == p or path.startswith(p + "/"):
            return True
    return False


def _is_allowlisted(path: str) -> bool:
    """Return True if ``path`` is exempt from auth enforcement.

    Algorithm: hard-protect list wins over allowlists (defence in depth), then
    try the O(1) exact set, then iterate the prefix tuple. The prefix list is
    intentionally tiny so a linear scan is cheaper than building a trie.
    """
    if _is_hard_protected(path):
        return False
    if path in ALLOWLIST_EXACT:
        return True
    for prefix in ALLOWLIST_PREFIX:
        if path.startswith(prefix):
            return True
    return False


def _extract_token(request: Request) -> Optional[str]:
    """Extract a session token from request headers or cookies.

    Returns ``None`` when no candidate header or cookie is present. Mirrors
    ``app.dependencies.auth._extract_token`` exactly so the middleware and
    the dependency see the same token in all cases.

    Cookie fallback (spec/01 V01-C) is required so that browser media tags
    (``<video src=...>``, ``<audio src=...>``) which cannot send custom
    headers can still authenticate against the ``storage_files_router``.
    """
    auth_header = request.headers.get("authorization")
    if auth_header:
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()
        # Legacy: raw token in Authorization header (pre-Bearer clients).
        return auth_header.strip()

    legacy = request.headers.get("x-session-token")
    if legacy:
        return legacy.strip()

    cookie_token = request.cookies.get("ecliptrix-session-token")
    if cookie_token:
        return cookie_token.strip()

    return None


def _error_response(
    *,
    status_code: int,
    message: str,
    error_code: str,
    reason: str,
) -> JSONResponse:
    """Build a JSON error response that matches the standard ErrorResponse shape.

    We construct an ``ErrorResponse`` pydantic model and serialize via
    ``model_dump(mode="json")`` so the ``timestamp`` field becomes the ISO-8601
    string the rest of the API returns.
    """
    payload = ErrorResponse(
        success=False,
        message=message,
        error_code=error_code,
        error_details={"reason": reason},
    ).model_dump(mode="json")
    return JSONResponse(status_code=status_code, content=payload)


class SessionAuthMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that enforces session-token auth on every request.

    The middleware is intentionally a ``BaseHTTPMiddleware`` subclass (not a
    raw ASGI ``__call__``) so that it can call ``request.state.user = user``
    via the convenience attribute proxy without managing the ASGI scope by
    hand.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        path = request.url.path
        method = request.method.upper()

        # 1. CORS preflight short-circuit. CORS middleware is registered AFTER
        # us in main.py and therefore wraps us, so it normally answers OPTIONS
        # before we are reached. We still skip OPTIONS defensively for
        # robustness against ordering bugs.
        if method == "OPTIONS":
            return await call_next(request)

        # 2. Allowlist short-circuit (NO database lookup performed).
        if _is_allowlisted(path):
            return await call_next(request)

        # 2b. Enforcement gate (api-authz-rate-limiting spec/01 §5, R1).
        #
        # ``AUTH_ENFORCE_DEFAULT_DENY`` controls whether a missing / invalid
        # session causes a hard 401/403 for ordinary (non-allowlisted) paths.
        # It defaults to False so that behaviour is unchanged until the
        # frontend token-carry audit (TODO 05) completes — otherwise any FE
        # call that has not yet been migrated to send Authorization would
        # regress to 401.
        #
        # ``HARD_PROTECT_PATHS`` are the exception: they are ALWAYS enforced
        # (defence in depth — these were locked down by the prior security
        # hardening and the spec mandates "保留不弱化 / do not weaken"). So a
        # rejection happens when EITHER the flag is on OR the path is
        # hard-protected.
        enforce = bool(getattr(settings, "auth_enforce_default_deny", False)) \
            or _is_hard_protected(path)

        # 3. Token extraction
        token = _extract_token(request)
        if not token:
            if not enforce:
                # Pass through unauthenticated. ``request.state.user`` is left
                # unset; downstream ``get_current_user`` dependencies (if any)
                # will perform their own 401 via the slow path.
                return await call_next(request)
            logger.warning(
                "SessionAuthMiddleware: rejecting request without token",
                {"path": path, "method": method},
            )
            return _error_response(
                status_code=status.HTTP_401_UNAUTHORIZED,
                message="未提供认证凭证",
                error_code="UNAUTHORIZED",
                reason="Missing session token",
            )

        # 4. Async DB lookup. We open a fresh session per request rather than
        # piggy-backing on FastAPI's ``Depends(get_db_session)`` because
        # middlewares run before the dependency injection system.
        #
        # A token IS present, so we resolve it and inject ``request.state.user``
        # whenever it is valid — even when ``enforce`` is False — so that
        # authenticated requests behave identically with the flag on or off
        # (no regression for the normal logged-in case). Only the REJECTION of
        # invalid/missing credentials is gated by ``enforce``.
        try:
            async with async_session_factory() as session:
                stmt = select(User).where(User.active_session_token == token)
                result = await session.execute(stmt)
                user: Optional[User] = result.scalar_one_or_none()
        except Exception as exc:  # pragma: no cover - defensive
            logger.error(
                "SessionAuthMiddleware: DB lookup failed",
                exc_info=exc,
            )
            return _error_response(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                message="认证服务暂时不可用",
                error_code="AUTH_SERVICE_ERROR",
                reason="Database lookup failed",
            )

        if user is None:
            if not enforce:
                return await call_next(request)
            logger.warning(
                "SessionAuthMiddleware: token did not match any user",
                {"path": path},
            )
            return _error_response(
                status_code=status.HTTP_401_UNAUTHORIZED,
                message="会话无效或已过期",
                error_code="UNAUTHORIZED",
                reason="Invalid or expired session token",
            )

        # Constant-time defense-in-depth comparison (mirrors get_current_user).
        if user.active_session_token is None or not hmac.compare_digest(
            user.active_session_token, token
        ):
            if not enforce:
                return await call_next(request)
            logger.warning(
                "SessionAuthMiddleware: token mismatch after DB lookup",
                {"user_id": str(user.id)},
            )
            return _error_response(
                status_code=status.HTTP_401_UNAUTHORIZED,
                message="会话无效或已过期",
                error_code="UNAUTHORIZED",
                reason="Token mismatch",
            )

        if not user.is_active:
            # A disabled account is rejected whenever enforcement applies. When
            # ``enforce`` is False we do NOT inject the user (the account is
            # disabled) and simply pass through so behaviour matches the
            # pre-flag state for unenforced paths.
            if not enforce:
                return await call_next(request)
            logger.warning(
                "SessionAuthMiddleware: rejecting disabled account",
                {"user_id": str(user.id), "username": user.username},
            )
            return _error_response(
                status_code=status.HTTP_403_FORBIDDEN,
                message="账户已被禁用",
                error_code="ACCOUNT_DISABLED",
                reason="User account is disabled",
            )

        # 5. Hand the authenticated user to downstream components via
        # request.state. ``get_current_user`` will pick this up and skip the
        # duplicate DB query.
        request.state.user = user

        return await call_next(request)


__all__: Iterable[str] = (
    "SessionAuthMiddleware",
    "ALLOWLIST_EXACT",
    "ALLOWLIST_PREFIX",
    "HARD_PROTECT_PATHS",
)
