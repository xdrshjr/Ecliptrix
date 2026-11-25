"""模式选择：同一套 `browser_*` 工具落到「工作台」或「隔离沙盒」（spec §4.3.2）。

`open` 决定模式并由归属表记住；`read/act/close` 按 `session_id` 分发（工作台先，
其后落到 `BrowserService`，由它报 `browser_session_lost`）。研究小队带
`x-browser-mode: isolated` 永远走沙盒，不抢可见窗口（D-BW2-4）。
"""
import asyncio

from app.models.web_research_models import (
    ISOLATED_ACTIONS, WebResearchError)

# 这些回落原因要告诉模型（页面未登录、动作集更少，须如实转述用户）。
NOTABLE_FALLBACKS = frozenset({"workspace_locked", "consent_denied",
                               "consent_required"})
_service = None


def get_workspace_service():
    global _service
    if _service is None:
        from .driver import HttpWorkspaceDriver
        from .service import BrowserWorkspaceService
        _service = BrowserWorkspaceService(HttpWorkspaceDriver())
    return _service


def set_workspace_service(service):
    """测试注入点（Fake 驱动）；传 None 恢复默认。"""
    global _service
    _service = service


ISOLATED_TIMEOUT_S = 20  # 路由层放大到 135 s 只为等人；沙盒卡死仍应 20 s 报错


def _isolated():
    from app.services.web_research.browser_service import get_browser_service
    return get_browser_service()


def require_isolated_enabled():
    """tool_action 只在「两条路都关」时拦截；落到沙盒时这里补上它自己的开关。"""
    from app.services.system_settings_service import research_settings
    if not research_settings()["browser_enabled"]:
        raise WebResearchError("browser_disabled", status_code=403)


async def _bounded(call):
    require_isolated_enabled()
    try:
        async with asyncio.timeout(ISOLATED_TIMEOUT_S):
            return await call
    except TimeoutError:
        raise WebResearchError("upstream_timeout") from None


def _static_reason(header_mode, settings):
    if header_mode == "isolated":
        return "requested_isolated"
    if not settings.get("enabled") or not settings.get("agent_enabled"):
        return "workspace_disabled"
    if settings.get("agent_profile_mode") == "anonymous":
        return "anonymous_profile"
    return None


async def pick_mode(run, header_mode, autonomy, service=None):
    """返回 `('workspace'|'isolated', fallback_reason|None)`。"""
    service = service or get_workspace_service()
    reason = _static_reason(header_mode, service.settings())
    if reason:
        return "isolated", reason
    driver = service.driver
    if hasattr(driver, "configured") and not driver.configured():
        return "isolated", "workspace_unavailable"
    try:
        health = await driver.health(run.run_id)
    except WebResearchError:
        return "isolated", "workspace_unavailable"
    if health.get("locked"):
        return "isolated", "workspace_locked"
    if service.consent_denied(run):
        return "isolated", "consent_denied"
    granted = (health.get("consent") or {}).get("granted")
    if autonomy == "yolo" and not granted:
        return "isolated", "consent_required"
    return "workspace", None


def check_isolated_action(request):
    """沙盒只认老四件（click/fill≤256/press Enter+ref/scroll）。"""
    action = request.get("action")
    unsupported = (
        action not in ISOLATED_ACTIONS
        or (action == "fill" and len(request.get("text") or "") > 256)
        or (action == "press" and (request.get("key") != "Enter"
                                   or not request.get("element_ref"))))
    if unsupported:
        raise WebResearchError("action_unsupported_in_isolated",
                               status_code=422)


class Dispatch:
    """路由层的唯一入口；方法签名与 `BrowserService` 对齐并多带 mode 上下文。"""

    async def open(self, run, url, new_tab=False, header_mode=None,
                   autonomy="interactive"):
        service = get_workspace_service()
        mode, reason = await pick_mode(run, header_mode, autonomy, service)
        if mode == "workspace":
            return await service.open(run, url, new_tab, autonomy)
        result = await _bounded(_isolated().open(run, url))
        result["mode"] = "isolated"
        if reason in NOTABLE_FALLBACKS:
            result["fallback_reason"] = reason
        return result

    async def read(self, run, session_id, max_bytes=4000, screenshot=False,
                   elements_max=None):
        service = get_workspace_service()
        if service.owns(session_id):
            return await service.read(run, session_id, max_bytes, screenshot,
                                      elements_max)
        result = await _bounded(
            _isolated().read(run, session_id, max_bytes, screenshot))
        result["mode"] = "isolated"
        return result

    async def act(self, run, request, autonomy="interactive"):
        service = get_workspace_service()
        if service.owns(request["session_id"]):
            return await service.act(run, request, autonomy)
        check_isolated_action(request)
        return await _bounded(_isolated().act(run, request))

    async def close(self, run, session_id):
        service = get_workspace_service()
        if service.owns(session_id):
            return await service.close(run, session_id)
        return await _bounded(_isolated().close(run, session_id))

    async def request_user(self, run, body):
        service = get_workspace_service()
        settings = service.settings()
        if not settings.get("enabled") or not settings.get("agent_enabled"):
            raise WebResearchError("workspace_disabled", status_code=403)
        return await service.request_user(
            run, body["kind"], body["reason"], body.get("handoff_id"),
            body.get("timeout_s", 120))

    def owns_workspace(self, session_id):
        return get_workspace_service().owns(session_id)

    async def capabilities(self):
        """`/web-research/capabilities.workspace_browser` 段（只含非敏感字段）。"""
        service = get_workspace_service()
        settings = service.settings()
        base = {"available": False, "enabled": bool(settings.get("enabled")),
                "agent_enabled": bool(settings.get("agent_enabled")),
                "consent_granted": False, "profile": None,
                "mode": "isolated", "error_code": "workspace_unavailable"}
        driver = service.driver
        if hasattr(driver, "configured") and not driver.configured():
            return base
        if not await driver.available():
            return base
        try:
            health = await driver.health()
        except WebResearchError:
            return base
        profile = health.get("profile") or None
        usable = (base["enabled"] and base["agent_enabled"] and
                  settings.get("agent_profile_mode") != "anonymous")
        return {**base, "available": True, "error_code": None,
                "consent_granted": bool(
                    (health.get("consent") or {}).get("granted")),
                "profile": {"id": profile.get("id"), "name": profile.get("name")}
                if profile else None,
                "mode": "workspace" if usable else "isolated"}


dispatch = Dispatch()


async def release_run(run_id):
    """run 结束钩子：服务从未创建过就什么都不做（dev/未启用路径零开销）。"""
    if _service is not None:
        await _service.release_run(run_id)


__all__ = ["dispatch", "get_workspace_service", "set_workspace_service",
           "pick_mode", "release_run"]
