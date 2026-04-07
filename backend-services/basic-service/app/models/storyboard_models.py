"""
Data models for AI Storyboard generation, cropping, VL description,
batch video generation, and video composition.
"""

import math
from typing import List, Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.base_models import BaseResponse


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class StoryboardGenerateRequest(BaseModel):
    """Request to generate a multi-cell storyboard image via ARK Seedream."""

    prompt: str = Field(
        ..., max_length=2000, description="User prompt describing the storyboard content"
    )
    grid_size: Optional[str] = Field(
        None, description="Grid layout specification (e.g. '3x3', '2x4'). If omitted, computed from frame_count."
    )
    frame_count: Optional[int] = Field(
        None, ge=1, le=64, description="Desired number of storyboard frames (1-64). Auto-computes optimal grid layout."
    )
    aspect_ratio: Literal["1:1", "16:9", "9:16", "4:3", "3:4"] = Field(
        default="1:1", description="Target aspect ratio for each storyboard cell"
    )
    reference_image: Optional[str] = Field(
        None, description="Optional reference image as base64 data URI"
    )

    @field_validator('grid_size')
    @classmethod
    def validate_grid_size(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        import re
        match = re.match(r'^(\d+)x(\d+)$', v)
        if not match:
            raise ValueError(f"grid_size must be in 'NxM' format, got '{v}'")
        rows, cols = int(match.group(1)), int(match.group(2))
        if not (1 <= rows <= 8 and 1 <= cols <= 8):
            raise ValueError(f"grid_size rows and cols must be between 1 and 8, got '{v}'")
        if rows * cols > 64:
            raise ValueError(f"grid_size total cells ({rows * cols}) exceeds maximum of 64")
        return v

    @model_validator(mode='after')
    def ensure_grid_or_frame_count(self) -> 'StoryboardGenerateRequest':
        if self.grid_size is None and self.frame_count is None:
            self.frame_count = 9
        if self.frame_count is not None and self.grid_size is None:
            rows, cols = compute_optimal_grid(self.frame_count)
            self.grid_size = f"{rows}x{cols}"
        return self


def compute_optimal_grid(frame_count: int) -> tuple:
    """Compute the optimal (rows, cols) grid for a given frame count.

    Picks the near-square layout with rows * cols >= frame_count,
    with rows <= cols (landscape-oriented grid).

    Algorithm: start from cols = ceil(sqrt(n)) and find the first cols
    where rows = ceil(n / cols) satisfies rows <= cols.
    """
    if frame_count <= 0 or frame_count == 1:
        return (1, 1)

    cols = math.ceil(math.sqrt(frame_count))
    while True:
        rows = math.ceil(frame_count / cols)
        if rows <= cols:
            return (rows, cols)
        cols += 1


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
    repeat: int = Field(default=1, ge=1, le=4, description="Number of candidate videos to generate (1-4)")


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
    aspect_ratio: str = Field(default="1:1", description="Aspect ratio of each frame")
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
