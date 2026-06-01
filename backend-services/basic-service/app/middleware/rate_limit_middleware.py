"""
Rate-limit middleware (spec 02 §2.4 / §2.5).

Per-request sliding-window enforcement layer that sits INSIDE the session-auth
layer (so it can read ``request.state.user``) and INSIDE the exception handlers
(so a 429 serialises through the standard ``ErrorResponse`` shape).

Request flow (spec §2.4)
------------------------
    config.enabled == false  -> pass through (no counting, no blocking)  [D7]
    method == OPTIONS        -> pass through (CORS preflight)
    resolve_category(path):
        auth          -> key forced to IP (anti-brute-force), limit=auth_ip
        normal        -> per-user limit if logged in, else per-IP limit
        ai_generation -> single key (user|ip), limit=ai_generation
        media_serving -> single key (user|ip), limit=media_serving (high)
    rate_limiter.check(key, limit, window_seconds):
        allowed  -> call_next, attach X-RateLimit-Limit / -Remaining
        denied   -> 429 + Retry-After + ErrorResponse(error_code=rate_limit.exceeded)

Identity (spec §2.2)
--------------------
    logged in (request.state.user present) -> "user:<id>"
    otherwise                              -> "ip:<client_ip>"
    counting key = f"{identity}:{category}"  (categories count independently)

Registration order (spec §2.5 / R5 — CRITICAL)
----------------------------------------------
Starlette ``add_middleware`` is LIFO: the LAST-registered middleware is
OUTERMOST and runs FIRST. To make execution order ``SessionAuth -> RateLimit``
(so auth populates ``request.state.user`` before we read it), ``main.py`` MUST
register ``RateLimitMiddleware`` FIRST and ``SessionAuthMiddleware`` AFTER it.

Config seam (spec 03)
---------------------
Reads ``rate_limit_config_provider.get_config()`` every request. The provider
guarantees cache-hit reads do no DB I/O (Phase 1 fallback is static; TODO 03
ships a TTL-cached DB provider with the same interface).
"""

from __future__ import annotations

from typing import Awaitable, Callable

from fastapi import status
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.logger import get_logger
from app.models.base_models import ErrorResponse
from app.services.rate_limit_config import rate_limit_config_provider
from app.services.rate_limiter import (
    CATEGORY_AI_GENERATION,
    CATEGORY_AUTH,
    CATEGORY_MEDIA_SERVING,
    CATEGORY_NORMAL,
    Decision,
    get_client_ip,
    rate_limiter,
    resolve_category,
)

logger = get_logger(__name__)

RATE_LIMIT_ERROR_CODE = "rate_limit.exceeded"


def _rate_limited_response(decision: Decision) -> JSONResponse:
    """Build the standard 429 response (ErrorResponse + Retry-After header)."""
    payload = ErrorResponse(
        success=False,
        message="请求过于频繁,请稍后再试。",
        error_code=RATE_LIMIT_ERROR_CODE,
        error_details={
            "retry_after": decision.retry_after,
            "limit": decision.limit,
        },
    ).model_dump(mode="json")

    response = JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content=payload,
    )
    # Retry-After is the contract the frontend (TODO 04) reads to show the
    # "retry in N seconds" toast. Always an integer number of seconds.
    response.headers["Retry-After"] = str(decision.retry_after)
    response.headers["X-RateLimit-Limit"] = str(decision.limit)
    response.headers["X-RateLimit-Remaining"] = "0"
    return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window rate limiting, gated by the hot-reloadable config.

    Subclasses ``BaseHTTPMiddleware`` (same base as ``SessionAuthMiddleware``)
    so it can read ``request.state`` via the attribute proxy and short-circuit
    with a ``JSONResponse`` without hand-managing the ASGI scope.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        # 1. OPTIONS (CORS preflight) — never counted/limited. Mirrors the
        #    SessionAuthMiddleware defensive OPTIONS short-circuit.
        if request.method.upper() == "OPTIONS":
            return await call_next(request)

        # 2. Read config (cache-hit ⇒ no DB I/O). Fail-open on provider error:
        #    a config-layer fault must never take down the whole API.
        try:
            config = await rate_limit_config_provider.get_config()
        except Exception:  # pragma: no cover - defensive
            logger.error(
                "RateLimitMiddleware: config provider failed; failing open "
                "(no limiting this request).",
                exc_info=True,
            )
            return await call_next(request)

        # 3. Global kill-switch (D7) — full pass-through, no counting.
        if not config.enabled:
            return await call_next(request)

        path = request.url.path
        category = resolve_category(path)

        # 4. Resolve identity + the limit for this category.
        #    - auth: ALWAYS per-IP (anti-brute-force; independent of any
        #      logged-in user, spec §2.4).
        #    - normal: per-user limit when authenticated, per-IP when anonymous.
        #    - ai_generation / media_serving: single per-category limit keyed
        #      on whichever identity is available (user preferred, else IP).
        user = getattr(request.state, "user", None)
        limits = config.limits

        if category == CATEGORY_AUTH:
            identity = f"ip:{get_client_ip(request)}"
            limit = limits.auth_ip
        else:
            if user is not None:
                user_id = getattr(user, "id", None)
                identity = f"user:{user_id}"
            else:
                identity = f"ip:{get_client_ip(request)}"

            if category == CATEGORY_NORMAL:
                limit = limits.normal_user if user is not None else limits.normal_ip
            elif category == CATEGORY_AI_GENERATION:
                limit = limits.ai_generation
            elif category == CATEGORY_MEDIA_SERVING:
                limit = limits.media_serving
            else:  # pragma: no cover - resolve_category only returns known cats
                limit = limits.normal_user if user is not None else limits.normal_ip

        key = f"{identity}:{category}"

        # 5. Account + decide.
        decision = await rate_limiter.check(
            key,
            limit=limit,
            window_seconds=config.window_seconds,
        )

        if not decision.allowed:
            logger.warning(
                "RateLimitMiddleware: 429 for key=%s category=%s limit=%s "
                "retry_after=%ss path=%s",
                key,
                category,
                decision.limit,
                decision.retry_after,
                path,
            )
            return _rate_limited_response(decision)

        # 6. Allowed — proceed and surface remaining budget for clients/debug.
        response = await call_next(request)
        response.headers.setdefault("X-RateLimit-Limit", str(decision.limit))
        response.headers.setdefault(
            "X-RateLimit-Remaining", str(decision.remaining)
        )
        return response


__all__ = ("RateLimitMiddleware", "RATE_LIMIT_ERROR_CODE")
