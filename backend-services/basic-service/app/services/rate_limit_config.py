"""
Rate-limit configuration provider — DB-backed, TTL-cached (spec/03 §2.3).

Spec: docs/plans/api-authz-rate-limiting/specs/02-rate-limiter-core.md (§3 Consumes)
      docs/plans/api-authz-rate-limiting/specs/03-config-and-admin-api.md (§2.3 Produces)

PHASE HISTORY
-------------
- TODO 02 (Phase 1) defined the *consumption contract* + a static fallback so
  the middleware worked before the DB layer existed.
- TODO 03 (Phase 2 — this revision) replaces the provider BODY with a real
  ``SystemSetting``-backed reader featuring a short TTL cache and an
  ``asyncio.Lock`` double-check. The PUBLIC SURFACE IS UNCHANGED so
  ``app/middleware/rate_limit_middleware.py`` needs ZERO edits:

    * module-level singleton ``rate_limit_config_provider``
    * ``async get_config() -> RateLimitConfig``  (cache-hit ⇒ NO DB I/O)
    * ``invalidate() -> None``                   (drop cache, force re-read)
    * ``async prewarm() -> RateLimitConfig``     (NEW — startup cold-read avoid)
    * the :class:`RateLimitConfig` dataclass shape (``enabled``,
      ``window_seconds``, ``limits.{normal_user, normal_ip, ai_generation,
      auth_ip, media_serving}``).

Config keys (SystemSetting ``rate_limiting`` category) → RateLimitConfig path,
see :data:`SYSTEM_SETTING_KEY_MAP`:

    enabled                   bool  default true  -> enabled
    window_seconds            int   default 60    -> window_seconds
    default_per_user_per_min  int   default 300   -> limits.normal_user
    default_per_ip_per_min    int   default 300   -> limits.normal_ip
    ai_generation_per_min     int   default 30    -> limits.ai_generation
    auth_per_ip_per_min       int   default 10    -> limits.auth_ip
    media_serving_per_min     int   default 6000  -> limits.media_serving

Resilience (spec/03 §4): a missing key falls back to its config.py default;
any DB error degrades to the all-defaults config (a config-layer fault must
never take the whole API down). The TTL bounds DB load to ~one read per
``_ttl`` seconds even though the middleware calls ``get_config()`` every
request.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from app.logger import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Fallback defaults.
# ---------------------------------------------------------------------------
# These mirror app/config.py RATE_LIMIT_DEFAULTS and the 012 migration seed.
# They are used (a) as dataclass field defaults and (b) as the last-resort
# values when the DB is unreadable. We try to import the canonical values from
# app/config.py first (single source of truth); if that import fails for any
# reason we keep the literals below so this module is always importable.
DEFAULT_ENABLED = True
DEFAULT_WINDOW_SECONDS = 60
DEFAULT_PER_USER_PER_MIN = 300
DEFAULT_PER_IP_PER_MIN = 300
DEFAULT_AI_GENERATION_PER_MIN = 30
DEFAULT_AUTH_PER_IP_PER_MIN = 10
DEFAULT_MEDIA_SERVING_PER_MIN = 6000

# SystemSetting category these keys live under.
RATE_LIMIT_CATEGORY = "rate_limiting"


@dataclass(frozen=True)
class RateLimitLimits:
    """Per-category limits (requests per window).

    Field names are the stable internal contract consumed by the middleware.
    Mapping to SystemSetting keys (spec 03) in :data:`SYSTEM_SETTING_KEY_MAP`.
    """

    normal_user: int = DEFAULT_PER_USER_PER_MIN
    normal_ip: int = DEFAULT_PER_IP_PER_MIN
    ai_generation: int = DEFAULT_AI_GENERATION_PER_MIN
    auth_ip: int = DEFAULT_AUTH_PER_IP_PER_MIN
    media_serving: int = DEFAULT_MEDIA_SERVING_PER_MIN


@dataclass(frozen=True)
class RateLimitConfig:
    """Resolved, ready-to-use rate-limit configuration snapshot.

    Returned by ``RateLimitConfigProvider.get_config()`` and consumed by the
    middleware every request. Shape matches spec 03 §2.3.
    """

    enabled: bool = DEFAULT_ENABLED
    window_seconds: int = DEFAULT_WINDOW_SECONDS
    limits: RateLimitLimits = field(default_factory=RateLimitLimits)


# Static all-defaults config (DB-missing fallback + reset reference).
DEFAULT_CONFIG = RateLimitConfig()


# SystemSetting key -> dotted RateLimitConfig path. Also imported by the admin
# router so the GET/PUT surface and the provider parse logic agree on names.
SYSTEM_SETTING_KEY_MAP: Dict[str, str] = {
    "enabled": "enabled",
    "window_seconds": "window_seconds",
    "default_per_user_per_min": "limits.normal_user",
    "default_per_ip_per_min": "limits.normal_ip",
    "ai_generation_per_min": "limits.ai_generation",
    "auth_per_ip_per_min": "limits.auth_ip",
    "media_serving_per_min": "limits.media_serving",
}

# Ordered list of the 7 keys (stable iteration for seeding/validation/UI).
RATE_LIMIT_KEYS = tuple(SYSTEM_SETTING_KEY_MAP.keys())


def _default_values() -> Dict[str, Any]:
    """Return the canonical per-key defaults.

    Prefers app/config.py RATE_LIMIT_DEFAULTS (single source of truth) and
    falls back to this module's literals if config import is unavailable.
    """
    try:
        from app.config import RATE_LIMIT_DEFAULTS

        # Copy so callers can't mutate the shared dict.
        return dict(RATE_LIMIT_DEFAULTS)
    except Exception:  # pragma: no cover - defensive import guard
        return {
            "enabled": DEFAULT_ENABLED,
            "window_seconds": DEFAULT_WINDOW_SECONDS,
            "default_per_user_per_min": DEFAULT_PER_USER_PER_MIN,
            "default_per_ip_per_min": DEFAULT_PER_IP_PER_MIN,
            "ai_generation_per_min": DEFAULT_AI_GENERATION_PER_MIN,
            "auth_per_ip_per_min": DEFAULT_AUTH_PER_IP_PER_MIN,
            "media_serving_per_min": DEFAULT_MEDIA_SERVING_PER_MIN,
        }


def _coerce_bool(value: Any, default: bool) -> bool:
    """Best-effort bool coercion tolerant of JSON / string storage."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _coerce_int(value: Any, default: int) -> int:
    """Best-effort int coercion; falls back to ``default`` on garbage."""
    try:
        if isinstance(value, bool):  # avoid True->1 surprises for int keys
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def build_config_from_values(values: Dict[str, Any]) -> RateLimitConfig:
    """Assemble a :class:`RateLimitConfig` from a flat key->value dict.

    Missing keys fall back to the config.py defaults (spec/03 §2.3). Values are
    coerced defensively so a stray string in the JSON column can't crash the
    middleware. Shared by the provider (DB read) and the admin router
    (echo-back of an effective config).
    """
    defaults = _default_values()

    def pick(key: str) -> Any:
        return values.get(key, defaults[key])

    return RateLimitConfig(
        enabled=_coerce_bool(pick("enabled"), bool(defaults["enabled"])),
        window_seconds=_coerce_int(
            pick("window_seconds"), int(defaults["window_seconds"])
        ),
        limits=RateLimitLimits(
            normal_user=_coerce_int(
                pick("default_per_user_per_min"),
                int(defaults["default_per_user_per_min"]),
            ),
            normal_ip=_coerce_int(
                pick("default_per_ip_per_min"),
                int(defaults["default_per_ip_per_min"]),
            ),
            ai_generation=_coerce_int(
                pick("ai_generation_per_min"),
                int(defaults["ai_generation_per_min"]),
            ),
            auth_ip=_coerce_int(
                pick("auth_per_ip_per_min"),
                int(defaults["auth_per_ip_per_min"]),
            ),
            media_serving=_coerce_int(
                pick("media_serving_per_min"),
                int(defaults["media_serving_per_min"]),
            ),
        ),
    )


