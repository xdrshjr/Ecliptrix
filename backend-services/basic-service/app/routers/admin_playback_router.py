"""
Admin endpoints for Playback v2 rollout observability (Phase 4 spec §4.1).

Routes (mounted by ``app.main`` under ``/api``)
-----------------------------------------------
* ``GET /api/admin/playback-proxies`` — paginated read-only view over the
  ``cached_materials`` rows whose ``preview_proxy_*`` fields are in a
  non-terminal state (queued / running / failed).
* ``GET /api/admin/playback-metrics`` — process-local aggregator snapshot
  for the rollout-playbook §4.4 thresholds.

Both endpoints require ``is_admin`` (see ``app.dependencies.auth``).
"""

from __future__ import annotations

import base64
import os
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db_session
from app.dependencies.auth import require_admin
from app.logger import get_logger
from app.models.db_models import CachedMaterial, User
from app.services.playback_metrics_aggregator import (
    PlaybackMetricsAggregator,
    get_playback_metrics_aggregator,
)


# router-level prefix is /admin — main.py adds the /api prefix when mounting
router = APIRouter(prefix="/admin", tags=["Playback Admin"])
logger = get_logger(__name__)


_ALLOWED_STATUSES = {"absent", "queued", "running", "cached", "failed"}
_DEFAULT_STATUSES = ["queued", "running", "failed"]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class PlaybackProxyItem(BaseModel):
    material_id: str
    profile: Optional[str]
    status: str
    progress: float
    transcoded_at: Optional[str]
    bytes: Optional[int]
    error: Optional[str]


class PlaybackProxiesData(BaseModel):
    items: List[PlaybackProxyItem]
    nextCursor: Optional[str] = None
    total: int


class PlaybackProxiesResponse(BaseModel):
    success: bool = True
    data: PlaybackProxiesData


class PlaybackMetricsData(BaseModel):
    window: str
    windowMinutes: int
    retentionHours: int
    playheadRegressionLast24h: int
    stalledEventLast24h: int
    errorLast24h: int
    clickToFirstFramePct95Ms: Optional[float]
    seekToFirstFramePct95Ms: Optional[float]
    swapLatencyPct95Ms: Optional[float]
    previewProxyHitRate: Optional[float]
    cacheMemoryMbAvg: Optional[float]
    canvasDroppedFrameRateAvg: Optional[float]
    stalledRatioWindow: Optional[float]
    sampleCount: int


class PlaybackMetricsResponse(BaseModel):
    success: bool = True
    data: PlaybackMetricsData
    worker_pid: int
    degraded: bool
    degraded_reason: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _decode_cursor(cursor: Optional[str]) -> Optional[Dict[str, str]]:
    """Decode a base64 ``transcoded_at_iso|material_id`` composite cursor."""
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        ts_part, _, id_part = raw.partition("|")
        if not id_part:
            return None
        return {"transcoded_at": ts_part or "", "material_id": id_part}
    except Exception:  # noqa: BLE001
        return None


def _encode_cursor(transcoded_at_iso: Optional[str], material_id: str) -> str:
    payload = f"{transcoded_at_iso or ''}|{material_id}"
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")


