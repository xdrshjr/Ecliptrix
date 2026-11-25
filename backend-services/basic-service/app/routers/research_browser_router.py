"""浏览器严格动作模型和配置状态。"""
from uuid import UUID
from fastapi import APIRouter, Request, Body
from app.models import BaseResponse
from app.models.web_research_models import (
    BrowserOpenRequest, BrowserReadRequest, BrowserActRequest,
    BrowserRequestUserRequest, WebResearchError)
from app.services.browser_workspace.dispatch import dispatch
from app.services.system_settings_service import research_settings
from app.services.web_research.safe_http_client import (
    egress_summary, public_proxy_target)
from .research_run_router import tool_action, validate_ui_origin

router = APIRouter(prefix="/web-research", tags=["Research Browser"])


def browser_service():
    from app.services.web_research.browser_service import get_browser_service
    return get_browser_service()


@router.get("/capabilities")
async def capabilities(request: Request):
    """四段可用性 + 解析后的出口；可用性探测与用户开关分开（§13 / AC-33）。"""
    validate_ui_origin(request)
    from app.services.web_research.safe_http_client import resolved_proxy_summary
    from app.services.web_research.web_search_service import get_web_search_service
    config = research_settings()
    keys = get_web_search_service()._api_keys()
    # 宿主缺失是 unavailable，不是 enabled=false：先探测再看用户意愿。
    browser = await browser_service().availability()
    research = {"available": True, "enabled": config["use_research_model"]}
    if config["use_research_model"]:
        from app.services.model_settings_service import model_settings_service
        try:
            model = await model_settings_service.resolve_research_config()
            research.update(model_name=model.model_name, source=model.source)
        except WebResearchError as error:
            research.update(available=False, error_code=error.error_code)
    enabled = bool(config["enabled"])
    search_available = enabled and bool(keys)
    downloads_available = enabled and bool(config["downloads_enabled"])
    return BaseResponse(success=True, message="ok", data={
        "search": {"available": search_available, "enabled": enabled,
                   "configured": bool(keys), "key_count": len(keys),
                   "error_code": None if search_available else
                   ("provider_not_configured" if not keys else "research_disabled")},
        "browser": {**browser, "enabled": enabled and bool(config["browser_enabled"]),
                    "error_code": browser.get("error_code") or
                    (None if enabled and config["browser_enabled"] else "browser_disabled")},
        "downloads": {"available": downloads_available,
                      "enabled": bool(config["downloads_enabled"]),
                      "error_code": None if downloads_available else
                      "downloads_disabled"},
        "research_model": research,
        "proxy": resolved_proxy_summary(),
        "workspace_browser": await dispatch.capabilities(),
        # tier-2 出口摘要（agent-general-assistant §4.9 / AC-G17）：档位与
        # tier2 是否可用必须在这里可见，否则用户不知道"为什么同一个地址在
        # 别的工具里能下、在这里不能"。
        "egress": egress_summary(),
        "limits": _public_limits(config)})


def _public_limits(config):
    """限额快照：密钥与带 userinfo 的代理地址不外泄（§3.4 / AC-33）。"""
    limits = {k: v for k, v in config.items() if k != "tavily_api_keys"}
    limits["custom_proxy_url"] = public_proxy_target(config.get("custom_proxy_url"))
    return limits


def _context(request):
    """x-browser-mode / x-agent-autonomy 由 Next 的 executeWebTool 注入（§4.4.1）。"""
    return (request.headers.get("x-browser-mode"),
            "yolo" if request.headers.get("x-agent-autonomy") == "yolo"
            else "interactive")


# 可能阻塞等人的调用（consent/risky/handoff ≤125 s）：后端 135 s、Next 140000 ms，
# 两端必须大于等待上限，否则用户还没点就被 upstream_timeout 掐断（R1-1 / AC-A13）。
HUMAN_WAIT_TIMEOUT_S = 135


@router.post("/browser/open")
async def open_browser(body: BrowserOpenRequest, request: Request):
    mode, autonomy = _context(request)
    return await tool_action(request, "browser_open", body.model_dump(),
        lambda run: dispatch.open(run, body.url, body.new_tab, mode, autonomy),
        HUMAN_WAIT_TIMEOUT_S)


@router.post("/browser/read")
async def read_browser(body: BrowserReadRequest, request: Request):
    return await tool_action(request, "browser_read", body.model_dump(mode="json"),
        lambda run: dispatch.read(run, str(body.session_id), body.max_bytes,
                                  body.screenshot, body.elements_max), 10)


@router.post("/browser/act")
async def act_browser(request: Request,
                      body: BrowserActRequest = Body(discriminator="action")):
    _, autonomy = _context(request)
    payload = body.model_dump(mode="json", exclude_none=True)
    return await tool_action(request, "browser_act", payload,
        lambda run: dispatch.act(run, payload, autonomy), HUMAN_WAIT_TIMEOUT_S)


@router.post("/browser/request-user")
async def request_user_browser(body: BrowserRequestUserRequest, request: Request):
    payload = body.model_dump(mode="json")
    return await tool_action(request, "browser_request_user", payload,
        lambda run: dispatch.request_user(run, payload), HUMAN_WAIT_TIMEOUT_S)


@router.delete("/browser/{identifier}")
async def close_browser(identifier: UUID, request: Request):
    return await tool_action(request, "browser_close", {"session_id": str(identifier)},
        lambda run: dispatch.close(run, str(identifier)), 2)
