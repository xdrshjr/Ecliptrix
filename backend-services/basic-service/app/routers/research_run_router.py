"""内部 run 控制与项目资料读取；不向 renderer 暴露注册能力。"""
import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse, StreamingResponse

from app.models import BaseResponse, ErrorResponse
from app.models.web_research_models import RunRequest, WebResearchError
from app.services.system_settings_service import research_settings
from app.services.web_research.run_registry import run_registry
from app.services.web_research.artifact_store import get_artifact_store

router = APIRouter(prefix="/web-research", tags=["Research Lifecycle"])


# 配置类失败必须给出可点击的设置入口（spec §12.3 D-10 / AC-04）。
SETTINGS_HINTS = {
    "provider_not_configured": "在“设置 › 网络与研究”填写搜索密钥后重试",
    "provider_rejected": "在“设置 › 网络与研究”更新搜索密钥",
    "provider_quota_exceeded": "在“设置 › 网络与研究”更换或补充搜索密钥",
    "configuration_invalid": "在“设置 › 网络与研究”检查研究模型配置",
    "research_model_rejected": "在“设置 › 网络与研究 › 研究模型”更新凭证",
    "research_model_unavailable": "在“设置 › 网络与研究 › 研究模型”选择可用模型",
    "research_model_timeout": "在“设置 › 网络与研究 › 研究模型”更换响应更快的模型",
    "research_disabled": "在“设置 › 网络与研究”开启网络研究",
    "network_disabled": "在“设置 › 网络与研究”开启网络研究",
    "browser_disabled": "在“设置 › 网络与研究”开启动态网页",
    "downloads_disabled": "在“设置 › 网络与研究”开启本地下载",
    "browser_unavailable": "在“设置 › 网络与研究”查看动态网页可用性",
}


def error_details(error):
    details = {"failure_class": error.failure_class,
               "retryable": error.failure_class == "transient",
               "request_id": str(uuid4())}
    hint = SETTINGS_HINTS.get(error.error_code)
    if hint:
        details.update(settings_path="web_research", settings_hint=hint)
    return details


def error_response(error):
    return JSONResponse(status_code=error.status_code, content=ErrorResponse(
        success=False, message=error.message, error_code=error.error_code,
        error_details=error_details(error)).model_dump(mode="json"))


def validate_ui_origin(request, write=False):
    configured = os.getenv("RESEARCH_RENDERER_ORIGIN", "")
    allowed = {configured} if configured else {
        "http://localhost:3000", "http://127.0.0.1:3000"}
    origin = request.headers.get("origin")
    if (origin and origin not in allowed) or (write and not origin):
        raise WebResearchError("origin_forbidden", status_code=403)
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise WebResearchError("origin_forbidden", status_code=403)
    if write and request.headers.get("content-type", "").split(";")[0].lower() != "application/json":
        raise WebResearchError("json_required", status_code=415)


async def request_run(request, allow_closed=False):
    return await run_registry.authenticate(
        request.headers.get("x-research-run", ""),
        request.headers.get("x-research-token", ""), allow_closed)


async def tool_action(request, action, params, function, timeout):
    run = await request_run(request)
    settings = research_settings()
    if not settings["enabled"]:
        raise WebResearchError("research_disabled", status_code=403)
    if action.startswith("browser") and not settings["browser_enabled"]:
        raise WebResearchError("browser_disabled", status_code=403)
    if action == "download" and not settings["downloads_enabled"]:
        raise WebResearchError("downloads_disabled", status_code=403)
    identifier = request.headers.get("x-tool-call-id", "")
    if not identifier or len(identifier) > 128:
        raise WebResearchError("invalid_call_id")
    result = await run_registry.execute(
        run, identifier, action, params,
        lambda: function(run), timeout)
    return BaseResponse(success=True, message="ok", data=result)


def expires_at(run):
    remaining = max(0, min(run.deadline, run.lease_expiry) - time.monotonic())
    return (datetime.now(timezone.utc) + timedelta(seconds=remaining)).isoformat()


@router.post("/runs")
async def register_run(body: RunRequest):
    config = research_settings()
    if not config["enabled"]:
        raise WebResearchError("research_disabled", status_code=403)
    run, token = await run_registry.register(
        str(body.project_id) if body.project_id else None,
        body.remaining_ms, config)
    return BaseResponse(success=True, message="ok", data={
        "run_id": run.run_id, "run_token": token, "expires_at": expires_at(run)})


@router.put("/runs/{identifier}/lease")
async def lease(identifier: UUID, request: Request):
    run = await request_run(request)
    if str(identifier) != run.run_id:
        raise WebResearchError("run_closed")
    await run_registry.heartbeat(run)
    return BaseResponse(success=True, message="ok", data={"expires_at": expires_at(run)})


@router.delete("/runs/{identifier}")
async def cancel_run(identifier: UUID, request: Request):
    run = await request_run(request, allow_closed=True)
    if str(identifier) != run.run_id:
        raise WebResearchError("run_closed")
    await run_registry.cancel(run.run_id)
    return BaseResponse(success=True, message="ok", data={"state": "closed"})


@router.delete("/runs/{identifier}/calls/{call_id}")
async def cancel_call(identifier: UUID, call_id: str, request: Request):
    run = await request_run(request, allow_closed=True)
    if str(identifier) != run.run_id or not 0 < len(call_id) <= 128:
        raise WebResearchError("run_closed")
    state = await run_registry.cancel_call(run, call_id)
    return BaseResponse(success=True, message="ok", data={"state": state})


async def artifact_project(request, project_id):
    if request.headers.get("x-research-run"):
        return (await request_run(request)).project_id
    validate_ui_origin(request)
    if project_id:
        try:
            return str(UUID(project_id))
        except ValueError:
            raise WebResearchError("invalid_project_id") from None
    return None


@router.get("/artifacts/{identifier}")
async def read_artifact(identifier: UUID, request: Request,
                        project_id: str | None = None,
                        offset: int = Query(0, ge=0),
                        max_bytes: int = Query(4000, ge=1, le=8000)):
    project = await artifact_project(request, project_id)
    result = await get_artifact_store().read(str(identifier), project, offset, max_bytes)
    return BaseResponse(success=True, message="ok", data=result)


@router.get("/artifacts/{identifier}/image")
async def image_artifact(identifier: UUID, request: Request,
                         project_id: str | None = None):
    project = await artifact_project(request, project_id)
    context = get_artifact_store().pinned(str(identifier), project)
    row, body = await context.__aenter__()
    if row.kind != "screenshot":
        await context.__aexit__(None, None, None)
        raise WebResearchError("unsupported_content_type")
    async def stream():
        try:
            yield body
        finally:
            await context.__aexit__(None, None, None)
    return StreamingResponse(stream(), media_type="image/png", headers={
        "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin"})
