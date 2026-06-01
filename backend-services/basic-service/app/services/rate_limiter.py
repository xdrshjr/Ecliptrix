"""
Rate limiter core — in-process, in-memory sliding-window request limiter.

Spec: docs/plans/api-authz-rate-limiting/specs/02-rate-limiter-core.md (§2.1–§2.3)

This module is the reusable kernel consumed by
``app/middleware/rate_limit_middleware.py``. It mirrors the style of the
existing per-IP sliding window in
``app/services/media_proxy_service.py`` (``check_rate_limit``, lines ~276-304):
an ``asyncio.Lock``-guarded ``Dict[key, Deque[timestamp]]`` keyed on monotonic
timestamps, with cheap garbage collection to keep the dict bounded.

What lives here
---------------
1. :class:`Decision` — the immutable result of a ``check`` call.
2. :class:`RateLimiter` — the sliding-window kernel + read-only stats snapshot
   + a ``reset()`` test-isolation hook. Exposed as the global singleton
   ``rate_limiter`` (mirrors ``queue_manager``).
3. :func:`get_client_ip` — X-Forwarded-For-aware client IP extraction.
4. :func:`resolve_category` — path → rate-limit category mapper.

Design notes
------------
- **Replaceable backend (D2 / R3):** ``check``'s signature is decoupled from
  its implementation. A future Redis-backed limiter can implement the same
  ``async check(key, limit, window_seconds) -> Decision`` contract without the
  middleware changing.
- **Monotonic clock:** we use ``time.monotonic()`` (not wall clock) so the
  window is immune to NTP / clock adjustments — same choice as media_proxy.
- **Single process only:** counts are process-local. Production is documented
  as single-worker (R3); multi-worker would under-count. GC keeps memory
  bounded.
"""

from __future__ import annotations

import asyncio
import math
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional

from starlette.requests import Request

from app.logger import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Decision
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Decision:
    """Immutable outcome of a single :meth:`RateLimiter.check` call.

    Attributes
    ----------
    allowed:
        ``True`` if the request fits inside the window, ``False`` if it would
        exceed ``limit``.
    retry_after:
        Seconds the caller should wait before retrying. ``0`` when allowed.
        Always ``>= 1`` when denied (we ceil so a sub-second remainder still
        tells the client to wait at least one second).
    limit:
        The effective limit applied for this check (echoed back so the
        middleware can populate ``X-RateLimit-Limit`` without re-reading
        config).
    remaining:
        Approximate number of further requests allowed in the current window
        after this one. ``0`` when denied.
    """

    allowed: bool
    retry_after: int
    limit: int
    remaining: int


