"""
Material caching API: lets the frontend (manual modal + Agent flow) explicitly
register remote assets for background pre-download so video export can skip the
slow synchronous download phase.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.logger import get_logger
from app.services.material_download_service import get_material_download_service

router = APIRouter(prefix="/material", tags=["Material"])
logger = get_logger(__name__)


class MaterialIngestItem(BaseModel):
    source: str = Field(..., description="Asset origin: pexels / unsplash / youtube / url")
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
            results.append(
                MaterialIngestResultEntry(
                    source=item.source,
                    source_id=item.source_id,
                    material_id=res.get("material_id", ""),
                    status=res.get("status", "pending"),
                    local_path=res.get("local_path") or None,
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
                )
            )
    return MaterialIngestResponse(success=True, items=results)


@router.get("/lookup", response_model=MaterialIngestResultEntry)
async def lookup_material(url: str) -> MaterialIngestResultEntry:
    """Return a ready local_path for the given source URL if cached."""
    svc = get_material_download_service()
    local_path = await svc.lookup_by_url_async(url)
    return MaterialIngestResultEntry(
        source="",
        source_id="",
        material_id="",
        status="ready" if local_path else "missing",
        local_path=local_path,
    )
