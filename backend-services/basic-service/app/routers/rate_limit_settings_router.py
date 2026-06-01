"""
Admin API for rate-limiting configuration (spec/03 §2.4).

Prefix: /api/rate-limit (registered in main.py with prefix="/api/rate-limit").
Every endpoint requires admin privileges (``require_admin`` at router level —
is_admin=True or is_root=True). Mutations record the caller's username in both
``SystemSetting.updated_by`` and a ``SettingsAuditLog`` row (setting_type=
'system_setting', category='rate_limiting'), keeping audit behaviour identical
to ``system_settings_service`` so the existing
``GET /api/system-settings/audit-log?category=rate_limiting`` endpoint surfaces
these changes.

Endpoints
---------
GET  /config  -> current effective config + per-key meta (default/type/range/desc)
PUT  /config  -> batch update (per-key range-validate; 422 on bad; then invalidate)
POST /reset   -> reset all keys to factory defaults (+ audit + invalidate)
GET  /status  -> enabled (from config) + rate_limiter.stats() snapshot

Persistence reuses ``SystemSetting`` (category='rate_limiting'). Rows are
normally seeded by Alembic migration 012; to stay robust on the
create_all-only path (SQLite tests, fresh DBs) the PUT/reset handlers UPSERT —
they create a missing row from the config.py default rather than 404.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import RATE_LIMIT_DEFAULTS, RATE_LIMIT_META
from app.database import get_db_session
from app.dependencies.auth import require_admin
from app.logger import get_logger
from app.models.base_models import BaseResponse
from app.models.db_models import SettingsAuditLog, SystemSetting, User
from app.services.rate_limit_config import (
    RATE_LIMIT_CATEGORY,
    RATE_LIMIT_KEYS,
    build_config_from_values,
    rate_limit_config_provider,
)
from app.services.rate_limiter import rate_limiter

logger = get_logger(__name__)

# require_admin at the router level so EVERY endpoint is admin-gated (non-admin
# -> 403 via the dependency). Individual mutating handlers additionally inject
# the admin user to record the audit username.
router = APIRouter(
    prefix="/rate-limit",
    tags=["Rate Limit Settings"],
    dependencies=[Depends(require_admin)],
)


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------
class RateLimitLimitsModel(BaseModel):
    """The five per-category limit values (keyed by SystemSetting key names)."""

    default_per_user_per_min: int
    default_per_ip_per_min: int
    ai_generation_per_min: int
    auth_per_ip_per_min: int
    media_serving_per_min: int


class RateLimitConfigModel(BaseModel):
    """GET /config response payload (shape shared with frontend TODO 04)."""

    enabled: bool
    window_seconds: int
    limits: RateLimitLimitsModel
    meta: Dict[str, Dict[str, Any]]


class RateLimitConfigResponse(BaseResponse):
    config: RateLimitConfigModel


class RateLimitUpdateRequest(BaseModel):
    """PUT /config — any subset of the 7 keys; only provided keys are changed."""

    enabled: Optional[bool] = None
    window_seconds: Optional[int] = None
    default_per_user_per_min: Optional[int] = None
    default_per_ip_per_min: Optional[int] = None
    ai_generation_per_min: Optional[int] = None
    auth_per_ip_per_min: Optional[int] = None
    media_serving_per_min: Optional[int] = None

    model_config = {"extra": "forbid"}


class RateLimitStatusModel(BaseModel):
    enabled: bool
    active_keys: int
    total_checked: int
    total_blocked: int


class RateLimitStatusResponse(BaseResponse):
    status: RateLimitStatusModel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _validate_value(key: str, value: Any) -> None:
    """Range/type validate one key against RATE_LIMIT_META. Raise 422 on bad.

    422 ``detail`` is wrapped into the standard ``ErrorResponse`` shape by the
    app-level StarletteHTTPException handler in main.py.
    """
    meta = RATE_LIMIT_META.get(key)
    if meta is None:  # pragma: no cover - unknown key guarded by request model
        raise HTTPException(status_code=422, detail=f"Unknown rate-limit key: {key}")

    if meta["type"] == "boolean":
        if not isinstance(value, bool):
            raise HTTPException(
                status_code=422,
                detail={"key": key, "error": "must be a boolean"},
            )
        return

    # numeric
    if isinstance(value, bool) or not isinstance(value, int):
        raise HTTPException(
            status_code=422,
            detail={"key": key, "error": "must be an integer"},
        )
    lo, hi = meta["min"], meta["max"]
    if (lo is not None and value < lo) or (hi is not None and value > hi):
        raise HTTPException(
            status_code=422,
            detail={
                "key": key,
                "error": f"out of range [{lo}, {hi}]",
                "value": value,
            },
        )


async def _read_rate_limit_rows(db: AsyncSession) -> Dict[str, SystemSetting]:
    """Return existing rate_limiting SystemSetting rows keyed by key name."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.category == RATE_LIMIT_CATEGORY)
    )
    return {row.key: row for row in result.scalars().all()}


async def _effective_values(db: AsyncSession) -> Dict[str, Any]:
    """Current effective per-key values (DB row value, else config default)."""
    rows = await _read_rate_limit_rows(db)
    values: Dict[str, Any] = {}
    for key in RATE_LIMIT_KEYS:
        if key in rows:
            values[key] = rows[key].value
        else:
            values[key] = RATE_LIMIT_DEFAULTS[key]
    return values