class RateLimitConfigProvider:
    """DB-backed rate-limit config with a short TTL cache (spec/03 §2.3).

    The middleware calls :meth:`get_config` on every request. A non-expired
    cache hit returns the cached :class:`RateLimitConfig` with NO DB I/O. On
    expiry, a single coroutine refreshes from ``SystemSetting`` under a lock
    (double-checked) while the others await it — so a hot path triggers at most
    one DB read per ``_ttl`` window.

    On any DB error we serve the all-defaults config (and keep serving the last
    good cache if we have one) so a config-store outage never hard-fails the
    API. ``invalidate()`` forces the next ``get_config`` to re-read (used by
    the admin PUT/reset endpoints for near-immediate effect, spec/03 §4 / R7).
    """

    # TTL within spec's 5–10s band. 5s keeps backend edits "数秒内生效" even
    # without an explicit invalidate.
    DEFAULT_TTL_SECONDS = 5.0

    def __init__(self, ttl_seconds: float = DEFAULT_TTL_SECONDS) -> None:
        self._cache: Optional[RateLimitConfig] = None
        self._expires_at: float = 0.0
        self._ttl: float = float(ttl_seconds)
        self._lock = asyncio.Lock()

    async def get_config(self) -> RateLimitConfig:
        """Return the effective config; refresh from DB only when stale."""
        now = time.monotonic()
        cache = self._cache
        if cache is not None and now < self._expires_at:
            return cache

        async with self._lock:
            # Double-check: another coroutine may have refreshed while we waited.
            now = time.monotonic()
            if self._cache is not None and now < self._expires_at:
                return self._cache

            config = await self._load_from_db()
            self._cache = config
            self._expires_at = time.monotonic() + self._ttl
            return config

    def invalidate(self) -> None:
        """Drop the cache so the next ``get_config`` re-reads from the DB."""
        self._cache = None
        self._expires_at = 0.0

    async def prewarm(self) -> RateLimitConfig:
        """Eagerly populate the cache (call at startup to avoid a cold read)."""
        return await self.get_config()

    async def _load_from_db(self) -> RateLimitConfig:
        """Read the ``rate_limiting`` category from SystemSetting → config.

        Degrades to the last good cache (if any) or the all-defaults config on
        any error. Never raises.
        """
        try:
            # Imported lazily to avoid a heavy import chain at module load and
            # to keep this module importable in isolation (tests / tooling).
            from sqlalchemy import select

            from app.database import async_session_factory
            from app.models.db_models import SystemSetting

            async with async_session_factory() as session:
                stmt = select(SystemSetting).where(
                    SystemSetting.category == RATE_LIMIT_CATEGORY
                )
                result = await session.execute(stmt)
                rows = result.scalars().all()

            values: Dict[str, Any] = {row.key: row.value for row in rows}
            return build_config_from_values(values)
        except Exception as exc:  # pragma: no cover - exercised via degrade test
            logger.error(
                "RateLimitConfigProvider: failed to load config from DB; "
                "degrading to %s (err=%s)",
                "last cache" if self._cache is not None else "defaults",
                exc,
            )
            return self._cache if self._cache is not None else DEFAULT_CONFIG


# Module-level singleton. The middleware imports THIS name; do not reconstruct.
rate_limit_config_provider = RateLimitConfigProvider()


__all__ = (
    "RateLimitLimits",
    "RateLimitConfig",
    "RateLimitConfigProvider",
    "DEFAULT_CONFIG",
    "rate_limit_config_provider",
    "build_config_from_values",
    "SYSTEM_SETTING_KEY_MAP",
    "RATE_LIMIT_KEYS",
    "RATE_LIMIT_CATEGORY",
    "DEFAULT_ENABLED",
    "DEFAULT_WINDOW_SECONDS",
    "DEFAULT_PER_USER_PER_MIN",
    "DEFAULT_PER_IP_PER_MIN",
    "DEFAULT_AI_GENERATION_PER_MIN",
    "DEFAULT_AUTH_PER_IP_PER_MIN",
    "DEFAULT_MEDIA_SERVING_PER_MIN",
)
