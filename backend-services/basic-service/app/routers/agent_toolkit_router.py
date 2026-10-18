"""Agent 通用工具集 REST 端点（18 个）。

设计基线：docs/plans/agent-general-toolkit/spec.md §4.1。

三处刻意**不**照抄 `research_run_router`：
1. `validate_toolkit_origin` 在 multipart 端点不强制 `application/json`
   （照抄会让 `documents/upload` 永远 415，R-01）；
2. 错误信封严格用 `ErrorResponse`，`failure_class`/`retryable` 进 `error_details`
   （R-04）；
3. 本域**没有** run token，因此自己实现 `toolkit_tool_guard`，不调用
   `research_run_router.tool_action`（它的第一步 `request_run()` 会 401，R-05）。
"""
import hashlib
import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.models.agent_toolkit_models import (
    AgentToolkitError,
    AnalysisRunRequest,
    MemoryWriteRequest,
    WorkspaceImportRequest,
    WorkspaceWriteRequest,
)
from app.models.base_models import BaseResponse, ErrorResponse
from app.services.agent_toolkit import (
    analysis_sandbox,
    capabilities as capabilities_service,
    document_extract,
    memory_store,
    toolkit_calls,
    workspace_store,
)

router = APIRouter(prefix="/agent-toolkit", tags=["Agent Toolkit"])

SETTINGS_HINT = "在“设置 › Agent 能力”中开启对应能力后重试"
# 配置/策略类失败必须给出可点击的设置入口（同 web_research 的 SETTINGS_HINTS）。
SETTINGS_HINTS = {
    "toolkit_disabled": SETTINGS_HINT,
    "workspace_disabled": "在“设置 › Agent 能力”开启工作区",
    "documents_disabled": "在“设置 › Agent 能力”开启文档",
    "analysis_disabled": "在“设置 › Agent 能力”开启计算分析",
    "memory_disabled": "在“设置 › Agent 能力”开启长期记忆",
    "documents_unavailable": "文档解析依赖未安装，请重新安装应用",
    "workspace_quota_exceeded": "在“设置 › Agent 能力”提高工作区配额或删除文件",
    "storage_unavailable": "工作区目录不可写，请检查磁盘空间与权限",
}
_MAX_CALL_ID = 128
# 工具 id 由模型服务商生成，形态不受我们控制；只做**危险字符**黑名单，逐字符
# 拒绝路径分隔符、盘符、控制字符与 `..`——它同时被当作幂等键与产物目录名使用。
_UNSAFE_CALL_ID = re.compile(r"[\\/\x00-\x1f]|\.\.")


# ── 闸门 ──────────────────────────────────────────────────────────────────


def validate_toolkit_origin(request, *, write, require_json=True):
    """Origin 白名单 / `sec-fetch-site` 完全复用，仅按需跳过 JSON 断言。"""
    from app.models.web_research_models import WebResearchError
    from app.routers.research_run_router import validate_ui_origin

    try:
        if require_json:
            validate_ui_origin(request, write=write)
        else:
            # write=False 只做 Origin 白名单 + cross-site 判定，不要求 JSON。
            validate_ui_origin(request, write=False)
            if write and not request.headers.get("origin"):
                raise WebResearchError("origin_forbidden", status_code=403)
    except WebResearchError as error:
        raise AgentToolkitError(
            error.error_code, message=error.message,
            status_code=error.status_code) from None


def require_capability(name):
    settings = _settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings[f"{name}_enabled"]:
        raise AgentToolkitError(f"{name}_disabled")


def _settings():
    from app.services.system_settings_service import toolkit_settings

    return toolkit_settings()


def _call_id(request, required):
    identifier = request.headers.get("x-tool-call-id", "")
    if not identifier:
        if required:
            raise AgentToolkitError("invalid_call_id",
                                    message="x-tool-call-id header is required")
        return None
    if len(identifier) > _MAX_CALL_ID:
        raise AgentToolkitError("invalid_call_id",
                                message="x-tool-call-id must be at most 128 chars")
    if _UNSAFE_CALL_ID.search(identifier):
        raise AgentToolkitError(
            "invalid_call_id",
            message="x-tool-call-id must not contain path separators")
    return identifier