def _upsert_row(
    rows: Dict[str, SystemSetting],
    db: AsyncSession,
    key: str,
    value: Any,
    username: str,
) -> None:
    """Update an existing rate_limiting row or create it from the default.

    Creating on the fly keeps PUT/reset working on fresh DBs (create_all path)
    where migration 012 has not run.
    """
    meta = RATE_LIMIT_META[key]
    default = RATE_LIMIT_DEFAULTS[key]
    existing = rows.get(key)
    if existing is not None:
        existing.value = value
        existing.updated_by = username
    else:
        row = SystemSetting(
            category=RATE_LIMIT_CATEGORY,
            key=key,
            value=value,
            default_value=default,
            value_type=meta["type"],
            description=meta["description"],
        )
        row.updated_by = username
        db.add(row)
        rows[key] = row


async def _write_audit(
    db: AsyncSession, *, action: str, key: Optional[str], username: str
) -> None:
    """Append a SettingsAuditLog row (same shape as system_settings_service)."""
    db.add(
        SettingsAuditLog(
            setting_type="system_setting",
            category=RATE_LIMIT_CATEGORY,
            key=key,
            action=action,
            changed_by=username,
        )
    )


def _build_config_model(values: Dict[str, Any]) -> RateLimitConfigModel:
    """Build the GET /config payload from effective values (defensive coerce)."""
    cfg = build_config_from_values(values)
    return RateLimitConfigModel(
        enabled=cfg.enabled,
        window_seconds=cfg.window_seconds,
        limits=RateLimitLimitsModel(
            default_per_user_per_min=cfg.limits.normal_user,
            default_per_ip_per_min=cfg.limits.normal_ip,
            ai_generation_per_min=cfg.limits.ai_generation,
            auth_per_ip_per_min=cfg.limits.auth_ip,
            media_serving_per_min=cfg.limits.media_serving,
        ),
        meta={
            key: {
                "default": RATE_LIMIT_DEFAULTS[key],
                "type": RATE_LIMIT_META[key]["type"],
                "min": RATE_LIMIT_META[key]["min"],
                "max": RATE_LIMIT_META[key]["max"],
                "description": RATE_LIMIT_META[key]["description"],
            }
            for key in RATE_LIMIT_KEYS
        },
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/config", response_model=RateLimitConfigResponse)
async def get_config(db: AsyncSession = Depends(get_db_session)):
    """Return the current effective rate-limit config + per-key meta."""
    values = await _effective_values(db)
    return RateLimitConfigResponse(
        success=True,
        message="OK",
        config=_build_config_model(values),
    )


@router.put("/config", response_model=RateLimitConfigResponse)
async def update_config(
    request: RateLimitUpdateRequest,
    admin_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
):
    """Batch-update provided keys. Validate first (422 on bad → nothing written)."""
    # Only keys explicitly provided (not None) are changed.
    updates = {
        k: v for k, v in request.model_dump(exclude_unset=True).items() if v is not None
    }
    if not updates:
        raise HTTPException(status_code=422, detail="No settings provided to update")

    # Validate ALL before writing ANY (atomic w.r.t. validation — out-of-range
    # → 422 and not a single row is written).
    for key, value in updates.items():
        _validate_value(key, value)

    rows = await _read_rate_limit_rows(db)
    for key, value in updates.items():
        _upsert_row(rows, db, key, value, admin_user.username)

    await _write_audit(db, action="update", key=None, username=admin_user.username)
    await db.flush()  # surface DB errors before the dependency commits

    # Near-immediate effect: drop the provider cache so the middleware re-reads.
    rate_limit_config_provider.invalidate()

    values = await _effective_values(db)
    logger.info(
        "rate-limit config updated by %s: %s",
        admin_user.username,
        list(updates.keys()),
    )
    return RateLimitConfigResponse(
        success=True,
        message=f"Updated {len(updates)} rate-limit setting(s)",
        config=_build_config_model(values),
    )


@router.post("/reset", response_model=RateLimitConfigResponse)
async def reset_config(
    admin_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
):
    """Reset all 7 rate-limit keys to their factory defaults."""
    rows = await _read_rate_limit_rows(db)
    for key in RATE_LIMIT_KEYS:
        _upsert_row(rows, db, key, RATE_LIMIT_DEFAULTS[key], admin_user.username)

    await _write_audit(db, action="reset", key=None, username=admin_user.username)
    await db.flush()

    rate_limit_config_provider.invalidate()

    values = await _effective_values(db)
    logger.info("rate-limit config reset to defaults by %s", admin_user.username)
    return RateLimitConfigResponse(
        success=True,
        message="Rate-limit config reset to defaults",
        config=_build_config_model(values),
    )


@router.get("/status", response_model=RateLimitStatusResponse)
async def get_status():
    """Read-only observability: enabled flag + in-process limiter stats."""
    config = await rate_limit_config_provider.get_config()
    snapshot = rate_limiter.stats()
    return RateLimitStatusResponse(
        success=True,
        message="OK",
        status=RateLimitStatusModel(
            enabled=config.enabled,
            active_keys=snapshot["active_keys"],
            total_checked=snapshot["total_checked"],
            total_blocked=snapshot["total_blocked"],
        ),
    )
