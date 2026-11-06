"""视频生成请求与本地可用状态契约。"""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.base_models import BaseResponse


class ArkVideoGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    prompt: str = Field(min_length=1, max_length=2000)
    model: str | None = Field(default=None, max_length=128)
    expected_config_revision: UUID | None = None
    mode: Literal["description", "keyframe", "reference"] = "description"
    duration: int = Field(default=5, ge=4, le=12, strict=True)
    camera_fixed: bool = False
    watermark: bool = False
    image_url: str | None = None
    image_urls: list[str] | None = Field(default=None, max_length=8)
    first_frame_url: str | None = None
    last_frame_url: str | None = None
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = "16:9"
    resolution: Literal["480p", "720p", "1080p"] = "720p"

    @field_validator("model")
    @classmethod
    def empty_model_is_default(cls, value: str | None) -> str | None:
        return value or None


class ArkVideoGenerateResponse(BaseResponse):
    ark_task_id: str = ""
    model: str | None = None
    config_revision: str | None = None


class ArkVideoStatusResponse(BaseResponse):
    status: Literal["running", "succeeded", "failed", "queued", "timeout"] = "running"
    phase: Literal["queued", "generating", "downloading", "validating", "ready"] | None = None
    ark_task_id: str | None = None
    model: str | None = None
    position_in_queue: int | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    error: str | None = None
    error_code: str | None = None
