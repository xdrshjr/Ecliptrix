"""特效公开请求的严格结构；保存合法性与可生成性独立。"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EffectError(Exception):
    """Carry a stable public code without exposing runtime paths or tokens."""

    def __init__(self, code: str, message: str = "", status: int = 400,
                 details: dict | None = None) -> None:
        super().__init__(message or code)
        self.code = code
        self.message = message or code
        self.status = status
        self.details = details


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True,
                              allow_inf_nan=False)


class Canvas(StrictModel):
    width: int = Field(1920, ge=64, le=1920)
    height: int = Field(1080, ge=64, le=1920)
    fps: Literal[30] = 30

    @model_validator(mode="after")
    def require_even_pixels(self) -> "Canvas":
        if self.width % 2 or self.height % 2:
            raise ValueError("canvas dimensions must be even")
        return self


class Content(StrictModel):
    title: str = Field("", max_length=120)
    subtitle: str = Field("", max_length=300)


class Palette(StrictModel):
    background: str = Field("#15171A", pattern=r"^#[0-9a-fA-F]{6}$")
    foreground: str = Field("#F5F4F1", pattern=r"^#[0-9a-fA-F]{6}$")
    accent: str = Field("#C87758", pattern=r"^#[0-9a-fA-F]{6}$")


class Typography(StrictModel):
    family: Literal["sans", "serif", "mono"] = "sans"
    scale: float = Field(1, ge=0.6, le=1.4)
    align: Literal["left", "center", "right"] = "center"


class Motion(StrictModel):
    speed: float = Field(1, ge=0.5, le=2)
    intensity: float = Field(1, ge=0, le=1)


class EffectBinding(StrictModel):
    slot: str
    asset_id: str
    kind: Literal["image", "video"]
    fit: Literal["cover", "contain"] = "cover"
    focal_x: float = Field(0.5, ge=0, le=1)
    focal_y: float = Field(0.5, ge=0, le=1)
    index: int | None = Field(None, ge=0, le=7)
    trim_start_seconds: float | None = Field(None, ge=0)

    @model_validator(mode="after")
    def require_valid_binding(self) -> "EffectBinding":
        self.asset_id = str(UUID(self.asset_id))
        if (self.slot == "images") != (self.index is not None):
            raise ValueError("only images slots have a continuous index")
        if self.kind == "image" and self.trim_start_seconds is not None:
            raise ValueError("images cannot have a trim range")
        if self.kind == "video" and self.trim_start_seconds is None:
            self.trim_start_seconds = 0
        return self


class EffectDocument(StrictModel):
    schema_version: Literal[1] = 1
    template_id: str
    template_version: int = Field(1, ge=1)
    canvas: Canvas = Field(default_factory=Canvas)
    duration_frames: int = Field(150, ge=15, le=1800)
    seed: int = Field(1, ge=0, le=2147483647)
    content: Content = Field(default_factory=Content)
    palette: Palette = Field(default_factory=Palette)
    typography: Typography = Field(default_factory=Typography)
    motion: Motion = Field(default_factory=Motion)
    params: dict[str, Any] = Field(default_factory=dict)
    inputs: list[EffectBinding] = Field(default_factory=list, max_length=9)


class SaveDraftRequest(StrictModel):
    name: str = Field("", max_length=100)
    document: dict[str, Any]


class UpdateDraftRequest(SaveDraftRequest):
    expected_version: int = Field(ge=1)


class DeleteDraftRequest(StrictModel):
    expected_version: int = Field(ge=1)


class AttachInputRequest(StrictModel):
    source_ref: str = Field(max_length=2000)
    origin_material_id: str | None = Field(None, max_length=200)


class OutputConfig(StrictModel):
    profile: Literal["mp4-1080p", "mp4-720p"] = "mp4-1080p"


class SubmitJobRequest(StrictModel):
    request_id: str
    draft_id: str
    expected_version: int = Field(ge=1)
    output: OutputConfig = Field(default_factory=OutputConfig)

    @model_validator(mode="after")
    def require_uuid_ids(self) -> "SubmitJobRequest":
        self.request_id = str(UUID(self.request_id))
        self.draft_id = str(UUID(self.draft_id))
        return self
