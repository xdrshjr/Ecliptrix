"""
Data models for Ark Seedream image generation API.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field

from app.models.base_models import BaseResponse


class ArkImageGenerateRequest(BaseModel):
    """Request model for generating images via Ark Seedream API."""
    prompt: str = Field(..., description="Text prompt describing the image to generate")
    size: Literal[
        "1024x1024", "2048x2048", "1280x720", "720x1280", "1024x576", "576x1024"
    ] = Field(default="2048x2048", description="Image dimensions (WxH)")
    count: int = Field(default=1, ge=1, le=4, description="Number of images to generate (1-4)")
    watermark: bool = Field(default=True, description="Whether to add a watermark")


class ArkImageResult(BaseModel):
    """Single generated image result."""
    image_url: str = Field(default="", description="Image URL (CDN or local)")
    local_url: Optional[str] = Field(default=None, description="Local storage URL")
    width: int = Field(default=0, description="Image width in pixels")
    height: int = Field(default=0, description="Image height in pixels")


class ArkImageGenerateResponse(BaseResponse):
    """Response model for image generation."""
    images: list[ArkImageResult] = Field(default_factory=list, description="Generated image results")
