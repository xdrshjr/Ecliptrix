"""Agent 通用工具集的严格请求契约与安全错误（闭集）。

设计基线：docs/plans/agent-general-toolkit/spec.md §3.8 / §4.1。
与 `web_research_models.py:8-109` 同构：`STATUS` / `FAILURE_CLASS` 逐码登记，
未登记的码一律按 `invalid_argument`(400) 处理属于开放映射，因此本表**必须**
覆盖实现里出现的每一个 `error_code`（AC-35 / AC-19 逐码断言）。
"""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ── 错误码闭集 ──────────────────────────────────────────────────────────────
# 逐码登记：HTTP 状态由本表决定，服务层不允许内联状态码。
STATUS = {
    # 请求 / 参数
    "invalid_argument": 400,
    "invalid_workspace_name": 400,
    "invalid_offset": 400,          # 复用既有码（同 artifact_store.byte_page）
    "invalid_page_size": 400,       # 复用既有码
    "page_out_of_range": 400,
    "analysis_rejected": 400,
    "invalid_call_id": 400,
    "unknown_toolkit_setting": 400,  # 同 unknown_research_setting 形状
    "setting_out_of_range": 400,     # 复用既有码
    "origin_forbidden": 403,         # 复用既有码
    "json_required": 415,            # 复用既有码
    "request_too_large": 413,        # 复用既有码
    # 能力开关
    "toolkit_disabled": 403,
    "workspace_disabled": 403,
    "documents_disabled": 403,
    "analysis_disabled": 403,
    "memory_disabled": 403,
    # 策略
    "policy_blocked": 403,
    "memory_limit_reached": 409,
    "workspace_quota_exceeded": 507,
    # 未命中
    "workspace_not_found": 404,
    "memory_not_found": 404,
    "document_not_found": 404,
    "not_found": 404,                # BFF 路由未命中
    # 体积 / 格式
    "workspace_file_too_large": 413,
    "document_too_large": 413,
    "binary_file": 415,
    "document_unsupported_format": 415,
    "document_parse_failed": 422,
    # 可用性
    "storage_unavailable": 503,
    "documents_unavailable": 503,
    "upstream_timeout": 504,
    "analysis_timeout": 504,
    # 复用既有码（_commit_research 抛出，导入素材路径会遇到）
    "cache_commit_failed": 500,
    "cache_integrity_error": 500,
    "unsupported_media_type": 400,
}

# 失败分组：重试语义与 UI 分流的唯一依据。刻意不看状态码——`>=500 → transient`
# 的兜底会把 507 与存储提交失败误判为可重试（同 web_research D-15 教训）。
FAILURE_CLASS = {
    "user_input": frozenset({
        "invalid_argument", "invalid_workspace_name", "invalid_offset",
        "invalid_page_size", "page_out_of_range", "analysis_rejected",
        "invalid_call_id", "unknown_toolkit_setting", "setting_out_of_range",
        "origin_forbidden", "json_required", "request_too_large",
        "workspace_not_found", "memory_not_found", "document_not_found",
        "not_found", "workspace_file_too_large", "document_too_large",
        "binary_file", "document_unsupported_format", "document_parse_failed",
        "unsupported_media_type",
    }),
    "policy": frozenset({
        "policy_blocked", "memory_limit_reached", "workspace_quota_exceeded",
    }),
    "configuration": frozenset({
        "toolkit_disabled", "workspace_disabled", "documents_disabled",
        "analysis_disabled", "memory_disabled", "documents_unavailable",
    }),
    "transient": frozenset({
        "storage_unavailable", "upstream_timeout", "analysis_timeout",
    }),
    "internal": frozenset({"cache_commit_failed", "cache_integrity_error"}),
}
FAILURE_CLASS_BY_CODE = {
    code: name for name, codes in FAILURE_CLASS.items() for code in codes
}


def failure_class_for(code):
    """逐码分组；未登记码落在 user_input（不重试）。"""
    return FAILURE_CLASS_BY_CODE.get(code, "user_input")


class AgentToolkitError(Exception):
    """本域唯一异常类型；`error_details` 里带 failure_class/retryable。"""

    def __init__(self, error_code, message=None, status_code=None,
                 failure_class=None):
        self.error_code = error_code
        self.message = message or error_code
        self.status_code = status_code or STATUS.get(error_code, 400)
        self.failure_class = (failure_class
                              or failure_class_for(error_code))
        super().__init__(self.message)


# ── 项目 id ────────────────────────────────────────────────────────────────
# 目录名不含用户输入：先校验字符集，再哈希成目录名（§3.3.1）。
PROJECT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def normalize_project_id(value):
    """空/缺省 → None（落 global 桶）；非法字符集 → invalid_argument。"""
    if value is None:
        return None
    if not isinstance(value, str):
        raise AgentToolkitError("invalid_argument",
                                message="project_id must be a string")
    value = value.strip()
    if not value:
        return None
    if not PROJECT_ID_PATTERN.match(value):
        raise AgentToolkitError("invalid_argument",
                                message="project_id must match ^[A-Za-z0-9_-]{1,64}$")
    return value


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WorkspaceWriteRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=180)
    content: str = ""
    encoding: Literal["utf8", "base64"] = "utf8"
    overwrite: bool = False


class WorkspaceImportRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=180)
    material_name: str | None = Field(default=None, max_length=120)
    material_type: Literal["image", "video", "audio"] | None = None


class AnalysisRunRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    code: str = Field(min_length=1, max_length=6000)
    purpose: str | None = Field(default=None, max_length=160)


class MemoryWriteRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    text: str = Field(min_length=1, max_length=1000)
    kind: Literal["fact", "preference", "decision"] = "fact"
    tags: list[str] = Field(default_factory=list, max_length=6)
    scope: Literal["project", "global"] = "project"
    expires_in_days: int | None = Field(default=None, ge=1, le=365)
