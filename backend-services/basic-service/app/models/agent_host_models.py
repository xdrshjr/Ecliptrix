"""本机能力域的请求契约与错误码闭集（shell / fs / tier-2 egress）。

设计基线：docs/plans/agent-general-assistant/spec.md §6 / §7.3。

与 `web_research_models.py` / `agent_toolkit_models.py` 同构：`STATUS` 逐码登记，
HTTP 状态由表决定，服务层不内联状态码。**不重复登记既有码**——`binary_file`、
`workspace_file_too_large`、`robots_*`、`dns_*` 等跨域码直接沿用来源表的值，
只在本域补 `failure_class`。
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import agent_toolkit_models as toolkit_models
from app.models import web_research_models as research_models

# ── 本域新增的 10 个码（§7.3） ──────────────────────────────────────────────
LOCAL_STATUS = {
    "shell_disabled": 403,
    "shell_busy": 429,
    "shell_spawn_failed": 502,
    "path_forbidden": 403,
    "edit_not_unique": 409,
    "host_file_too_large": 413,
    "egress_disabled": 403,
    "egress_budget_exceeded": 429,
    "egress_rate_limited": 429,
    "http_write_unsupported": 400,
    # 本域出现的形态错误：与 toolkit/web_research 同名同义，不另立近义码。
    "invalid_argument": 400,
    "not_found": 404,
    "material_not_ready": 422,
    # 生成域也复用本码（`image_to_video` 的 size=0 分支，REV-P1-10）。
    "material_not_materialized": 422,
    "fs_disabled": 403,
}

# 既有码直接沿用来源表（跨域引用写清出处，不复制状态码数字）。
STATUS = {
    **research_models.STATUS,
    **toolkit_models.STATUS,
    **LOCAL_STATUS,
}
# `unsupported_media_type` 在本域取 415「不可接受的媒体类型」语义（§7.3）。
STATUS["unsupported_media_type"] = 415

LOCAL_FAILURE_CLASS = {
    "user_input": frozenset({
        "invalid_argument", "http_write_unsupported", "not_found",
        "material_not_ready", "binary_file", "host_file_too_large",
        "unsupported_media_type",
    }),
    "policy": frozenset({
        "path_forbidden", "edit_not_unique", "workspace_quota_exceeded",
        "workspace_file_too_large", "material_not_materialized",
        "url_forbidden", "robots_disallowed", "robots_unavailable",
        "dns_no_answer", "dns_answer_non_global", "port_not_allowed",
        "host_denied", "host_literal_non_global",
    }),
    "configuration": frozenset({
        "shell_disabled", "egress_disabled", "proxy_config_invalid",
        "downloads_disabled", "network_disabled", "research_disabled",
    }),
    "transient": frozenset({
        "shell_busy", "shell_spawn_failed", "egress_budget_exceeded",
        "egress_rate_limited", "upstream_timeout", "upstream_error",
        "download_failed", "storage_unavailable",
    }),
    "internal": frozenset({"cache_commit_failed", "cache_integrity_error",
                           "internal_error"}),
}
FAILURE_CLASS_BY_CODE = {
    code: name for name, codes in LOCAL_FAILURE_CLASS.items() for code in codes
}


def failure_class_for(code):
    """逐码分组；未知异常不能冒充策略拒绝而绕过异常熔断。"""
    return FAILURE_CLASS_BY_CODE.get(code, "internal")


class AgentHostError(Exception):
    """本域唯一异常类型；`next_step`/`reason`/`remediation` 进 error_details。"""

    def __init__(self, error_code, message=None, status_code=None,
                 failure_class=None, next_step=None, reason=None,
                 remediation=None, details=None):
        self.error_code = error_code
        self.message = message or error_code
        self.status_code = status_code or STATUS.get(error_code, 400)
        self.failure_class = failure_class or failure_class_for(error_code)
        self.next_step = next_step
        self.reason = reason
        self.remediation = remediation
        self.details = details or {}
        super().__init__(self.message)


# ── 请求模型（约束与前端工具 schema 一一对应，避免"前端允许后端拒绝"） ──────

class StrictRequest(BaseModel):
    """拒绝未知字段：多一个字段就是协议漂移，不当静默兼容。"""

    model_config = ConfigDict(extra="forbid")


class ShellRunRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    command: str = Field(min_length=1, max_length=8000)
    cwd: str | None = Field(default=None, max_length=1024)
    timeout_ms: int | None = Field(default=None, ge=1000, le=600000)


class FsReadRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    path: str = Field(min_length=1, max_length=1024)
    offset: int = Field(default=0, ge=0)
    max_bytes: int | None = Field(default=None, ge=1024, le=1048576)
    scope: Literal["workspace", "host"] | None = None


class FsWriteRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    path: str = Field(min_length=1, max_length=1024)
    content: str = Field(max_length=2 * 1024 * 1024)
    overwrite: bool = False
    scope: Literal["workspace", "host"] | None = None
    create_parents: bool = True


class FsEditRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    path: str = Field(min_length=1, max_length=1024)
    old_string: str = Field(min_length=1, max_length=65536)
    new_string: str = Field(default="", max_length=2 * 1024 * 1024)
    replace_all: bool = False
    scope: Literal["workspace", "host"] | None = None


class FsListRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    path: str = Field(default="", max_length=1024)
    scope: Literal["workspace", "host"] | None = None


class FsGlobRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    pattern: str = Field(min_length=1, max_length=512)
    cwd: str | None = Field(default=None, max_length=1024)
    scope: Literal["workspace", "host"] | None = None


class FsGrepRequest(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    pattern: str = Field(min_length=1, max_length=512)
    path: str | None = Field(default=None, max_length=1024)
    glob: str | None = Field(default=None, max_length=256)
    ignore_case: bool = False
    scope: Literal["workspace", "host"] | None = None


class EgressRequestModel(StrictRequest):
    # `project_id` 只用于审计归属（§4.4 的审计行带 project_id）。spec §6 的
    # /egress/* 请求体表漏了它，但前端三个出口工具与 /fs/* 一样统一下发，
    # `extra="forbid"` 会把它变成 422 → 整条 tier-2 出口不可用。
    project_id: str | None = Field(default=None, max_length=64)
    method: Literal["GET", "HEAD"] = "GET"
    url: str = Field(min_length=1, max_length=4096)
    headers: dict[str, str] | None = None
    max_bytes: int | None = Field(default=None, ge=1024, le=67108864)
    timeout_ms: int | None = Field(default=None, ge=1000, le=120000)
    allow_robots: bool = True


class EgressDownloadModel(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    url: str = Field(min_length=1, max_length=4096)
    name: str | None = Field(default=None, max_length=120)
    kind: Literal["image", "media"]
    source_page_url: str | None = Field(default=None, max_length=4096)
    import_to_library: bool = True


class EgressDiagnoseModel(StrictRequest):
    project_id: str | None = Field(default=None, max_length=64)
    url: str = Field(min_length=1, max_length=4096)
    resolve: bool = False
    check_robots: bool = False
