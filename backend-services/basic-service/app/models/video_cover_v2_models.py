"""封面工作室的严格 wire 契约，所有字段使用 snake_case。"""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CoverModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class CoverFields(CoverModel):
    title: str = Field(default="", max_length=80)
    subtitle: str = Field(default="", max_length=160)
    label: str = Field(default="", max_length=24)


class CoverTypography(CoverModel):
    family: Literal["sans", "serif", "mono"] = "sans"
    title_scale: float = Field(default=1.0, ge=0.5, le=1.5)
    align: Literal["left", "center", "right"] = "left"
    text_color: str = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    accent_color: str = Field(default="#d97757", pattern=r"^#[0-9a-fA-F]{6}$")


class CoverBackground(CoverModel):
    kind: Literal["solid", "gradient", "asset"] = "solid"
    color: str = Field(default="#181818", pattern=r"^#[0-9a-fA-F]{6}$")
    asset_id: UUID | None = None
    focus_x: float = Field(default=0.5, ge=0, le=1)
    focus_y: float = Field(default=0.5, ge=0, le=1)

    @model_validator(mode="after")
    def validate_asset_kind(self):
        if self.kind != "asset" and self.asset_id is not None:
            raise ValueError("纯色和渐变背景不能携带资产")
        return self


class CoverGeneration(CoverModel):
    prompt: str = Field(default="", max_length=2000)
    count: Literal[1, 2, 4] = 1


CoverAspectRatio = Literal["16:9", "9:16", "1:1", "4:3", "21:9"]
CoverTemplateId = Literal[
    "editorial", "cinematic", "knowledge", "product", "bold"
]


class CoverDocument(CoverModel):
    schema_version: Literal[2] = 2
    mode: Literal["html", "ai", "mixed"] = "html"
    template_id: CoverTemplateId = "editorial"
    template_version: Literal[1] = 1
    aspect_ratio: CoverAspectRatio = "16:9"
    fields: CoverFields = Field(default_factory=CoverFields)
    typography: CoverTypography = Field(default_factory=CoverTypography)
    background: CoverBackground = Field(default_factory=CoverBackground)
    generation: CoverGeneration = Field(default_factory=CoverGeneration)
    duration_frames: int = Field(default=30, ge=3, le=150, strict=True)


class SaveCoverRequest(CoverModel):
    expected_version: int = Field(ge=0, strict=True)
    document: CoverDocument


class CoverRequestKey(CoverModel):
    request_id: str = Field(min_length=1, max_length=160)


class ImportCoverRequest(CoverRequestKey):
    source_project_id: UUID
    source_revision_id: UUID


class CoverAssetSource(CoverModel):
    source_asset_url: str = Field(min_length=1, max_length=2000)


class CoverJobRequest(CoverRequestKey):
    base_version: int = Field(ge=1, strict=True)
    mode: Literal["ai", "mixed"]
    template_id: CoverTemplateId
    prompt: str = Field(min_length=1, max_length=2000)
    count: Literal[1, 2, 4] = 1
    aspect_ratio: CoverAspectRatio
    reference_asset_ids: list[UUID] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def validate_prompt(self):
        if not self.prompt.strip():
            raise ValueError("请输入生图提示词")
        return self


COVER_DIMENSIONS = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "4:3": (1440, 1080),
    "21:9": (2560, 1080),
}


class CoverError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status: int = 400,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details or {}
