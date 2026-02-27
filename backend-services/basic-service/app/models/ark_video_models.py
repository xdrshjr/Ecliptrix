"""
Data models for Ark Seedance video generation API.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field

from app.models.base_models import BaseResponse


class ArkVideoGenerateRequest(BaseModel):
    """Request model for creating an Ark video generation task."""
    prompt: str = Field(..., description="Text prompt describing the video to generate")
    duration: Literal[5, 10] = Field(default=5, description="Video duration in seconds (5 or 10)")
    camera_fixed: bool = Field(default=False, description="Whether to fix the camera position")
    watermark: bool = Field(default=False, description="Whether to add a watermark")
    image_url: Optional[str] = Field(default=None, description="Optional reference image URL")


class ArkVideoGenerateResponse(BaseResponse):
    """Response model for video generation task creation."""
    ark_task_id: str = Field(default="", description="Ark platform task ID for polling status")


class ArkVideoStatusResponse(BaseResponse):
    """Response model for video generation task status."""
    status: Literal["running", "succeeded", "failed"] = Field(
        default="running",
        description="Task status"
    )
    video_url: Optional[str] = Field(default=None, description="Local storage URL when succeeded")
    thumbnail_url: Optional[str] = Field(default=None, description="Thumbnail image URL when succeeded")
    duration: Optional[int] = Field(default=None, description="Video duration in seconds")
    width: Optional[int] = Field(default=None, description="Video width in pixels")
    height: Optional[int] = Field(default=None, description="Video height in pixels")
    error: Optional[str] = Field(default=None, description="Error message when failed")