# ---------------------------------------------------------------------------
# RateLimiter kernel
# ---------------------------------------------------------------------------
class RateLimiter:
    """Process-local sliding-window rate limiter.

    Counts requests per ``key`` inside a rolling ``window_seconds`` window.
    Each ``key`` owns a ``deque`` of monotonic timestamps; expired stamps are
    evicted from the left on every check. Thread/async safety is provided by a
    single ``asyncio.Lock`` (the windows are small and the critical section is
    O(window-size), so a single lock is more than adequate for a single
    process — matching the media_proxy precedent).

    GC: when the number of tracked keys exceeds ``max_keys`` we drop keys whose
    most-recent activity is already outside the window (i.e. empty / stale
    queues), keeping the dict from growing without bound under key churn (e.g.
    a flood of distinct anonymous IPs).
    """

    # GC threshold — kept generous so it never trips during normal operation
    # but bounds worst-case memory under adversarial key churn.
    DEFAULT_MAX_KEYS = 4096

    def __init__(self, max_keys: int = DEFAULT_MAX_KEYS) -> None:
        self._windows: Dict[str, Deque[float]] = {}
        self._lock = asyncio.Lock()
        self._max_keys = max(1, int(max_keys))

        # Read-only-facing counters (mutated only under ``_lock``).
        self._total_checked = 0
        self._total_blocked = 0

    async def check(
        self,
        key: str,
        limit: int,
        window_seconds: int = 60,
    ) -> Decision:
        """Account for one request against ``key`` and decide allow/deny.

        Parameters
        ----------
        key:
            Opaque counting bucket, e.g. ``"user:<uuid>:ai_generation"`` or
            ``"ip:1.2.3.4:auth"``. Distinct keys count independently.
        limit:
            Maximum requests permitted within the window. A ``limit <= 0`` is
            treated as "deny everything" defensively, except — to avoid an
            accidental global lockout from a misconfiguration — we instead
            treat non-positive limits as *unlimited* and allow through, logging
            once. (See note below.)
        window_seconds:
            Rolling window size in seconds. Defaults to 60 (per-minute).

        Returns
        -------
        Decision
        """
        # Defensive: a non-positive limit almost always means a misconfigured
        # provider value rather than an intentional "block all". Failing open
        # (allow) here is the safer production choice — a bad config row should
        # never hard-lock the entire API. The middleware layer is responsible
        # for sane defaults; this is belt-and-suspenders.
        if limit is None or limit <= 0:
            logger.warning(
                "RateLimiter.check called with non-positive limit=%r for key=%r; "
                "treating as unlimited (fail-open).",
                limit,
                key,
            )
            async with self._lock:
                self._total_checked += 1
            return Decision(allowed=True, retry_after=0, limit=0, remaining=0)

        win = window_seconds if window_seconds and window_seconds > 0 else 60
        now = time.monotonic()
        cutoff = now - win

        async with self._lock:
            self._total_checked += 1

            dq = self._windows.get(key)
            if dq is None:
                dq = deque()
                self._windows[key] = dq

            # Evict timestamps that have rolled out of the window.
            while dq and dq[0] <= cutoff:
                dq.popleft()

            if len(dq) >= limit:
                # Window full. Retry-After = time until the OLDEST in-window
                # stamp expires (then a slot frees up). ceil → at least 1s.
                oldest = dq[0]
                retry_after = max(1, math.ceil(win - (now - oldest)))
                self._total_blocked += 1
                # GC opportunity even on the deny path so a hot, over-limit key
                # set still gets its stale neighbours cleaned.
                self._maybe_gc(cutoff)
                return Decision(
                    allowed=False,
                    retry_after=retry_after,
                    limit=limit,
                    remaining=0,
                )

            dq.append(now)
            remaining = max(0, limit - len(dq))
            self._maybe_gc(cutoff)
            return Decision(
                allowed=True,
                retry_after=0,
                limit=limit,
                remaining=remaining,
            )

    def _maybe_gc(self, cutoff: float) -> None:
        """Drop stale/empty key windows when over capacity.

        Caller MUST hold ``self._lock``. Cheap: only runs the scan when the
        dict has grown past ``_max_keys``. A "stale" key is one whose newest
        timestamp is already outside the window (or whose queue is empty) — it
        contributes nothing to any future count.
        """
        if len(self._windows) <= self._max_keys:
            return

        stale_keys = [
            k
            for k, dq in self._windows.items()
            if not dq or dq[-1] <= cutoff
        ]
        for k in stale_keys:
            self._windows.pop(k, None)

        # If churn is so heavy that even after dropping stale keys we are still
        # over capacity (every key currently active), evict the keys with the
        # oldest activity to enforce a hard memory bound. This is a last-resort
        # safety valve — under normal load it never triggers.
        if len(self._windows) > self._max_keys:
            overflow = len(self._windows) - self._max_keys
            oldest_first = sorted(
                self._windows.items(),
                key=lambda kv: (kv[1][-1] if kv[1] else 0.0),
            )
            for k, _dq in oldest_first[:overflow]:
                self._windows.pop(k, None)

    # ------------------------------------------------------------------ stats
    def stats(self) -> Dict[str, int]:
        """Return a read-only snapshot of limiter counters.

        Consumed by spec 03's ``GET /api/rate-limit/status`` endpoint. This is
        a plain synchronous read of integer counters + a ``len`` — it does not
        take the lock (a momentarily-stale ``active_keys`` count is harmless
        for an observability snapshot, and avoiding the lock keeps ``/status``
        cheap and non-blocking).
        """
        return {
            "total_checked": self._total_checked,
            "total_blocked": self._total_blocked,
            "active_keys": len(self._windows),
        }

    # ---------------------------------------------------------------- testing
    async def reset(self) -> None:
        """Clear all windows and counters. Test-isolation hook (spec §B / 06).

        Async so callers can ``await rate_limiter.reset()`` between test cases
        and so we can safely take the lock while clearing.
        """
        async with self._lock:
            self._windows.clear()
            self._total_checked = 0
            self._total_blocked = 0


# Global singleton (mirrors ``queue_manager`` / ``media_proxy`` patterns).
rate_limiter = RateLimiter()


