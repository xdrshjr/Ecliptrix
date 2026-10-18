"""网络工具和专用凭证入口，所有执行绑定服务端运行令牌。"""
import asyncio
import json
import time
from fastapi import APIRouter, Request
from app.models import BaseResponse
from app.models.web_research_models import (
    WebSearchRequest, WebFetchRequest, WebExtractImagesRequest,
    WebDownloadRequest, WebResearchRequest, CredentialsRequest, WebResearchError)
from app.services.system_settings_service import system_settings_service
from app.services.web_research import (
    get_web_search_service, get_web_fetch_service,
    get_web_image_service, get_web_research_service)
from app.services.web_research.artifact_store import get_artifact_store
from app.services.web_research.provenance import resolve_candidate
from .research_run_router import tool_action, validate_ui_origin

router = APIRouter(prefix="/web-research", tags=["Web Research"])
_test_lock = asyncio.Lock()
_last_test = 0.0
CONNECTION_TIMEOUT = 10


async def store_result(run, kind, result, sources):
    row = await get_artifact_store().write(kind,
        json.dumps(result, ensure_ascii=False).encode(),
        {"run_id": run.run_id, "project_id": run.project_id, "sources": sources},
        run.config.get("artifact_retention_days", 7))
    result["artifact_id"] = row.id
    return result


@router.post("/search")
async def web_search(body: WebSearchRequest, request: Request):
    async def execute(run):
        result = await get_web_search_service().search(**body.model_dump(), run=run)
        payload = result.model_dump()
        return await store_result(run, "search", payload, payload["sources"])
    return await tool_action(request, "search", body.model_dump(), execute, 18)


@router.post("/fetch")
async def web_fetch(body: WebFetchRequest, request: Request):
    async def execute(run):
        result = await get_web_fetch_service().fetch(**body.model_dump(), run=run)
        return result.model_dump()
    return await tool_action(request, "fetch", body.model_dump(), execute, 20)


@router.post("/extract-images")
async def extract_images(body: WebExtractImagesRequest, request: Request):
    async def execute(run):
        images = await get_web_image_service().discover_images(
            **body.model_dump(mode="json"), run=run)
        sources = [run.candidates[i["candidate_id"]]["source"] for i in images]
        return await store_result(run, "search", {"images": images}, sources)
    return await tool_action(request, "extract-images", body.model_dump(mode="json"), execute, 20)


@router.post("/download")
async def download(body: WebDownloadRequest, request: Request):
    async def execute(run):
        from app.services.web_research.web_media_download import download_material
        source = None
        resolved = body.model_copy()
        if body.candidate_id:
            candidate = resolve_candidate(run, body.candidate_id)
            resolved.url, source = candidate["url"], candidate["source"]
        return await download_material(resolved, run, source)
    return await tool_action(request, "download", body.model_dump(mode="json"),
                             execute, 30 if body.kind == "image" else 180)


@router.post("/research")
async def research(body: WebResearchRequest, request: Request):
    async def execute(run):
        result = await get_web_research_service().research(
            **body.model_dump(), run=run,
            locale=request.headers.get("accept-language", ""))
        return result.model_dump()
    return await tool_action(request, "research", body.model_dump(), execute, 120)


@router.put("/credentials")
async def credentials(body: CredentialsRequest, request: Request):
    validate_ui_origin(request, write=True)
    await system_settings_service.update_setting(
        "web_research", "tavily_api_keys", body.tavily_api_keys)
    return BaseResponse(success=True, message="已更新网络搜索凭证", data={
        "configured": bool(body.tavily_api_keys), "key_count": len(body.tavily_api_keys)})


@router.post("/test-connection")
async def test_connection(request: Request):
    global _last_test
    validate_ui_origin(request, write=True)
    if _test_lock.locked() or time.monotonic() - _last_test < 5:
        raise WebResearchError("research_busy")
    async with _test_lock:
        _last_test = time.monotonic()
        service = get_web_search_service()
        configured = bool(service._api_keys())
        loop = asyncio.get_running_loop()
        deadline = loop.time() + CONNECTION_TIMEOUT
        try:
            async with asyncio.timeout_at(deadline):
                await service.search("Ecliptrix connection test", max_results=1)
                if loop.time() >= deadline:
                    raise TimeoutError
            result = {"configured": configured, "reachable": True}
        except WebResearchError as error:
            result = {"configured": configured, "reachable": False,
                      "error_code": error.error_code}
        except TimeoutError:
            result = {"configured": configured, "reachable": False,
                      "error_code": "upstream_timeout"}
        return BaseResponse(success=True, message="ok", data=result)
