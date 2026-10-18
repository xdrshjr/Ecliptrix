"""Agent 视觉审阅与成品自检的严格请求契约与安全错误（闭集）。

设计基线：docs/plans/agent-visual-review/spec.md §5.1 / §5.4。

与 `agent_toolkit_models.py` 同构：`STATUS` / `FAILURE_CLASS` 逐码登记，
未登记的码按 `invalid_argument`(400) 处理属于开放映射，因此本表**必须**覆盖
实现里出现的每一个 `error_code`（`test_agent_vision_router.py` 逐码断言）。
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ── 错误码闭集（§5.4） ─────────────────────────────────────────────────────
STATUS = {
    # 请求 / 参数
    "invalid_argument": 400,
    "invalid_call_id": 400,
    "origin_forbidden": 403,
    "json_required": 415,
    "request_too_large": 413,
    # 能力开关
    "vision_disabled": 403,
    "vision_quota_exceeded": 429,
    # 配置 / 模型
    "vision_unavailable": 503,
    "model_not_multimodal": 422,
    "model_failed": 502,
    "model_timeout": 504,
    # 来源
    "source_not_found": 404,
    "source_unsupported": 415,
    "observation_not_found": 404,
    "composition_not_found": 404,
    # 图像
    "image_too_large": 413,
    "image_invalid": 415,
    "image_encode_failed": 422,
    # 环境
    "ffmpeg_unavailable": 503,
    "inspect_unavailable": 503,
    "storage_unavailable": 507,
}

# 失败分组：重试语义与 UI 分流的唯一依据（不看状态码，避免 429/507 误判）。
FAILURE_CLASS = {
    "user_input": frozenset({
        "invalid_argument", "invalid_call_id", "origin_forbidden",
        "json_required", "request_too_large", "source_not_found",
        "source_unsupported", "observation_not_found", "composition_not_found",
        "image_too_large", "image_invalid", "image_encode_failed",
    }),
    "policy": frozenset({"vision_quota_exceeded"}),
    "configuration": frozenset({
        "vision_disabled", "vision_unavailable", "model_not_multimodal",
        "ffmpeg_unavailable", "inspect_unavailable",
    }),
    "transient": frozenset({"model_failed", "model_timeout", "storage_unavailable"}),
}
FAILURE_CLASS_BY_CODE = {
    code: name for name, codes in FAILURE_CLASS.items() for code in codes
}


def failure_class_for(code):
    """逐码分组；未登记码落在 user_input（不重试）。"""
    return FAILURE_CLASS_BY_CODE.get(code, "user_input")


class AgentVisionError(Exception):
    """本域唯一异常类型；`error_details` 里带 failure_class/retryable。"""

    def __init__(self, error_code, message=None, status_code=None,
                 failure_class=None):
        self.error_code = error_code
        self.message = message or error_code
        self.status_code = status_code or STATUS.get(error_code, 400)
        self.failure_class = (failure_class
                              or failure_class_for(error_code))
        # 逐码可能携带的可选上下文（`error_details` 只转发已赋值的项）。
        self.next_step = None
        self.reason = None
        self.settings_path = None
        super().__init__(self.message)


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── 图像来源（闭集，§4.4） ────────────────────────────────────────────────

VisionSourceKind = Literal[
    "material", "cover", "workspace", "artifact", "frame", "export"]


class ImageRef(StrictRequest):
    source: VisionSourceKind
    material_id: str | None = Field(default=None, max_length=128)
    # 相对键：非空、≤256、不得含盘符或前导 `/`（服务端在读字节前校验）。
    storage_key: str | None = Field(default=None, max_length=256)
    asset_id: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, max_length=180)
    artifact_id: str | None = Field(default=None, max_length=64)
    composition_id: str | None = Field(default=None, max_length=128)
    at_seconds: float | None = Field(default=None, ge=0, le=86_400)


class DescribeRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    images: list[ImageRef] = Field(min_length=1, max_length=6)
    question: str = Field(default="", max_length=300)
    mode: Literal["look", "scan"] = "look"
    checklist: list[Literal[
        "watermark", "text_legible", "subject_match", "safe_area",
        "quality"]] = Field(default_factory=list, max_length=5)


# ── 抽帧（§4.8 / §5.1） ───────────────────────────────────────────────────


class FramesSource(StrictRequest):
    kind: Literal["material", "composition", "workspace"]
    id: str | None = Field(default=None, max_length=128)
    storage_key: str | None = Field(default=None, max_length=256)


class FramesRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    source: FramesSource
    start_seconds: float | None = Field(default=None, ge=0, le=86_400)
    end_seconds: float | None = Field(default=None, ge=0, le=86_400)
    count: int | None = Field(default=None, ge=1, le=6)
    question: str = Field(default="", max_length=300)
    mode: Literal["look", "scan"] = "look"


# ── 成品探测（§4.9 / §5.1） ───────────────────────────────────────────────


class ExpectedResolution(StrictRequest):
    width: int | None = Field(default=None, ge=16, le=8192)
    height: int | None = Field(default=None, ge=16, le=8192)


class ExportInspectRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    # 可省：显式入参 → 前端 lastCompositionId → 本项目最近一次 completed（§4.4）。
    composition_id: str | None = Field(default=None, max_length=128)
    timeline_duration: float | None = Field(default=None, ge=0, le=86_400)
    expected: ExpectedResolution | None = None
    check_audio: bool = True
    visual_spot_check: bool = True
    count: int | None = Field(default=None, ge=1, le=6)


class CacheClearRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
