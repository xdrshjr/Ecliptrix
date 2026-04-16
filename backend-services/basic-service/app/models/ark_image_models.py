"""
Data models for Ark Seedream image generation API.
"""

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field

from app.models.base_models import BaseResponse


class ArkImageGenerateRequest(BaseModel):
    """Request model for generating images via Ark Seedream API."""

    prompt: str = Field(..., description="Text prompt describing the image to generate")
    size: Literal[
        "1024x1024", "2048x2048", "1280x720", "720x1280", "1024x576", "576x1024"
    ] = Field(default="2048x2048", description="Image dimensions (WxH)")
    count: int = Field(
        default=1, ge=1, le=4, description="Number of images to generate (1-4)"
    )
    watermark: bool = Field(default=True, description="Whether to add a watermark")
    mode: Literal["basic", "character", "scene"] = Field(
        default="basic", description="Generation mode"
    )
    reference_image: Optional[str] = Field(
        default=None,
        description=(
            "Reference image — accepts a base64 data URI, a public HTTPS URL, "
            "or a local `/api/storage/files/...` serving path; local paths are "
            "inlined as data URIs before being forwarded to ARK."
        ),
    )
    reference_images: Optional[List[str]] = Field(
        default=None,
        max_length=4,
        description=(
            "Multi-reference images — list of base64 data URIs, public HTTPS URLs, "
            "or local `/api/storage/files/...` paths. Max 4 images. Takes priority "
            "over reference_image when provided."
        ),
    )
    mentioned_images: Optional[Dict[str, str]] = Field(
        default=None,
        description=(
            "Mapping of @mention tags to image URLs/base64. Keys are mention "
            "tags like @[image_name], values are the corresponding image references."
        ),
    )
    grid_mode: bool = Field(
        default=True,
        description=(
            "When true and mode is character/scene, generate a 3x3 grid pack "
            "and auto-crop into 9 frame PNGs on disk (new behavior). When "
            "false, keep the legacy single-image behavior."
        ),
    )
    aspect_ratio: Literal["1:1", "16:9", "9:16", "4:3", "3:4"] = Field(
        default="1:1",
        description="Per-cell target aspect ratio when grid_mode is enabled.",
    )


class ArkImageResult(BaseModel):
    """Single generated image result."""

    image_url: str = Field(default="", description="Image URL (CDN or local)")
    local_url: Optional[str] = Field(default=None, description="Local storage URL")
    width: int = Field(default=0, description="Image width in pixels")
    height: int = Field(default=0, description="Image height in pixels")


class ArkImagePackFrame(BaseModel):
    """Single frame inside a character/scene grid pack."""

    index: int
    filename: str
    url: str
    row: int
    col: int
    sub_view: Optional[str] = None


class ArkImagePack(BaseModel):
    """Character/scene grid pack (9 frames + original composite)."""

    pack_id: str
    pack_type: Literal["character", "scene"]
    prompt: str
    grid_size: str = "3x3"
    aspect_ratio: str = "1:1"
    frame_count: int = 9
    created_at: str
    original_image_url: str
    reference_image_url: Optional[str] = None
    frames: List[ArkImagePackFrame] = Field(default_factory=list)


class ArkImageGenerateResponse(BaseResponse):
    """Response model for image generation.

    The ``images`` list is preserved unchanged for backward compatibility: in
    grid mode, ``images[0]`` is always the composite original so existing
    callers can keep rendering a single image. The full pack is exposed via
    the ``pack`` field when ``grid_mode=true``.
    """

    images: List[ArkImageResult] = Field(
        default_factory=list, description="Generated image results"
    )
    pack: Optional[ArkImagePack] = Field(
        default=None, description="Grid pack when grid_mode is enabled"
    )
