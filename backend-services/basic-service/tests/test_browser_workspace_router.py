"""HTTP 层：新端点、超时链路、取消传播、UI 来源端点、无令牌回显（§4.3.3 / §4.3.4）。"""
import httpx
import pytest
from fastapi import FastAPI

from app.models.web_research_models import WebResearchError
from app.routers import (browser_workspace_router, research_browser_router,
                         research_run_router)
from app.services.browser_workspace import dispatch as module
from app.services.web_research.run_registry import RunRegistry
from tests.browser_workspace_fakes import make_service

CALL = {"n": 0}


def build(monkeypatch, settings=None, **service_options):
    service, driver, artifacts = make_service(settings=settings)
    registry = RunRegistry()
    monkeypatch.setattr(module, "_service", service)
    monkeypatch.setattr(research_run_router, "run_registry", registry)
    config = {"enabled": True, "browser_enabled": True, "downloads_enabled": True,
              "respect_robots": True, "artifact_retention_days": 7}
    monkeypatch.setattr(research_run_router, "research_settings", lambda: config)
    app = FastAPI()
    app.include_router(research_browser_router.router, prefix="/api")
    app.include_router(browser_workspace_router.router, prefix="/api")

    @app.exception_handler(WebResearchError)
    async def handler(request, error):
        return research_run_router.error_response(error)
    return app, service, driver, registry, config


async def start(registry, config):
    run, token = await registry.register(None, 7200000, config)
    return run, {"x-research-run": run.run_id, "x-research-token": token}


def call(headers):
    CALL["n"] += 1
    return {**headers, "x-tool-call-id": f"call-{CALL['n']}"}


@pytest.mark.asyncio
async def test_open_act_request_user_close_over_http(monkeypatch):
    app, service, driver, registry, config = build(monkeypatch)
    run, auth = await start(registry, config)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as client:
        opened = await client.post("/api/web-research/browser/open",
                                   headers=call(auth), json={"url": "https://x.test/", "new_tab": True})
        assert opened.status_code == 200, opened.text
        data = opened.json()["data"]
        assert data["mode"] == "workspace"
        tab = data["session_id"]
        scrolled = await client.post(
            "/api/web-research/browser/act", headers=call(auth),
            json={"action": "scroll", "session_id": tab,
                  "snapshot_version": data["snapshot_version"], "delta_y": 300})
        assert scrolled.status_code == 200, scrolled.text
        back = await client.post(  # 无 snapshot_version / element_ref 的新动作
            "/api/web-research/browser/act", headers=call(auth),
            json={"action": "back", "session_id": tab})
        assert back.status_code == 200, back.text
        press = await client.post(  # press 的 element_ref 可选
            "/api/web-research/browser/act", headers=call(auth),
            json={"action": "press", "session_id": tab, "key": "PageDown",
                  "snapshot_version": data["snapshot_version"]})
        assert press.status_code == 200, press.text
        driver.next_decision = ("completed", 0)
        handoff = await client.post(
            "/api/web-research/browser/request-user", headers=call(auth),
            json={"reason": "需要登录", "kind": "login"})
        assert handoff.json()["data"]["status"] == "completed"
        closed = await client.delete(f"/api/web-research/browser/{tab}",
                                     headers=call(auth))
        assert closed.json()["data"] == {"closed": True}


@pytest.mark.asyncio
async def test_slow_approval_through_http_is_not_cut_by_upstream_timeout(monkeypatch):
    """AC-A13：审批晚到 100 s（假时钟）→ open 与 risky act 均 200，而非 504。"""
    app, service, driver, registry, config = build(monkeypatch)
    driver.consent = False
    driver.next_decision = ("approved", 100)
    run, auth = await start(registry, config)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as client:
        opened = await client.post("/api/web-research/browser/open",
                                   headers=call(auth), json={"url": "https://x.test/"})
        assert opened.status_code == 200, opened.text
        data = opened.json()["data"]
        risky = await client.post(
            "/api/web-research/browser/act", headers=call(auth),
            json={"action": "click", "session_id": data["session_id"],
                  "element_ref": "e4", "snapshot_version": data["snapshot_version"]})
        assert risky.status_code == 200, risky.text