def toolkit_tool_guard(request, action, capability):
    """写类工具闸门：Origin → JSON → 能力开关 → `x-tool-call-id`。"""
    validate_toolkit_origin(request, write=True, require_json=True)
    require_capability(capability)
    return _call_id(request, required=True)


def read_guard(request, capability):
    """只读端点：Origin → 能力开关 → `x-tool-call-id`（必带）。"""
    validate_toolkit_origin(request, write=False)
    require_capability(capability)
    return _call_id(request, required=True)


# ── 错误信封 ──────────────────────────────────────────────────────────────


def error_details(error):
    details = {
        "failure_class": error.failure_class,
        "retryable": error.failure_class == "transient",
        "request_id": str(uuid4()),
    }
    hint = SETTINGS_HINTS.get(error.error_code)
    if hint:
        details.update(settings_path="agent_toolkit", settings_hint=hint)
    for attribute in ("next_step", "supported", "reason", "pages", "limit",
                      "partial"):
        value = getattr(error, attribute, None)
        if value is not None:
            details[attribute] = value
    return details


def error_response(error):
    return JSONResponse(
        status_code=error.status_code,
        content=ErrorResponse(
            success=False, message=error.message,
            error_code=error.error_code,
            error_details=error_details(error),
        ).model_dump(mode="json"),
    )


def _ok(data, message="ok"):
    return BaseResponse(success=True, message=message, data=data)


def _web_error_to_toolkit(error):
    """素材提交路径抛 WebResearchError；码已在本域闭集内，转换后统一信封。"""
    return AgentToolkitError(str(error.error_code), message=error.message,
                             status_code=error.status_code)


# ── 能力 / 用量 ───────────────────────────────────────────────────────────


@router.get("/capabilities")
async def get_capabilities(request: Request, project_id: str | None = None):
    validate_toolkit_origin(request, write=False)
    data = await capabilities_service.capabilities(project_id)
    return _ok(data)


@router.get("/usage")
async def get_usage(request: Request, project_id: str | None = None):
    # §4.1.1 把 `/capabilities` 与 `/usage` 的能力开关列写作「—」：面板必须在
    # `workspace_enabled=false` 时仍能读到用量，否则连「已关闭」都显示不出来。
    validate_toolkit_origin(request, write=False)
    data = await capabilities_service.usage(project_id)
    return _ok(data)


# ── 工作区 ────────────────────────────────────────────────────────────────


@router.post("/workspace/write")
async def write_workspace(body: WorkspaceWriteRequest, request: Request):
    call_id = toolkit_tool_guard(request, "workspace_write", "workspace")
    payload = _decode_body(body)

    async def run():
        return await workspace_store.write_file(
            body.project_id, body.name, payload, body.overwrite)

    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "workspace_write", run))


def _decode_body(body):
    if body.encoding == "base64":
        import base64
        import binascii

        try:
            return base64.b64decode(body.content.encode("ascii"), validate=True)
        except (binascii.Error, ValueError):
            raise AgentToolkitError("invalid_argument",
                                    message="content is not valid base64") from None
    return body.content.encode("utf-8")


@router.get("/workspace/list")
async def list_workspace(request: Request, project_id: str | None = None,
                         prefix: str | None = None,
                         limit: int = Query(50, ge=1, le=100)):
    read_guard(request, "workspace")
    listing = workspace_store.list_files(project_id, prefix, limit)
    # 文档能力关闭时文档数组降级为空，工作区列表照常可用（AC-20）。
    listing["documents"] = await _documents_for_listing(project_id, limit)
    return _ok(listing)


async def _documents_for_listing(project_id, limit):
    try:
        documents = await document_extract.list_documents(project_id, limit)
    except AgentToolkitError as error:
        if error.error_code in {"documents_disabled", "toolkit_disabled",
                                "documents_unavailable"}:
            return []
        raise
    return [
        {
            "document_id": item["id"],
            "name": item["name"],
            "pages": item["pages"],
            "chars": item["chars"],
            "created_at": item["created_at"],
        }
        for item in documents["documents"]
    ]


