"""
HTTP routes for the per-project Video Cover authoring feature.

Ownership contract — the desktop build has a single local owner, so every
endpoint derives ``user_id = LOCAL_OWNER_ID`` server-side instead of reading
it from the request.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import LOCAL_OWNER_ID
from app.database import get_db_session
from app.logger import get_logger
from app.models import BaseResponse
from app.models.video_cover_models import (
    CoverStateIn,
    CoverStateResponse,
    PngCacheData,
    PngCacheResponse,
)
from app.services.video_cover_service import video_cover_service

router = APIRouter(prefix="/video-cover", tags=["video-cover"])
logger = get_logger(__name__)


PNG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.get("/{project_id}", response_model=CoverStateResponse)
async def get_video_cover(
    project_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> CoverStateResponse:
    """Load the cover authoring state. Returns ``data: null`` when the
    project exists but no cover has been authored yet."""
    user_id = LOCAL_OWNER_ID
    state = await video_cover_service.get_by_project(
        db=db, user_id=user_id, project_id=project_id
    )
    return CoverStateResponse(
        success=True,
        message="Cover state loaded" if state is not None else "No cover yet",
        data=state,
    )


@router.put("/{project_id}", response_model=CoverStateResponse)
async def put_video_cover(
    project_id: str,
    payload: CoverStateIn,
    db: AsyncSession = Depends(get_db_session),
) -> CoverStateResponse:
    """Upsert the cover authoring state for ``project_id``."""
    user_id = LOCAL_OWNER_ID
    state = await video_cover_service.upsert(
        db=db,
        user_id=user_id,
        project_id=project_id,
        payload=payload,
    )
    if state is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    return CoverStateResponse(
        success=True,
        message="Cover state saved",
        data=state,
    )


@router.post("/{project_id}/png-cache", response_model=PngCacheResponse)
async def post_video_cover_png_cache(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session),
) -> PngCacheResponse:
    """Persist a freshly-rendered cover PNG and stamp ``cover_url`` with a
    cache-busted URL. The same URL is returned in the response so the client
    can update its in-memory project record without a re-fetch.
    """
    user_id = LOCAL_OWNER_ID

    if file.content_type and file.content_type.lower() != "image/png":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only image/png is accepted for cover cache",
        )

    # Read with a hard size guard to avoid pulling 100 MB into RAM.
    body = await file.read()
    if len(body) > PNG_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"PNG exceeds {PNG_MAX_BYTES} bytes",
        )

    try:
        result = await video_cover_service.store_png_and_update_project(
            db=db,
            user_id=user_id,
            project_id=project_id,
            png_bytes=body,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    url, updated_at = result
    return PngCacheResponse(
        success=True,
        message="Cover PNG cached",
        data=PngCacheData(url=url, updated_at=updated_at or datetime.now(timezone.utc).isoformat()),
    )


@router.delete("/{project_id}", response_model=BaseResponse)
async def delete_video_cover(
    project_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> BaseResponse:
    """Optional cleanup endpoint — removes the cover row + on-disk artifacts
    for a project without touching the project itself."""
    user_id = LOCAL_OWNER_ID
    # Ownership check via get_by_project (returns None if foreign or missing)
    state = await video_cover_service.get_by_project(
        db=db, user_id=user_id, project_id=project_id
    )
    if state is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cover not found",
        )
    await video_cover_service.delete_for_project(db, project_id)
    return BaseResponse(
        success=True,
        message="Cover deleted",
        data={"deleted": True, "project_id": project_id},
    )
