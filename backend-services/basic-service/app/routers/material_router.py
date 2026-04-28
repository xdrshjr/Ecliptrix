"""
Material caching API: lets the frontend (manual modal + Agent flow) explicitly
register remote assets for background pre-download so video export can skip the
slow synchronous download phase.

The same endpoints are now also consumed by the playback-preview pipeline —
when a row is `ready`, the response carries `local_url`, a same-origin URL
that the browser plays directly via the existing `/api/storage/files` mount.
That removes the CDN round-trip from the timeline preview hot path.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.logger import get_logger
from app.services.material_download_service import get_material_download_service

router = APIRouter(prefix="/material", tags=["Material"])
logger = get_logger(__name__)


class MaterialIngestItem(BaseModel):
    source: str = Field(..., description="Asset origin: pexels / unsplash / youtube / url / ark / storyboard")
    source_id: str = Field(..., description="Stable per-source id (e.g. pexels video id)")
    url: str = Field(..., description="Original CDN/source URL")


class MaterialIngestRequest(BaseModel):
    items: List[MaterialIngestItem]


class MaterialIngestResultEntry(BaseModel):
    source: str
    source_id: str
    material_id: str
    status: str
    local_path: Optional[str] = None
    # Same-origin static URL the browser can play directly. Populated only
    # when status == "ready" and the cache file exists on disk. See
    # MaterialDownloadService.local_url_for for the derivation rule.
    local_url: Optional[str] = None
    # Backend cache failure message (e.g. ffmpeg stderr tail). Surfaced so the
    # frontend can show a retry tooltip without an extra round-trip.
    error_message: Optional[str] = None


class MaterialIngestResponse(BaseModel):
    success: bool
    items: List[MaterialIngestResultEntry]


@router.post("/ingest", response_model=MaterialIngestResponse)
async def ingest_materials(request: MaterialIngestRequest) -> MaterialIngestResponse:
    if not request.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="items must be a non-empty list",
        )
    svc = get_material_download_service()
    results: List[MaterialIngestResultEntry] = []
    for item in request.items:
        try:
            res = await svc.enqueue(item.source, item.source_id, item.url)
            material_id = res.get("material_id", "")
            current_status = res.get("status", "pending")
            local_path = res.get("local_path") or None

            # Only resolve local_url for ready rows. enqueue() returns a
            # status snapshot but no row object, so re-query when ready to
            # access the canonical fields used by `local_url_for`.
            local_url: Optional[str] = None
            error_message: Optional[str] = None
            if current_status == "ready" or current_status == "failed":
                row = await svc.lookup_async(
                    url=item.url,
                    source=item.source,
                    source_id=item.source_id,
                )
                if row is not None:
                    local_url = svc.local_url_for(row)
                    if (row.status or "") == "failed":
                        error_message = row.error_message
            results.append(
                MaterialIngestResultEntry(
                    source=item.source,
                    source_id=item.source_id,
                    material_id=material_id,
                    status=current_status,
                    local_path=local_path,
                    local_url=local_url,
                    error_message=error_message,
                )
            )
        except Exception as exc:
            logger.error(
                f"Failed to enqueue material source={item.source} id={item.source_id}: {exc}",
                exc_info=True,
            )
            results.append(
                MaterialIngestResultEntry(
                    source=item.source,
                    source_id=item.source_id,
                    material_id="",
                    status="error",
                    error_message=str(exc)[:200],
                )
            )
    return MaterialIngestResponse(success=True, items=results)


@router.get("/lookup", response_model=MaterialIngestResultEntry)
async def lookup_material(
    url: Optional[str] = Query(default=None, description="Original CDN URL"),
    source: Optional[str] = Query(default=None, description="Asset source (e.g. pexels)"),
    source_id: Optional[str] = Query(default=None, description="Stable per-source id"),
) -> MaterialIngestResultEntry:
    """Return the cached row for the given material if it exists.

    Lookup priority:
      1. (source, source_id) composite key — preferred when supplied. This is
         resilient to Pexels/CDN URL rotation between sessions.
      2. exact `url` match — kept for backwards compat with single-arg callers.

    Always returns 200; consumers check `status` and `local_url` to decide.
    """
    if not (url or (source and source_id)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="must supply either url= or (source= and source_id=)",
        )
    svc = get_material_download_service()
    row = await svc.lookup_async(url=url, source=source, source_id=source_id)
    if row is None:
        return MaterialIngestResultEntry(
            source=source or "",
            source_id=source_id or "",
            material_id="",
            status="missing",
        )

    local_url = svc.local_url_for(row)
    return MaterialIngestResultEntry(
        source=row.source or "",
        source_id=row.source_id or "",
        material_id=str(row.id),
        status=row.status or "",
        local_path=row.local_path,
        local_url=local_url,
        error_message=row.error_message if (row.status or "") == "failed" else None,
    )