@router.get("/workspace/read")
async def read_workspace(request: Request, name: str,
                         project_id: str | None = None,
                         offset: int = Query(0, ge=0),
                         max_bytes: int = Query(4000, ge=1, le=8000)):
    read_guard(request, "workspace")
    return _ok(workspace_store.read_page(project_id, name, offset, max_bytes))


@router.delete("/workspace/file")
async def delete_workspace(request: Request, name: str,
                           project_id: str | None = None):
    validate_toolkit_origin(request, write=True, require_json=False)
    require_capability("workspace")
    call_id = _call_id(request, required=False)
    if call_id is None:
        return _ok(workspace_store.delete_file(project_id, name))
    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "workspace_delete",
        lambda: _async_value(workspace_store.delete_file(project_id, name))))


async def _async_value(value):
    return value


@router.get("/workspace/download")
async def download_workspace(request: Request, name: str,
                             project_id: str | None = None):
    """设置面板的用户动作：不需要 `x-tool-call-id`（§4.1.1）。"""
    validate_toolkit_origin(request, write=False)
    require_capability("workspace")
    path, relative = workspace_store.resolve_file(project_id, name)
    return FileResponse(
        path, filename=relative.rsplit("/", 1)[-1],
        headers={"Cache-Control": "no-store",
                 "X-Content-Type-Options": "nosniff"})


@router.post("/workspace/import")
async def import_workspace(body: WorkspaceImportRequest, request: Request):
    call_id = toolkit_tool_guard(request, "workspace_import", "workspace")

    async def run():
        return await _import_material(body)

    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "workspace_import", run))


_MATERIAL_KIND = {
    "mp4": "video", "mov": "video", "webm": "video", "mkv": "video",
    "mp3": "audio", "wav": "audio", "m4a": "audio", "aac": "audio",
    "png": "image", "jpg": "image", "jpeg": "image", "webp": "image",
    "gif": "image", "svg": "image",
}


async def _import_material(body):
    from app.models.web_research_models import WebResearchError
    from app.services.material_download_service import (
        get_material_download_service,
    )

    path, relative = workspace_store.resolve_file(body.project_id, body.name)
    dotted = workspace_store._extension_of(relative)
    extension = dotted.lstrip(".")
    if dotted not in workspace_store.MEDIA_EXTENSIONS:
        error = AgentToolkitError(
            "invalid_argument",
            message=f"unsupported media extension: {extension or '(none)'}")
        error.supported = sorted(
            item.lstrip(".") for item in workspace_store.MEDIA_EXTENSIONS)
        raise error
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    try:
        committed = (await get_material_download_service()
                     .store_workspace_file_async(path, digest, extension))
    except WebResearchError as error:
        raise _web_error_to_toolkit(error) from None
    material = _material_payload(
        committed, relative, extension, body.material_name, path)
    return material


def _material_payload(committed, relative, extension, material_name, path=None):
    from datetime import datetime, timezone

    kind = _MATERIAL_KIND.get(extension, "image")
    name = material_name or Path(relative).name
    width, height = _dimensions(path, extension)
    return {
        "id": committed["record_id"],
        "name": name,
        "type": kind,
        "format": extension,
        "size": committed["size"],
        "width": width,
        "height": height,
        "duration": 0,
        "local_url": committed["local_url"],
        "url": committed["local_url"],
        "cacheUrl": committed["local_url"],
        "created_at": committed.get(
            "created_at", datetime.now(timezone.utc).isoformat()),
        "metadata": {"source": "workspace", "reused": committed.get("reused")},
    }


_SVG_SIZE = re.compile(
    rb"<svg[^>]*?\bwidth\s*=\s*[\"'](\d+)(?:px)?[\"']", re.IGNORECASE)
_SVG_HEIGHT = re.compile(
    rb"<svg[^>]*?\bheight\s*=\s*[\"'](\d+)(?:px)?[\"']", re.IGNORECASE)


def _dimensions(path, extension):
    """SVG 没有 EXIF/ffprobe 元数据：读根元素 width/height，缺失回退 1920×1080。

    刻意不依赖 PIL（spec §3.3.3：SVG 断言不得依赖 PIL）。
    """
    if extension != "svg" or path is None:
        return 0, 0
    try:
        head = Path(path).read_bytes()[:2048]
    except OSError:
        return 1920, 1080
    width = _SVG_SIZE.search(head)
    height = _SVG_HEIGHT.search(head)
    return (int(width.group(1)) if width else 1920,
            int(height.group(1)) if height else 1080)


