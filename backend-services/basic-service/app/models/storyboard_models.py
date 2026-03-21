"""
Data models for AI Storyboard generation, cropping, VL description,
batch video generation, and video composition.
"""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field

from app.models.base_models import BaseResponse


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class StoryboardGenerateRequest(BaseModel):
    """Request to generate a multi-cell storyboard image via ARK Seedream."""

    prompt: str = Field(
        ..., max_length=2000, description="User prompt describing the storyboard content"
    )
    grid_size: Literal["2x2", "3x3", "4x4", "6x6", "8x8"] = Field(
        default="3x3", description="Grid layout specification (rows x cols)"
    )
    reference_image: Optional[str] = Field(
        None, description="Optional reference image as base64 data URI"
    )


class StoryboardDescribeRequest(BaseModel):
    """Request to generate VL_LLM descriptions for storyboard frames."""

    pack_id: str = Field(..., description="Storyboard pack ID")
    frame_indices: Optional[List[int]] = Field(
        None, description="Specific frame indices to describe (None = all frames)"
    )


class StoryboardVideoSegment(BaseModel):
    """Parameters for a single frame's video generation."""

    frame_index: int = Field(..., description="Index of the frame in the storyboard pack")
    description: str = Field(..., description="Scene description for video generation")
    duration: int = Field(default=5, ge=4, le=12, description="Video duration in seconds")


class StoryboardBatchVideoRequest(BaseModel):
    """Request to batch-submit video generation tasks for storyboard frames."""

    pack_id: str = Field(..., description="Storyboard pack ID")
    segments: List[StoryboardVideoSegment] = Field(
        ..., description="List of frame segments to generate videos for"
    )


class StoryboardComposeRequest(BaseModel):
    """Request to compose (concatenate) storyboard videos into one video."""

    pack_id: str = Field(..., description="Storyboard pack ID")
    video_urls: List[str] = Field(
        ..., description="Ordered list of video URLs to concatenate"
    )


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class StoryboardFrame(BaseModel):
    """Metadata for a single cropped storyboard frame."""

    index: int = Field(..., description="Zero-based frame index")
    filename: str = Field(..., description="Frame image filename (e.g. frame_001.png)")
    url: str = Field(..., description="Accessible URL for the frame image")
    row: int = Field(..., description="Row position in the grid (0-based)")
    col: int = Field(..., description="Column position in the grid (0-based)")
    description: Optional[str] = Field(None, description="VL_LLM generated scene description")


class StoryboardPack(BaseModel):
    """Complete storyboard pack metadata."""

    pack_id: str = Field(..., description="Unique pack identifier")
    prompt: str = Field(..., description="Original user prompt")
    grid_size: str = Field(..., description="Grid specification (e.g. '3x3')")
    frame_count: int = Field(..., description="Total number of frames")
    created_at: str = Field(..., description="ISO-8601 creation timestamp")
    original_image_url: str = Field(..., description="URL of the original storyboard image")
    reference_image_url: Optional[str] = Field(
        None, description="URL of the user-provided reference image"
    )
    frames: List[StoryboardFrame] = Field(
        default_factory=list, description="List of cropped frame metadata"
    )


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class StoryboardGenerateResponse(BaseResponse):
    """Response for storyboard generation."""

    data: Optional[StoryboardPack] = Field(None, description="Generated storyboard pack")


class StoryboardDescribeResponse(BaseResponse):
    """Response for VL_LLM frame description generation."""

    descriptions: List[dict] = Field(
        default_factory=list,
        description="List of {index, description} dicts for each described frame",
    )


class StoryboardBatchVideoResponse(BaseResponse):
    """Response for batch video generation task submission."""

    tasks: List[dict] = Field(
        default_factory=list,
        description="List of {frame_index, ark_task_id} dicts",
    )


class StoryboardBatchVideoStatusResponse(BaseResponse):
    """Response for querying batch video generation status."""

    statuses: List[dict] = Field(
        default_factory=list,
        description="List of per-frame status dicts",
    )


class StoryboardListResponse(BaseResponse):
    """Response for listing storyboard packs."""

    data: List[StoryboardPack] = Field(
        default_factory=list, description="List of storyboard packs"
    )


class StoryboardComposeResponse(BaseResponse):
    """Response for video composition."""

    video_url: Optional[str] = Field(None, description="URL of the composed video")
    thumbnail_url: Optional[str] = Field(None, description="URL of the composed video thumbnail")