@pytest.mark.asyncio
async def test_registered_tool_timeouts_for_human_waits_and_reads(monkeypatch):
    app, service, driver, registry, config = build(monkeypatch)
    seen = {}
    original = registry.execute

    async def spy(run, call_id, action, params, function, timeout):
        seen[action] = timeout
        return await original(run, call_id, action, params, function, timeout)
    monkeypatch.setattr(registry, "execute", spy)
    run, auth = await start(registry, config)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as client:
        opened = (await client.post("/api/web-research/browser/open",
                                    headers=call(auth), json={"url": "https://x.test/"})).json()["data"]
        tab = opened["session_id"]
        await client.post("/api/web-research/browser/read", headers=call(auth),
                          json={"session_id": tab})
        await client.post("/api/web-research/browser/act", headers=call(auth),
                          json={"action": "scroll", "session_id": tab,
                                "snapshot_version": 1, "delta_y": 1})
        driver.next_decision = ("completed", 0)
        await client.post("/api/web-research/browser/request-user",
                          headers=call(auth), json={"reason": "r", "kind": "other"})
        await client.delete(f"/api/web-research/browser/{tab}", headers=call(auth))
    assert seen == {"browser_open": 135, "browser_act": 135,
                    "browser_request_user": 135, "browser_read": 10,
                    "browser_close": 2}


@pytest.mark.asyncio
async def test_cancelled_call_withdraws_pending_approval(monkeypatch):
    import asyncio
    app, service, driver, registry, config = build(monkeypatch)
    driver.consent = False
    driver.next_decision = ("never", 0)
    run, auth = await start(registry, config)
    original = driver.approval_wait

    async def slow(approval_id, wait_ms):
        await asyncio.sleep(0.02)
        return await original(approval_id, wait_ms)
    driver.approval_wait = slow
    headers = call(auth)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as client:
        pending = asyncio.create_task(client.post(
            "/api/web-research/browser/open", headers=headers,
            json={"url": "https://x.test/"}))
        await asyncio.sleep(0.1)
        # 与 DELETE /runs/{id}/calls/{call_id} 相同的取消入口
        await registry.cancel_call(run, headers["x-tool-call-id"])
        response = await pending
    assert response.status_code == 410
    assert response.json()["error_code"] == "call_cancelled"
    assert driver.cancelled_approvals  # 审批条随调用取消而撤销


@pytest.mark.asyncio
async def test_both_backends_disabled_gives_browser_disabled(monkeypatch):
    app, service, driver, registry, config = build(
        monkeypatch, settings={"agent_enabled": False})
    config["browser_enabled"] = False
    from app.services import system_settings_service as settings_module
    monkeypatch.setattr(settings_module, "browser_workspace_settings",
                        lambda: {"enabled": True, "agent_enabled": False})
    run, auth = await start(registry, config)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as client:
        response = await client.post("/api/web-research/browser/open",
                                     headers=call(auth), json={"url": "https://x.test/"})
    assert response.status_code == 403
    assert response.json()["error_code"] == "browser_disabled"


@pytest.mark.asyncio
async def test_invalid_new_action_payloads_are_rejected(monkeypatch):
    app, service, driver, registry, config = build(monkeypatch)
    run, auth = await start(registry, config)
    tab = "00000000-0000-4000-8000-000000000001"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as client:
        for body in ({"action": "wait", "session_id": tab},
                     {"action": "select", "session_id": tab, "snapshot_version": 1,
                      "element_ref": "e1"},
                     {"action": "press", "session_id": tab, "snapshot_version": 1,
                      "key": "F13"},
                     {"action": "fill", "session_id": tab, "snapshot_version": 1,
                      "element_ref": "e1", "text": "x" * 513}):
            response = await client.post("/api/web-research/browser/act",
                                         headers=call(auth), json=body)
            assert response.status_code == 422, body


@pytest.mark.asyncio
async def test_ui_save_endpoint_requires_ui_origin_and_state_has_no_token(monkeypatch):
    app, service, driver, registry, config = build(monkeypatch)
    monkeypatch.setenv("BROWSER_WORKSPACE_CONTROL_TOKEN", "TOP-SECRET-TOKEN")
    monkeypatch.setenv("RESEARCH_RENDERER_ORIGIN", "http://127.0.0.1:3000")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as client:
        denied = await client.post(
            "/api/browser-workspace/resources/save",
            headers={"origin": "http://evil.test", "content-type": "application/json"},
            json={"tab_id": "t", "url": "https://x.test/a.png", "kind": "image"})
        assert denied.status_code == 403
        missing = await client.post(
            "/api/browser-workspace/resources/save", json={"tab_id": "t"},
            headers={"origin": "http://127.0.0.1:3000"})
        assert missing.status_code == 422
        state = await client.get("/api/browser-workspace/state",
                                 headers={"origin": "http://127.0.0.1:3000"})
    assert state.status_code == 200
    assert state.json()["data"] == {"reachable": True, "version": "t",
                                    "profiles": 1, "tabs": 1}
    assert "TOP-SECRET-TOKEN" not in state.text