# ── 文档 ──────────────────────────────────────────────────────────────────


@router.post("/documents/upload")
async def upload_document(request: Request,
                          file: UploadFile,
                          project_id: str | None = Form(default=None)):
    """multipart：只做 Origin 校验，**不**要求 JSON（R-01）。"""
    validate_toolkit_origin(request, write=True, require_json=False)
    require_capability("documents")
    data = await file.read()
    return _ok(await document_extract.ingest(
        file.filename, data, project_id))


@router.get("/documents")
async def list_documents(request: Request, project_id: str | None = None,
                         limit: int = Query(50, ge=1, le=100)):
    read_guard(request, "documents")
    return _ok(await document_extract.list_documents(project_id, limit))


@router.get("/documents/read")
async def read_document(request: Request,
                        document_id: str | None = None,
                        name: str | None = None,
                        project_id: str | None = None,
                        page: int = Query(1, ge=1),
                        offset: int = Query(0, ge=0),
                        max_chars: int = Query(4000, ge=1, le=8000)):
    read_guard(request, "documents")
    return _ok(await document_extract.read_document(
        project_id, document_id, name, page, offset, max_chars))


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str, request: Request,
                          project_id: str | None = None):
    validate_toolkit_origin(request, write=True, require_json=False)
    require_capability("documents")
    call_id = _call_id(request, required=False)
    if call_id is None:
        return _ok(await document_extract.delete_document(
            project_id, document_id))
    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "documents_delete",
        lambda: document_extract.delete_document(project_id, document_id)))


# ── 计算分析 ──────────────────────────────────────────────────────────────


@router.post("/analysis/run")
async def run_analysis(body: AnalysisRunRequest, request: Request):
    call_id = toolkit_tool_guard(request, "analysis_run", "analysis")

    async def run():
        return await analysis_sandbox.run(
            body.code, body.project_id, call_id)

    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "analysis_run", run))


# ── 长期记忆 ──────────────────────────────────────────────────────────────


@router.get("/memory")
async def list_memory(request: Request, project_id: str | None = None,
                      scope: str = Query("all"),
                      limit: int = Query(50, ge=1, le=100)):
    read_guard(request, "memory")
    return _ok(await memory_store.list_entries(project_id, scope, limit))


@router.get("/memory/search")
async def search_memory(request: Request, q: str,
                        project_id: str | None = None,
                        scope: str = Query("all"),
                        limit: int = Query(5, ge=1, le=5)):
    read_guard(request, "memory")
    return _ok(await memory_store.search(project_id, q, limit, scope))


@router.get("/memory/digest")
async def memory_digest(request: Request, project_id: str | None = None):
    # §4.1.1：`GET /memory*` 同属「Origin + 子开关 + `x-tool-call-id`」一格。
    read_guard(request, "memory")
    return _ok(await memory_store.digest(project_id))


@router.post("/memory")
async def write_memory(body: MemoryWriteRequest, request: Request):
    call_id = toolkit_tool_guard(request, "memory_write", "memory")

    async def run():
        return await memory_store.write(
            body.project_id, body.text, body.kind, body.tags, body.scope,
            body.expires_in_days)

    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "memory_write", run))


@router.delete("/memory/{memory_id}")
async def forget_memory(memory_id: str, request: Request,
                        project_id: str | None = None):
    validate_toolkit_origin(request, write=True, require_json=False)
    require_capability("memory")
    call_id = _call_id(request, required=False)
    if call_id is None:
        return _ok(await memory_store.forget(memory_id))
    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "memory_forget", lambda: memory_store.forget(memory_id)))


@router.delete("/memory")
async def clear_memory(request: Request, project_id: str | None = None):
    """设置面板的「清空本项目记忆」；不经模型，因此不要 call id。"""
    validate_toolkit_origin(request, write=True, require_json=False)
    require_capability("memory")
    return _ok(await memory_store.clear_project(project_id))
