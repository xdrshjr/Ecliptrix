"""本机能力 REST 端点（12 个）：`/api/agent-host/*`。

设计基线：docs/plans/agent-general-assistant/spec.md §6。

三处刻意照抄 `agent_toolkit_router` 的做法（它是同族里最新的一版）：

1. 闸门复用 `research_run_router.validate_ui_origin`——本域**没有** run token，
   因此绝不调用 `tool_action`（它第一步 `request_run()` 会 401）。
2. 错误信封严格用 `ErrorResponse`，`failure_class`/`retryable`/`reason`/
   `sticky`/`remediation` 全进 `error_details`。
3. 只读端点也校验 Origin，但不要求 JSON（GET 没有请求体）。
"""
import re
from uuid import uuid4

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from app.models.agent_host_models import (
    AgentHostError, EgressDiagnoseModel, EgressDownloadModel,
    EgressRequestModel,
    FsEditRequest, FsGlobRequest, FsGrepRequest, FsListRequest, FsReadRequest,
    FsWriteRequest, ShellRunRequest)
from app.models.base_models import BaseResponse, ErrorResponse
from app.services.agent_host import audit, capabilities, egress, fs_tools
from app.services.agent_host import shell_runner

router = APIRouter(prefix="/agent-host", tags=["Agent Host"])

SETTINGS_HINT = "在“设置 › 本机能力”里开启对应能力后重试"
SETTINGS_HINTS = {
    "shell_disabled": "在“设置 › 本机能力”打开“允许本机命令”",
    "shell_busy": "等当前命令结束后重试",
    "shell_spawn_failed": "允许 %APPDATA%\\Ecliptrix 下的 python.exe/ffmpeg.exe",
    "path_forbidden": "在“设置 › 本机能力”里补充允许访问的根目录",
    "egress_disabled": "在“设置 › 本机能力”打开“通用联网”",
    "downloads_disabled": "在“设置 › 网络与研究”打开允许下载",
    "proxy_config_invalid": "把代理改写成 http://host:port",
    "dns_answer_non_global": "把出口档位改成 balanced 或显式配置代理",
    "dns_no_answer": "检查 DNS，或改用代理出口",
    "port_not_allowed": "在 egress_allow_ports 里放行该端口",
    "workspace_quota_exceeded": "提高工作区配额或删除文件",
}
_MAX_CALL_ID = 128
_UNSAFE_CALL_ID = re.compile(r"[\\/\x00-\x1f]|\.\.")


# ── 闸门 ──────────────────────────────────────────────────────────────────

def validate_host_origin(request, *, write):
    """Origin 白名单与 `sec-fetch-site` 完全复用（同族里唯一正确的做法）。

    `validate_ui_origin(write=True)` 已同时要求 `Origin` 与 JSON 体，所以这里
    不需要再补第二份判定——重复的分支只会让人以为某条路径放宽了闸门。
    """
    from app.models.web_research_models import WebResearchError
    from app.routers.research_run_router import validate_ui_origin

    try:
        validate_ui_origin(request, write=write)
    except WebResearchError as error:
        raise AgentHostError(error.error_code, message=error.message,
                            status_code=error.status_code) from None


def host_guard(request, *, write):
    """写类端点：Origin + JSON；`x-tool-call-id` 可选（本域不做幂等缓存）。"""
    validate_host_origin(request, write=write)
    identifier = request.headers.get("x-tool-call-id", "")
    if identifier and (len(identifier) > _MAX_CALL_ID
                       or _UNSAFE_CALL_ID.search(identifier)):
        raise AgentHostError("invalid_argument",
                            message="x-tool-call-id is not a safe identifier")
    return identifier or None


# ── 错误信封 ──────────────────────────────────────────────────────────────

