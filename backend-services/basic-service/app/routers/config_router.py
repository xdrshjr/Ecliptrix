"""
Public runtime-config endpoints (spec 08 §4.2).

Currently exposes the playback-v2 rollout decision. Future runtime config
(experiments, fast-fail flags) belongs here as well — keep the response
shape compatible with the ``{success, data}`` envelope used by the rest of
the API.
"""

from __future__ import annotations

import hashlib
import os
import re
from typing import Optional

from fastapi import APIRouter, Header, Query

from app.logger import get_logger
from app.models.model_settings_models import ModelFunctionType
from app.services.model_settings_service import model_settings_service

router = APIRouter(prefix="/config", tags=["Config"])
logger = get_logger(__name__)

_FLAG_HASH_SALT = "playback_v2"

# Mirrors the desktop env.template placeholder convention (your_*_here) so a
# template value copied verbatim into a web .env still reads as "unconfigured".
_PLACEHOLDER_PATTERN = re.compile(r"^your_.*_here$", re.IGNORECASE)


def _parse_rollout_percent() -> int:
    raw = os.getenv("PLAYBACK_V2_ROLLOUT_PERCENT", "0")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return 0
    return max(0, min(value, 100))


def _parse_force_enabled() -> set[str]:
    raw = os.getenv("PLAYBACK_V2_FORCE_ENABLED_USER_IDS", "")
    return {uid.strip() for uid in raw.split(",") if uid.strip()}


def _bucket(user_id: str) -> int:
    """Stable 0..99 bucket from user id + salt (spec 08 §10 Q4)."""
    digest = hashlib.sha256(f"{user_id}{_FLAG_HASH_SALT}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


@router.get("/llm-status")
async def llm_status() -> dict:
    """Report whether a usable CHAT LLM credential exists (DB assignment or env).

    Public by design (auth middleware allowlists /api/config/) and secret-free:
    only booleans/enums are returned so the renderer can decide whether to show
    the first-run setup guide. NEVER add api_key/api_url fields here.
    """
    try:
        config = await model_settings_service.get_effective_config(ModelFunctionType.CHAT)
        api_key = (config.api_key or "").strip()
        api_url = (config.api_url or "").strip()
        configured = bool(api_key) and bool(api_url) and not _PLACEHOLDER_PATTERN.match(api_key)
        source = config.source if configured else "none"
    except Exception:
        # R4: resolution fault ≠ "unconfigured" — signal indeterminate so the
        # renderer maps it to 'unknown' and does NOT flash the setup guide at
        # an already-configured admin during a transient backend fault.
        logger.exception("llm-status resolution failed — reporting indeterminate")
        return {"success": False, "data": {"configured": False, "source": "none"}}
    return {"success": True, "data": {"configured": configured, "source": source}}


@router.get("/playback-flag")
async def playback_flag(
    user_id: Optional[str] = Query(default=None, alias="userId"),
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Return whether the calling user should see the v2 playback stack.

    Resolution order, matching spec 08 §4.2:
      1. ``PLAYBACK_V2_FORCE_ENABLED_USER_IDS`` opt-in list → enabled.
      2. ``PLAYBACK_V2_ENABLED`` master env (defaults true) is hard off only
         when set to ``false`` — leaves rollout-percent gating active.
      3. Hash-based bucketing with ``PLAYBACK_V2_ROLLOUT_PERCENT``.
    """
    rollout_percent = _parse_rollout_percent()
    force_enabled = _parse_force_enabled()
    master_enabled = os.getenv("PLAYBACK_V2_ENABLED", "true").lower() != "false"

    effective_user = user_id or ""
    if not effective_user and authorization:
        # The session-token middleware exposes ``user_id`` on the request but
        # this endpoint is intentionally cheap and stateless. Fall back to a
        # hash of the token tail so the same browser stays in the same
        # bucket without us having to look the user up.
        effective_user = hashlib.sha256(authorization.encode("utf-8")).hexdigest()[:12]

    if effective_user in force_enabled:
        return {
            "success": True,
            "data": {
                "enabled": True,
                "rolloutPercent": rollout_percent,
                "reason": "force-enabled",
            },
        }

    if not master_enabled:
        return {
            "success": True,
            "data": {
                "enabled": False,
                "rolloutPercent": rollout_percent,
                "reason": "master-disabled",
            },
        }

    if not effective_user:
        # Anonymous request — use the rollout percent against a coin flip.
        enabled = rollout_percent >= 100
        return {
            "success": True,
            "data": {
                "enabled": enabled,
                "rolloutPercent": rollout_percent,
                "reason": "anonymous",
            },
        }

    bucket = _bucket(effective_user)
    enabled = bucket < rollout_percent
    return {
        "success": True,
        "data": {
            "enabled": enabled,
            "rolloutPercent": rollout_percent,
            "reason": f"bucket={bucket}",
        },
    }
