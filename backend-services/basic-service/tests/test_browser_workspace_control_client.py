"""回环控制客户端：Bearer、trust_env=False、写操作不重试、错误还原（§4.3.1）。"""
import pytest
from aiohttp import web

from app.models.web_research_models import WebResearchError
from app.services.browser_workspace.control_client import ControlClient
from app.services.browser_workspace.driver import HttpWorkspaceDriver


async def serve(routes):
    app = web.Application()
    app.add_routes(routes)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, f"http://127.0.0.1:{port}"


@pytest.mark.asyncio
async def test_bearer_header_and_command_round_trip():
    seen = {}

    async def commands(request):
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = await request.json()
        return web.json_response({"ok": True, "result": {"tab_id": "t1"}})

    runner, url = await serve([web.post("/v1/commands", commands)])
    try:
        driver = HttpWorkspaceDriver(ControlClient((url, "tok-123")))
        result = await driver.command("run-1", "open", {"url": "https://x.test/"},
                                      timeout_s=5, command_id="c1")
    finally:
        await runner.cleanup()
    assert result == {"tab_id": "t1"}
    assert seen["auth"] == "Bearer tok-123"
    assert seen["body"] == {"id": "c1", "run_id": "run-1", "type": "open",
                            "args": {"url": "https://x.test/"}, "timeout_ms": 5000}


@pytest.mark.asyncio
async def test_error_payloads_map_to_registered_codes_and_423_is_locked():
    async def locked(request):
        return web.json_response({"ok": False, "error_code": "workspace_locked"},
                                 status=423)

    async def obscured(request):
        return web.json_response({"ok": False, "error_code": "element_obscured",
                                  "details": {"message": "Cookie 横幅遮挡"}}, status=409)

    runner, url = await serve([web.post("/v1/commands", locked),
                               web.post("/v1/control/release", obscured)])
    try:
        client = ControlClient((url, "t"))
        with pytest.raises(WebResearchError) as caught:
            await client.request("POST", "/v1/commands", json={})
        assert caught.value.error_code == "workspace_locked"
        assert caught.value.status_code == 423 and caught.value.failure_class == "configuration"
        with pytest.raises(WebResearchError) as caught:
            await client.request("POST", "/v1/control/release", json={})
        assert caught.value.error_code == "element_obscured"
        assert caught.value.failure_class == "transient" and not caught.value.sticky
    finally:
        await runner.cleanup()


@pytest.mark.asyncio
async def test_write_requests_are_never_retried_but_reads_retry_once():
    hits = {"post": 0, "get": 0}

    async def drop(request):
        hits["post" if request.method == "POST" else "get"] += 1
        request.transport.close()
        return web.Response()

    runner, url = await serve([web.post("/v1/commands", drop),
                               web.get("/v1/health", drop)])
    try:
        client = ControlClient((url, "t"))
        with pytest.raises(WebResearchError) as caught:
            await client.request("POST", "/v1/commands", json={})
        assert caught.value.error_code == "browser_session_lost"
        with pytest.raises(WebResearchError) as caught:
            await client.request("GET", "/v1/health", timeout=2)
        assert caught.value.error_code == "workspace_unavailable"
    finally:
        await runner.cleanup()
    assert hits == {"post": 1, "get": 2}


def test_unconfigured_client_reports_unavailable_without_network(monkeypatch):
    monkeypatch.delenv("BROWSER_WORKSPACE_CONTROL_URL", raising=False)
    monkeypatch.delenv("BROWSER_WORKSPACE_CONTROL_TOKEN", raising=False)
    client = ControlClient()
    assert client.configured() is False
    with pytest.raises(WebResearchError) as caught:
        client._target()
    assert caught.value.error_code == "workspace_unavailable"


@pytest.mark.asyncio
async def test_system_proxy_env_is_ignored(monkeypatch):
    """R2-9：HTTP(S)_PROXY 指向死地址也不影响回环请求。"""
    async def health(request):
        return web.json_response({"ok": True})

    runner, url = await serve([web.get("/v1/health", health)])
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    try:
        payload = await ControlClient((url, "t")).request("GET", "/v1/health", timeout=3)
    finally:
        await runner.cleanup()
    assert payload == {"ok": True}
