"""
Data models for Ark Seedance video generation API.
"""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field

from app.models.base_models import BaseResponse


class ArkVideoGenerateRequest(BaseModel):
    """Request model for creating an Ark video generation task.

    Supports three generation modes:
    - "description" (default): Text prompt with optional reference images (image_url/image_urls).
      Reference images are sent as first_frame/last_frame roles to the ARK API.
      When images are present, ratio is automatically set to "adaptive".
    - "keyframe": Text prompt with explicit first/last frame images (first_frame_url required,
      last_frame_url optional). Additional images from image_urls are included
      beyond first/last frame, up to 4 images total.
      Ratio is always forced to "adaptive".
    - "reference": Text prompt with reference images (image_url/image_urls).
      Images are sent with first_frame/last_frame roles (not reference_image)
      to avoid triggering unsupported task_type=r2v on doubao-seedance-1-5-pro.
      Supports 1-4 reference images. When images are present, ratio is
      automatically set to "adaptive".
    """

    prompt: str = Field(..., description="Text prompt describing the video to generate")
    mode: Literal["description", "keyframe", "reference"] = Field(
        default="description",
        description="Generation mode: 'description' for text+reference images (first/last frame roles), 'keyframe' for explicit first/last frame images, 'reference' for reference images using first_frame/last_frame roles",
    )
    duration: int = Field(
        default=5, ge=4, le=12, description="Video duration in seconds (4-12)"
    )
    camera_fixed: bool = Field(
        default=False, description="Whether to fix the camera position"
    )
    watermark: bool = Field(default=False, description="Whether to add a watermark")

    # Mode "description" fields (also kept for backward compatibility with existing callers)
    image_url: Optional[str] = Field(
        default=None,
        description="Optional reference image URL (used in description mode, kept for backward compatibility)",
    )
    image_urls: Optional[List[str]] = Field(
        default=None,
        description="Optional list of reference image URLs for multi-image reference (used in description, reference, and keyframe modes)",
    )

    # Mode "keyframe" fields
    first_frame_url: Optional[str] = Field(
        default=None,
        description="First frame image URL (required in keyframe mode). Minimum image height: 300px.",
    )
    last_frame_url: Optional[str] = Field(
        default=None,
        description="Last frame image URL (optional in keyframe mode). Only valid when first_frame_url is also provided.",
    )

    aspect_ratio: Literal["16:9", "9:16", "1:1"] = Field(
        default="16:9",
        description="Video aspect ratio (ignored in keyframe mode, forced to 'adaptive')",
    )
    resolution: Literal["480p", "720p", "1080p"] = Field(
        default="720p", description="Video resolution"
    )


class ArkVideoGenerateResponse(BaseResponse):
    """Response model for video generation task creation."""

    ark_task_id: str = Field(
        default="", description="Ark platform task ID for polling status"
    )


class ArkVideoStatusResponse(BaseResponse):
    """Response model for video generation task status."""

    status: Literal["running", "succeeded", "failed", "queued", "timeout"] = Field(
        default="running",
        description="Task status (queued/timeout only returned by storyboard job queue)",
    )
    position_in_queue: Optional[int] = Field(
        default=None,
        description="1-based position in queue; only set when status='queued'",
    )
    video_url: Optional[str] = Field(
        default=None,
        description="Video URL when succeeded (CDN URL immediately; local storage URL after background download completes)",
    )
    thumbnail_url: Optional[str] = Field(
        default=None, description="Thumbnail image URL when succeeded"
    )
    duration: Optional[int] = Field(
        default=None, description="Video duration in seconds"
    )
    width: Optional[int] = Field(default=None, description="Video width in pixels")
    height: Optional[int] = Field(default=None, description="Video height in pixels")
    error: Optional[str] = Field(default=None, description="Error message when failed")
