"""
Preview-proxy router (spec 06 §三 / phase-3 §3.2.7 / §5.3).

Routes
------
* ``POST /api/media/preview-proxy`` — enqueue (or short-circuit on cache
  hit) a 480p baseline transcode for one ``material_id``.
* ``GET /api/media/preview-proxy/status?material_id=...`` — return the
  full status snapshot (DB row + in-memory progress).
* ``GET /api/media/preview-proxy/file?material_id=...`` — 302-redirect to
  the cached output URL, or 404 with ``preview_proxy.not_ready``.

Access: like the rest of the backend, this router is reachable only from
the local renderer over a loopback socket and carries no authorization gate.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.logger import get_logger
from app.security.url_guard import URLGuardError, validate_external_url
from app.services.preview_proxy_service import (
    DEFAULT_PROFILE,
    PreviewProxyError,
    get_preview_proxy_service,
    is_same_origin_storage_url,
)

router = APIRouter(prefix="/media", tags=["Preview Proxy"])
logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class PreviewProxyRequest(BaseModel):
    material_id: Optional[str] = Field(
        default=None, description="cached_materials.id (UUID)."
    )
    source_url: Optional[str] = Field(
        default=None,
        description=(
            "Optional CDN URL — when provided without material_id we ingest "
            "via material_download_service first."
        ),
    )
    profile: Optional[str] = Field(default=DEFAULT_PROFILE)
    priority: Optional[str] = Field(default="normal")


class PreviewProxyTaskData(BaseModel):
    task_id: Optional[str]
    material_id: str
    profile: str
    status: str
    preview_proxy_url: Optional[str]


class PreviewProxyEnvelope(BaseModel):
    success: bool
    data: PreviewProxyTaskData


class PreviewProxyStatusData(BaseModel):
    task_id: Optional[str]
    material_id: str
    profile: str
    status: str
    preview_proxy_url: Optional[str]
    progress_percent: int
    last_error: Optional[str]
    transcoded_at: Optional[str]
    duration_sec: Optional[float]
    bytes: Optional[int]


class PreviewProxyStatusEnvelope(BaseModel):
    success: bool
    data: PreviewProxyStatusData


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def _as_http(exc: PreviewProxyError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"error_code": exc.error_code, "message": str(exc)},
    )


@router.post("/preview-proxy", response_model=PreviewProxyEnvelope, status_code=202)
async def request_preview_proxy(req: PreviewProxyRequest) -> PreviewProxyEnvelope:
    if not req.material_id and not req.source_url:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "preview_proxy.validation",
                "message": "material_id or source_url required",
            },
        )
    # Spec 03 §3.3 (V03-C) — gate genuine external source_urls through the SSRF
    # guard before material_download_service ingests them. Same-origin storage
    # URLs (/api/storage/files/...) are NOT external targets: they map to a file
    # under STORAGE_ROOT that the service validates via
    # validate_local_path_for_ffmpeg. Running validate_external_url on them
    # would reject the relative / localhost forms and break the C2 local-upload
    # seed path (see spec "实施过程发现的方案缺陷" #2).
    if req.source_url and not is_same_origin_storage_url(req.source_url):
        try:
            req.source_url = validate_external_url(req.source_url)
        except URLGuardError as guard_exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "preview_proxy.validation",
                    "message": f"source_url rejected: {guard_exc}",
                },
            ) from guard_exc
    svc = get_preview_proxy_service()
    try:
        task_id, status, url, resolved_id = await svc.ensure_or_enqueue(
            material_id=req.material_id,
            source_url=req.source_url,
            profile=req.profile or DEFAULT_PROFILE,
            priority=req.priority or "normal",
        )
    except PreviewProxyError as exc:
        raise _as_http(exc) from exc
    logger.info(
        "preview_proxy.enqueue",
        extra={
            "material_id": resolved_id,
            "profile": req.profile or DEFAULT_PROFILE,
            "status": status,
            "tasks_queued": svc.get_queue_depth(),
            "failure_total": svc.last_failure_count(),
        },
    )
    return PreviewProxyEnvelope(
        success=True,
        data=PreviewProxyTaskData(
            task_id=task_id,
            material_id=resolved_id,
            profile=req.profile or DEFAULT_PROFILE,
            status=status,
            preview_proxy_url=url,
        ),
    )


@router.get("/preview-proxy/status", response_model=PreviewProxyStatusEnvelope)
async def preview_proxy_status(
    material_id: str = Query(..., description="cached_materials.id"),
    profile: Optional[str] = Query(default=None),
) -> PreviewProxyStatusEnvelope:
    svc = get_preview_proxy_service()
    try:
        snap = await svc.get_status(material_id, profile=profile)
    except PreviewProxyError as exc:
        raise _as_http(exc) from exc
    transcode_ms = svc.last_transcode_duration_ms(material_id)
    if transcode_ms is not None:
        logger.info(
            "preview_proxy.status",
            extra={
                "material_id": material_id,
                "status": snap.get("status"),
                "transcode_duration_ms": transcode_ms,
                "failure_total": svc.last_failure_count(),
            },
        )
    return PreviewProxyStatusEnvelope(
        success=True,
        data=PreviewProxyStatusData(
            task_id=snap["task_id"],
            material_id=snap["material_id"],
            profile=snap["profile"],
            status=snap["status"],
            preview_proxy_url=snap["preview_proxy_url"],
            progress_percent=snap["progress_percent"],
            last_error=snap["last_error"],
            transcoded_at=snap["transcoded_at"],
            duration_sec=snap["duration_sec"],
            bytes=snap["bytes"],
        ),
    )


@router.get("/preview-proxy/file")
async def preview_proxy_file(
    material_id: str = Query(...),
    profile: Optional[str] = Query(default=None),
):
    svc = get_preview_proxy_service()
    try:
        snap = await svc.get_status(material_id, profile=profile)
    except PreviewProxyError as exc:
        raise _as_http(exc) from exc
    if snap["status"] != "cached" or not snap["preview_proxy_url"]:
        logger.info(
            "preview_proxy.file",
            extra={
                "material_id": material_id,
                "status": snap.get("status"),
                "served": False,
                "failure_total": svc.last_failure_count(),
            },
        )
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": "preview_proxy.not_ready",
                "message": f"preview-proxy not yet cached for {material_id}",
            },
        )
    logger.info(
        "preview_proxy.file",
        extra={
            "material_id": material_id,
            "status": snap.get("status"),
            "served": True,
            "failure_total": svc.last_failure_count(),
        },
    )
    return RedirectResponse(url=snap["preview_proxy_url"], status_code=302)
