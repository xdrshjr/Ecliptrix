"""
Pydantic request / response models for the per-project video cover endpoints.

Ownership is always injected server-side from the ``LOCAL_OWNER_ID``
constant (``app.constants``), never read from the request. The request models in this module
**MUST NOT** include ``user_id`` — it is set server-side and ignored if sent.

The CoverConfig shape carried in ``cover_config`` is structurally validated:
unknown top-level fields are rejected so frontend bugs surface immediately.
"""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import BaseResponse


# ---------------------------------------------------------------------------
# Allowed enums (tightened by spec §4.2 and §5.1)
# ---------------------------------------------------------------------------

CoverTemplateId = Literal["title", "tutorial", "click", "minimal"]
CoverImageSource = Literal["frame", "upload"]
CoverAspectRatio = Literal["16:9", "9:16", "1:1", "4:3", "21:9"]
CoverTextAlign = Literal["left", "center", "right"]
CoverDecorationType = Literal["rect", "line", "badge"]


# ---------------------------------------------------------------------------
# CoverConfig sub-shapes (v1 schema)
# ---------------------------------------------------------------------------


class CoverTextLayer(BaseModel):
    """One styled text layer inside the cover. ``key`` is template-defined
    and stable across template switches so user-typed text can carry over."""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(..., min_length=1, max_length=64)
    text: str = Field("", max_length=2000)
    fontFamily: str = Field(
        "system-ui, -apple-system, \"Segoe UI\", Roboto, "
        "\"PingFang SC\", \"Microsoft YaHei\", sans-serif",
        max_length=400,
    )
    fontSize: int = Field(72, ge=8, le=400)
    color: str = Field("#ffffff", max_length=32)
    fontWeight: int = Field(700, ge=100, le=900)
    italic: bool = False
    underline: bool = False
    align: CoverTextAlign = "center"
    x: float = Field(0.0, ge=-0.5, le=1.5)
    y: float = Field(0.0, ge=-0.5, le=1.5)
    width: float = Field(1.0, ge=0.0, le=2.0)


class CoverDecoration(BaseModel):
    """SVG/CSS-style normalized decoration."""

    model_config = ConfigDict(extra="forbid")

    type: CoverDecorationType
    x: float = Field(..., ge=-0.5, le=1.5)
    y: float = Field(..., ge=-0.5, le=1.5)
    w: Optional[float] = Field(None, ge=0.0, le=2.0)
    h: Optional[float] = Field(None, ge=0.0, le=2.0)
    fill: Optional[str] = Field(None, max_length=32)
    stroke: Optional[str] = Field(None, max_length=32)
    stroke_width: Optional[float] = Field(None, ge=0.0, le=50.0)
    text: Optional[str] = Field(None, max_length=200)


class CoverConfig(BaseModel):
    """Full authoring config (v1).

    ``version`` is set by the frontend; backend tolerates unknown future
    versions by returning the row as-is (forward compatibility), but unknown
    *fields* on the v1 root are rejected with 422.
    """

    model_config = ConfigDict(extra="forbid")

    version: int = Field(1, ge=1)
    textLayers: List[CoverTextLayer] = Field(default_factory=list)
    decorations: List[CoverDecoration] = Field(default_factory=list)
    cover_render_metadata: Optional[Dict[str, Any]] = Field(
        None,
        description="Forward-compat hook for future 'burn cover as first frame' work; unused in v1",
    )


# ---------------------------------------------------------------------------
# Request / response envelopes
# ---------------------------------------------------------------------------


class CoverStateIn(BaseModel):
    """Payload for ``PUT /api/video-cover/{project_id}``.

    Either ``frame_virtual_time_ms`` (for ``image_source='frame'``) or
    ``uploaded_image_url`` (for ``image_source='upload'``) is expected;
    the service layer enforces the cross-field invariant.
    """

    model_config = ConfigDict(extra="forbid")

    template_id: CoverTemplateId
    cover_config: CoverConfig
    image_source: CoverImageSource
    frame_virtual_time_ms: Optional[int] = Field(None, ge=0)
    uploaded_image_url: Optional[str] = Field(None, max_length=1000)
    aspect_ratio: CoverAspectRatio


class CoverStateOut(BaseModel):
    project_id: str
    template_id: CoverTemplateId
    cover_config: CoverConfig
    image_source: CoverImageSource
    frame_virtual_time_ms: Optional[int] = None
    uploaded_image_url: Optional[str] = None
    aspect_ratio: CoverAspectRatio
    created_at: str
    updated_at: str


class CoverStateResponse(BaseResponse):
    """``GET`` returns null payload when no cover exists yet — kept as
    Optional so callers do not have to special-case the missing-row case."""

    data: Optional[CoverStateOut] = None


class PngCacheData(BaseModel):
    url: str = Field(..., description="Cache-busted URL ('?v=<unix>')")
    updated_at: str


class PngCacheResponse(BaseResponse):
    data: PngCacheData
