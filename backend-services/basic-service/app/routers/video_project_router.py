"""
HTTP routes for the Video Editing project list & cards feature.

Ownership contract — the desktop build has a single local owner, so every
endpoint derives ``user_id = LOCAL_OWNER_ID`` server-side instead of reading
it from the request. Request bodies **MUST NOT** contain ``user_id``
(Pydantic models in ``app.models.video_project_models`` enforce that).
"""

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import LOCAL_OWNER_ID
from app.database import get_db_session
from app.logger import get_logger
from app.models import BaseResponse
from app.models.video_project_models import (
    CreateVideoProjectCategoryRequest,
    CreateVideoProjectRequest,
    UpdateVideoProjectCategoryRequest,
    UpdateVideoProjectRequest,
    VideoProjectCategoryListResponse,
    VideoProjectCategoryResponse,
    VideoProjectDeletedData,
    VideoProjectDeletedResponse,
    VideoProjectListData,
    VideoProjectListResponse,
    VideoProjectResponse,
)
from app.services.video_project_service import video_project_service

router = APIRouter(prefix="/video-projects", tags=["video-projects"])
logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@router.get("/categories", response_model=VideoProjectCategoryListResponse)
async def list_video_project_categories(
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectCategoryListResponse:
    user_id = LOCAL_OWNER_ID
    items = await video_project_service.list_categories(db=db, user_id=user_id)
    return VideoProjectCategoryListResponse(
        success=True,
        message=f"Loaded {len(items)} categories",
        data=items,
    )


@router.post("/categories", response_model=VideoProjectCategoryResponse)
async def create_video_project_category(
    payload: CreateVideoProjectCategoryRequest,
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectCategoryResponse:
    user_id = LOCAL_OWNER_ID
    record = await video_project_service.create_category(
        db=db, user_id=user_id, payload=payload
    )
    return VideoProjectCategoryResponse(
        success=True,
        message="Category created successfully",
        data=record,
    )


@router.put(
    "/categories/{category_id}",
    response_model=VideoProjectCategoryResponse,
)
async def update_video_project_category(
    category_id: str,
    payload: UpdateVideoProjectCategoryRequest,
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectCategoryResponse:
    user_id = LOCAL_OWNER_ID
    record = await video_project_service.update_category(
        db=db, user_id=user_id, category_id=category_id, payload=payload
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )
    return VideoProjectCategoryResponse(
        success=True,
        message="Category updated successfully",
        data=record,
    )


@router.delete(
    "/categories/{category_id}",
    response_model=BaseResponse,
)
async def delete_video_project_category(
    category_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> BaseResponse:
    user_id = LOCAL_OWNER_ID
    deleted = await video_project_service.delete_category(
        db=db, user_id=user_id, category_id=category_id
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )
    return BaseResponse(
        success=True,
        message="Category deleted successfully",
        data={"deleted": True, "id": category_id},
    )


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


@router.get("", response_model=VideoProjectListResponse)
async def list_video_projects(
    category_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("recent", pattern="^(recent|created|name)$"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    accept_language: Optional[str] = Header(None, alias="Accept-Language"),
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectListResponse:
    user_id = LOCAL_OWNER_ID
    items, total = await video_project_service.list_projects(
        db=db,
        user_id=user_id,
        category_id=category_id,
        search=search,
        sort=sort,
        limit=limit,
        offset=offset,
        locale=accept_language,
    )
    return VideoProjectListResponse(
        success=True,
        message=f"Loaded {len(items)} projects",
        data=VideoProjectListData(
            items=items,
            total=total,
            limit=limit,
            offset=offset,
        ),
    )


@router.post("", response_model=VideoProjectResponse)
async def create_video_project(
    payload: CreateVideoProjectRequest,
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectResponse:
    user_id = LOCAL_OWNER_ID
    record = await video_project_service.create_project(
        db=db, user_id=user_id, payload=payload
    )
    return VideoProjectResponse(
        success=True,
        message="Project created successfully",
        data=record,
    )


@router.get("/{project_id}", response_model=VideoProjectResponse)
async def get_video_project(
    project_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectResponse:
    user_id = LOCAL_OWNER_ID
    record = await video_project_service.get_project(
        db=db, user_id=user_id, project_id=project_id, touch_last_opened=True
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    return VideoProjectResponse(
        success=True,
        message="Project loaded successfully",
        data=record,
    )


@router.put("/{project_id}", response_model=VideoProjectResponse)
async def update_video_project(
    project_id: str,
    payload: UpdateVideoProjectRequest,
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectResponse:
    user_id = LOCAL_OWNER_ID
    record = await video_project_service.update_project(
        db=db, user_id=user_id, project_id=project_id, payload=payload
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    return VideoProjectResponse(
        success=True,
        message="Project updated successfully",
        data=record,
    )


@router.delete("/{project_id}", response_model=VideoProjectDeletedResponse)
async def delete_video_project(
    project_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectDeletedResponse:
    user_id = LOCAL_OWNER_ID
    deleted = await video_project_service.delete_project(
        db=db, user_id=user_id, project_id=project_id
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    return VideoProjectDeletedResponse(
        success=True,
        message="Project deleted successfully",
        data=VideoProjectDeletedData(deleted=True, id=project_id),
    )
