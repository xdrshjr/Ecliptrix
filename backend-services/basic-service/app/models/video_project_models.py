"""
Pydantic request / response models for video project list & card endpoints.

User identity is always derived server-side from the authenticated session
(see ``app.dependencies.auth.get_current_user``). The request models in this
module **MUST NOT** include ``user_id`` — passing one would be silently ignored
but is forbidden by the auth contract for these endpoints.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.models import BaseResponse


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class CreateVideoProjectCategoryRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Category name")
    color: Optional[str] = Field(None, max_length=20, description="Optional hex color tag")
    sort_order: Optional[int] = Field(0, description="Display order")


class UpdateVideoProjectCategoryRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    color: Optional[str] = Field(None, max_length=20)
    sort_order: Optional[int] = Field(None)


class VideoProjectCategoryRecord(BaseModel):
    id: str = Field(..., description="Category ID")
    name: str
    color: Optional[str] = None
    sort_order: int = 0
    created_at: str
    updated_at: str


class VideoProjectCategoryListResponse(BaseResponse):
    data: List[VideoProjectCategoryRecord] = Field(default_factory=list)


class VideoProjectCategoryResponse(BaseResponse):
    data: VideoProjectCategoryRecord


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


class CreateVideoProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Project name")
    description: Optional[str] = Field(None, description="Project description")
    category_id: Optional[str] = Field(None, description="Optional category ID")
    cover_url: Optional[str] = Field(None, max_length=1000, description="Optional cover image URL")
    project_data: Optional[Dict[str, Any]] = Field(
        None,
        description="Full VideoEditingTaskContent payload",
    )


class UpdateVideoProjectRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    category_id: Optional[str] = None
    cover_url: Optional[str] = Field(None, max_length=1000)
    project_data: Optional[Dict[str, Any]] = None


class VideoProjectListItem(BaseModel):
    """Lightweight projection for list endpoints — excludes ``project_data``
    which can be megabytes per row when materials are loaded.
    """
    id: str
    name: str
    description: Optional[str] = None
    category_id: Optional[str] = None
    cover_url: Optional[str] = None
    created_at: str
    updated_at: str
    last_opened_at: Optional[str] = None


class VideoProjectRecord(BaseModel):
    """Full project record returned from create / get / update endpoints.
    Includes ``project_data`` (the full VideoEditingTaskContent).
    """
    id: str
    name: str
    description: Optional[str] = None
    category_id: Optional[str] = None
    cover_url: Optional[str] = None
    project_data: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str
    last_opened_at: Optional[str] = None


class VideoProjectListData(BaseModel):
    items: List[VideoProjectListItem] = Field(default_factory=list)
    total: int = 0
    limit: int = 100
    offset: int = 0


class VideoProjectListResponse(BaseResponse):
    data: VideoProjectListData


class VideoProjectResponse(BaseResponse):
    data: VideoProjectRecord


class VideoProjectDeletedData(BaseModel):
    deleted: bool = True
    id: str


class VideoProjectDeletedResponse(BaseResponse):
    data: VideoProjectDeletedData