def error_details(error):
    details = {"failure_class": error.failure_class,
               "retryable": error.failure_class == "transient",
               "request_id": str(uuid4())}
    hint = SETTINGS_HINTS.get(error.error_code)
    if hint:
        details.update(settings_path="agent_host", settings_hint=hint)
    for attribute in ("next_step", "reason", "remediation"):
        value = getattr(error, attribute, None)
        if value is not None:
            details[attribute] = value
    details["sticky"] = error.failure_class not in {
        "configuration", "transient"}
    if error.details:
        details.update(error.details)
    return details


def error_response(error):
    headers = {}
    retry_after = getattr(error, "retry_after", None)
    if retry_after:
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(
        status_code=error.status_code,
        headers=headers or None,
        content=ErrorResponse(
            success=False, message=error.message,
            error_code=error.error_code,
            error_details=error_details(error)).model_dump(mode="json"))


def _ok(data, message="ok"):
    return BaseResponse(success=True, message=message, data=data)


# ── 能力 / 审计 ───────────────────────────────────────────────────────────

@router.get("/capabilities")
async def get_capabilities(request: Request):
    validate_host_origin(request, write=False)
    return _ok(capabilities.snapshot())


@router.get("/audit")
async def get_audit(request: Request, limit: int = Query(50, ge=1, le=200)):
    validate_host_origin(request, write=False)
    entries = audit.recent(limit)
    return _ok({"entries": entries, "truncated": len(entries) >= limit})


# ── 本机命令 ──────────────────────────────────────────────────────────────

@router.post("/shell/run")
async def run_shell(body: ShellRunRequest, request: Request):
    host_guard(request, write=True)
    result = await shell_runner.run_command(
        body.project_id, body.command, body.cwd, body.timeout_ms)
    return _ok(result)


# ── 文件 ──────────────────────────────────────────────────────────────────

@router.post("/fs/read")
async def read_file(body: FsReadRequest, request: Request):
    host_guard(request, write=True)
    return _ok(fs_tools.read_file(body.project_id, body.path, body.offset,
                                  body.max_bytes, body.scope))


@router.post("/fs/write")
async def write_file(body: FsWriteRequest, request: Request):
    host_guard(request, write=True)
    return _ok(await fs_tools.write_file(
        body.project_id, body.path, body.content, body.overwrite,
        body.scope, body.create_parents))


@router.post("/fs/edit")
async def edit_file(body: FsEditRequest, request: Request):
    host_guard(request, write=True)
    return _ok(await fs_tools.edit_file(
        body.project_id, body.path, body.old_string, body.new_string,
        body.replace_all, body.scope))


@router.post("/fs/list")
async def list_dir(body: FsListRequest, request: Request):
    host_guard(request, write=True)
    return _ok(fs_tools.list_dir(body.project_id, body.path, body.scope))


@router.post("/fs/glob")
async def glob_files(body: FsGlobRequest, request: Request):
    host_guard(request, write=True)
    return _ok(fs_tools.glob_files(
        body.project_id, body.pattern, body.cwd, body.scope))


@router.post("/fs/grep")
async def grep_files(body: FsGrepRequest, request: Request):
    host_guard(request, write=True)
    return _ok(fs_tools.grep_files(
        body.project_id, body.pattern, body.path, body.glob,
        body.ignore_case, body.scope))


# ── tier-2 出口（无 run） ─────────────────────────────────────────────────

@router.post("/egress/request")
async def egress_request(body: EgressRequestModel, request: Request):
    host_guard(request, write=True)
    return _ok(await egress.http_request(
        body.method, body.url, body.headers, body.max_bytes,
        body.timeout_ms, body.allow_robots, body.project_id))


@router.post("/egress/download")
async def egress_download(body: EgressDownloadModel, request: Request):
    host_guard(request, write=True)
    return _ok(await egress.download(
        body.url, body.kind, body.name, body.source_page_url,
        body.import_to_library, body.project_id))


@router.post("/egress/diagnose")
async def egress_diagnose(body: EgressDiagnoseModel, request: Request):
    host_guard(request, write=True)
    return _ok(await egress.diagnose(
        body.url, body.resolve, body.check_robots, body.project_id))