# ---------------------------------------------------------------------------
# Identity resolution (§2.2)
# ---------------------------------------------------------------------------
def get_client_ip(request: Request) -> str:
    """Resolve the client IP for rate-limiting purposes.

    Order of preference (spec §2.2):
      1. First segment of ``X-Forwarded-For`` (the original client; nginx
         appends downstream proxies to the right). We trust nginx to inject
         this (R4 — deployment must ensure only the trusted reverse proxy can
         set it).
      2. ``request.client.host`` — the direct socket peer.
      3. ``"unknown"`` — last-resort sentinel so a missing client never yields
         an empty key (which would silently merge all such requests into one
         bucket, but at least keeps counting deterministic).

    Centralised here so tests and a future trusted-proxy allowlist have a
    single place to evolve.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",", 1)[0].strip()
        if first:
            return first

    client = request.client
    if client and client.host:
        return client.host

    return "unknown"


# ---------------------------------------------------------------------------
# Category registry (§2.3)
# ---------------------------------------------------------------------------
#
# Category names are stable string constants shared with the middleware and
# (downstream) the config provider's per-category keys.
CATEGORY_AUTH = "auth"
CATEGORY_MEDIA_SERVING = "media_serving"
CATEGORY_AI_GENERATION = "ai_generation"
CATEGORY_NORMAL = "normal"

# --- auth (exact paths; per-IP, brute-force protection) --------------------
# Login / register only. ``validate-session`` is intentionally NOT here: it is
# called periodically by every logged-in client and must not share the strict
# anti-brute-force bucket.
_AUTH_PATHS: frozenset[str] = frozenset(
    {
        "/api/auth/login",
        "/api/auth/register",
    }
)

# --- media_serving (high quota; MUST be checked before ai_generation) ------
# These are the StaticFiles mounts + the authenticated storage files router.
# CRITICAL ORDERING (spec §2.3): ``/api/audio/generated/`` and
# ``/api/audio/subtitles/`` must resolve to media_serving BEFORE the
# ai_generation ``/api/audio/`` prefix below would otherwise swallow them.
_MEDIA_SERVING_PREFIXES: tuple[str, ...] = (
    "/api/storage/files/",
    "/static/",
    "/api/audio/generated/",
    "/api/audio/subtitles/",
)

# --- ai_generation (low quota; compute / 3rd-party-quota heavy) ------------
# Finalised against the real router prefixes registered in app/main.py:
#   - tts_router            prefix="/tts"        -> /api/tts/
#   - llm_router            prefix="/llm"        -> /api/llm/
#   - audio_router          prefix="/audio"      -> /api/audio/ (search/transcribe;
#       media subpaths already split off above)
#   - ark_video_router      prefix="/ark-video"  -> /api/ark-video
#   - ark_image_router      prefix="/ark-image"  -> /api/ark-image
#   - storyboard_router     prefix="/storyboard" -> /api/storyboard
#   - image_pack_router     prefix="/image-pack" -> /api/image-pack (generation)
#   - voice_clone_router    prefix="/voice-clone"-> /api/voice-clone
#   - image_router          prefix="/image"      -> /api/image (search)
#   - ai_video_generate_router (root)            -> /api/workflow/ai-video-generate
#   - video_export_router      (root)            -> /api/workflow/video-export
#   - ai_mixed_editing_router  (no prefix, /api) -> /api/ai-mixed-editing
#   - chat_router              (no prefix, /api) -> /api/video-editing-chat
#   - video_understanding_script_router (no prefix, /api)
#                                                -> /api/video-understanding-script
#                                                -> /api/convert-to-script
#
# Order within this tuple does not matter (all are mutually exclusive
# prefixes); kept grouped for readability.
_AI_GENERATION_PREFIXES: tuple[str, ...] = (
    "/api/workflow/ai-video-generate",
    "/api/workflow/video-export",
    "/api/tts/",
    "/api/audio/",            # transcription / Freesound search (media subpaths split above)
    "/api/llm/",
    "/api/ai-mixed-editing",  # long-running AI mixed editing (Pattern C, 600s) — compute heavy
    "/api/video-editing-chat",
    "/api/video-understanding-script",
    "/api/convert-to-script",
    "/api/ark-video",
    "/api/ark-image",
    "/api/storyboard",
    "/api/voice-clone",
    "/api/image-pack",
    "/api/image",             # image search (third-party quota)
)


def resolve_category(path: str) -> str:
    """Map a request path to a rate-limit category.

    Matching order is significant and MUST follow spec §2.3:
        auth → media_serving → ai_generation → normal

    The media_serving check is deliberately placed BEFORE ai_generation so the
    ``/api/audio/generated/`` and ``/api/audio/subtitles/`` static mounts are
    classified as cheap media serving rather than being captured by the
    ai_generation ``/api/audio/`` prefix.

    Returns one of the ``CATEGORY_*`` constants.
    """
    if not path:
        return CATEGORY_NORMAL

    # 1. auth — exact match (per-IP, anti-brute-force).
    if path in _AUTH_PATHS:
        return CATEGORY_AUTH

    # 2. media_serving — high quota; checked before ai_generation (CRITICAL).
    for prefix in _MEDIA_SERVING_PREFIXES:
        if path.startswith(prefix):
            return CATEGORY_MEDIA_SERVING

    # 3. ai_generation — compute / external-quota heavy; strict limit.
    for prefix in _AI_GENERATION_PREFIXES:
        if path.startswith(prefix):
            return CATEGORY_AI_GENERATION

    # 4. normal — everything else (limit chosen by identity in middleware).
    return CATEGORY_NORMAL


__all__ = (
    "Decision",
    "RateLimiter",
    "rate_limiter",
    "get_client_ip",
    "resolve_category",
    "CATEGORY_AUTH",
    "CATEGORY_MEDIA_SERVING",
    "CATEGORY_AI_GENERATION",
    "CATEGORY_NORMAL",
)