def _detect_worker_environment() -> Dict[str, Any]:
    """Detect whether this process is one of many workers.

    Returns a dict with ``worker_pid`` plus ``degraded`` + optional
    ``reason``. The check intentionally only inspects environment hints
    (``GUNICORN_WORKERS`` / ``UVICORN_WORKERS`` / ``WEB_CONCURRENCY``)
    because gunicorn pre-forks before the FastAPI app boots and there is
    no in-process API for the parent's worker count.
    """
    pid = os.getpid()
    raw_candidates = [
        os.environ.get("GUNICORN_WORKERS"),
        os.environ.get("UVICORN_WORKERS"),
        os.environ.get("WEB_CONCURRENCY"),
    ]
    worker_count = 1
    for raw in raw_candidates:
        if raw is None or raw == "":
            continue
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        worker_count = max(worker_count, value)
    requires_single = getattr(
        settings, "playback_v2_aggregator_requires_single_worker", True
    )
    if worker_count > 1 and requires_single:
        return {
            "worker_pid": pid,
            "degraded": True,
            "reason": (
                f"aggregator detected worker_count={worker_count}; "
                "spec §3.2.7 requires single-worker for accurate rollup"
            ),
        }
    return {"worker_pid": pid, "degraded": False, "reason": None}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get(
    "/playback-proxies",
    response_model=PlaybackProxiesResponse,
    status_code=status.HTTP_200_OK,
)
async def list_playback_proxies(
    status_filter: Optional[str] = Query(
        default=None,
        alias="status",
        description="absent|queued|running|cached|failed",
    ),
    limit: int = Query(default=100, ge=1, le=500),
    cursor: Optional[str] = Query(default=None),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> PlaybackProxiesResponse:
    """Return a page of preview-proxy rows for admin observability."""
    if status_filter is not None and status_filter not in _ALLOWED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "playback_admin.invalid_status",
                "message": (
                    f"status must be one of {sorted(_ALLOWED_STATUSES)}; got {status_filter!r}"
                ),
            },
        )

    statuses = [status_filter] if status_filter else _DEFAULT_STATUSES

    # NOTE: query uses real column names (R-P1-2). Response body uses short
    # names for downstream consumption.
    stmt = (
        select(CachedMaterial)
        .where(CachedMaterial.preview_proxy_status.in_(statuses))
        .order_by(
            desc(CachedMaterial.preview_proxy_transcoded_at),
            desc(CachedMaterial.id),
        )
        .limit(limit + 1)
    )

    parsed_cursor = _decode_cursor(cursor)
    if parsed_cursor:
        # Composite cursor: rows with (transcoded_at, material_id) strictly
        # less-than the cursor pair. SQLite (test env) lacks tuple
        # comparison, so we apply a coarse filter on transcoded_at and an
        # in-memory fallback for the id tiebreak.
        raw_ts = parsed_cursor.get("transcoded_at") or ""
        if raw_ts:
            from datetime import datetime

            try:
                cursor_dt = datetime.fromisoformat(raw_ts)
                stmt = stmt.where(
                    CachedMaterial.preview_proxy_transcoded_at.is_(None)
                    | (CachedMaterial.preview_proxy_transcoded_at <= cursor_dt)
                )
            except ValueError:
                pass

    result = await db.execute(stmt)
    rows: List[CachedMaterial] = list(result.scalars().all())

    # Apply secondary id filter (cursor tiebreak) before slicing.
    if parsed_cursor:
        cursor_mid = parsed_cursor.get("material_id") or ""
        rows = [r for r in rows if str(r.id) != cursor_mid]

    has_more = len(rows) > limit
    page = rows[:limit]

    items = [
        PlaybackProxyItem(
            material_id=str(row.id),
            profile=row.preview_proxy_profile,
            status=row.preview_proxy_status or "absent",
            progress=(row.preview_proxy_progress or 0) / 100.0,
            transcoded_at=(
                row.preview_proxy_transcoded_at.isoformat()
                if row.preview_proxy_transcoded_at
                else None
            ),
            bytes=row.preview_proxy_bytes,
            error=row.preview_proxy_last_error,
        )
        for row in page
    ]

    next_cursor: Optional[str] = None
    if has_more and page:
        last = page[-1]
        last_ts = (
            last.preview_proxy_transcoded_at.isoformat()
            if last.preview_proxy_transcoded_at
            else None
        )
        next_cursor = _encode_cursor(last_ts, str(last.id))

    return PlaybackProxiesResponse(
        data=PlaybackProxiesData(
            items=items, nextCursor=next_cursor, total=len(items)
        )
    )


@router.get(
    "/playback-metrics",
    response_model=PlaybackMetricsResponse,
    status_code=status.HTTP_200_OK,
)
async def get_playback_metrics(
    window: Literal["5m", "15m", "1h"] = Query(default="15m"),
    _admin: User = Depends(require_admin),
    aggregator: PlaybackMetricsAggregator = Depends(get_playback_metrics_aggregator),
) -> PlaybackMetricsResponse:
    """Return the in-process aggregator snapshot for the chosen window."""
    minutes = {"5m": 5, "15m": 15, "1h": 60}[window]
    snap = await aggregator.snapshot(window_minutes=minutes)
    env_info = _detect_worker_environment()
    return PlaybackMetricsResponse(
        data=PlaybackMetricsData(**snap),
        worker_pid=env_info["worker_pid"],
        degraded=env_info["degraded"],
        degraded_reason=env_info["reason"],
    )
