"""`/api/agent-host/*` 端点：能力、闸门、命令执行、限幅、脱敏、限流。

覆盖 AC-G08/09/10/11/17/18/22b。
"""
import copy
import sys

import pytest

from app.models.agent_host_models import AgentHostError
from app.routers import agent_host_router as router_module
from app.services.agent_host import audit, egress, shell_runner
from tests.agent_toolkit_support import FakeRequest, origin_headers


@pytest.fixture
def host_settings(monkeypatch):
    """按需覆盖 `AGENT_HOST_DEFAULTS`（读取链每��都重新 import 它）。"""
    from app.services import system_settings_service as module

    def apply(**overrides):
        base = copy.deepcopy(module.AGENT_HOST_DEFAULTS)
        base.update(overrides)
        monkeypatch.setattr(module, "AGENT_HOST_DEFAULTS", base)
        return base

    apply()
    return apply


@pytest.fixture(autouse=True)
def clean_rate_window():
    egress._rate_hits.clear()
    audit.clear()
    yield
    egress._rate_hits.clear()


def write_request(**extra):
    return FakeRequest(origin_headers(**{
        "content-type": "application/json", "x-tool-call-id": "call-1", **extra}))


def envelope(response):
    import json

    return json.loads(response.body)


def error_of(call):
    with pytest.raises(AgentHostError) as caught:
        call()
    return caught.value


# ── 能力自证 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_capabilities_shape_and_no_userinfo(host_settings, monkeypatch):
    host_settings(egress_mode="balanced")
    monkeypatch.setenv("HTTP_PROXY", "http://user:secret@127.0.0.1:7890")
    response = await router_module.get_capabilities(FakeRequest({}))
    data = response.data
    assert set(data) == {"enabled", "shell", "fs", "egress", "limits"}
    assert data["shell"]["scope"] == "workspace"
    assert data["egress"]["mode"] == "balanced"
    assert "user:secret@" not in data["egress"]["proxy"]["target"]
    assert data["egress"]["proxy"]["target"]
    assert data["limits"]["max_concurrency"] == 2


@pytest.mark.asyncio
async def test_audit_returns_recent_entries(host_settings):
    audit.record("probe", project_id="p1")
    response = await router_module.get_audit(FakeRequest({}), limit=10)
    assert response.data["entries"][0]["event"] == "probe"


# ── Origin / JSON 闸门（AC-G18 的后端一半） ───────────────────────────────

def test_write_without_origin_is_forbidden(host_settings):
    error = error_of(lambda: router_module.host_guard(FakeRequest({}), write=True))
    assert error.error_code == "origin_forbidden"
    assert error.status_code == 403


def test_write_without_json_is_415(host_settings):
    request = FakeRequest(origin_headers(**{"content-type": "text/plain"}))
    error = error_of(lambda: router_module.host_guard(request, write=True))
    assert error.error_code == "json_required"
    assert error.status_code == 415


def test_unsafe_call_id_is_invalid_argument(host_settings):
    request = write_request(**{"x-tool-call-id": "../escape"})
    error = error_of(lambda: router_module.host_guard(request, write=True))
    assert error.error_code == "invalid_argument"


# ── 本机命令 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_echo_returns_exit_zero_and_real_shell(host_settings):
    host_settings(shell_max_output_kb=8)
    body = router_module.ShellRunRequest(command="echo hi")
    response = await router_module.run_shell(body, write_request())
    data = response.data
    assert data["exit_code"] == 0
    assert "hi" in data["stdout"]
    assert data["shell"]
    assert data["killed"] is False


@pytest.mark.asyncio
async def test_nonzero_exit_is_a_normal_result(host_settings):
    host_settings()
    command = "exit 3" if sys.platform == "win32" else "exit 3"
    body = router_module.ShellRunRequest(command=command)
    data = (await router_module.run_shell(body, write_request())).data
    assert data["exit_code"] == 3
    assert data["killed"] is False


@pytest.mark.asyncio
async def test_timeout_kills_the_process_tree(host_settings):
    host_settings(shell_timeout_s=120)
    command = ("ping -n 60 127.0.0.1 > nul" if sys.platform == "win32"
               else "sleep 60")
    body = router_module.ShellRunRequest(command=command, timeout_ms=1000)
    data = (await router_module.run_shell(body, write_request())).data
    assert data["killed"] is True
    assert data["exit_code"] is None


@pytest.mark.asyncio
async def test_stdout_over_the_cap_is_truncated(host_settings, tmp_path):
    host_settings(shell_max_output_kb=8)
    # 用一个**脚本文件**造大输出：命令行里不带引号嵌套，也不依赖 cmd 内建命令
    # 的逐行开销（`for /l … echo` 在管道下会慢到撞上 120 s 超时）。
    script = tmp_path / "big_output.py"
    script.write_text("print('x' * 200000)\n", encoding="utf-8")
    command = f'"{sys.executable}" "{script}"'
    body = router_module.ShellRunRequest(command=command)
    data = (await router_module.run_shell(body, write_request())).data
    assert data["stdout_truncated"] is True
    assert len(data["stdout"].encode()) <= 8 * 1024


@pytest.mark.asyncio
async def test_output_redacts_credentials(host_settings):
    host_settings()
    token = "sk-" + "live" + "A" * 24
    body = router_module.ShellRunRequest(command=f"echo {token}")
    data = (await router_module.run_shell(body, write_request())).data
    assert token not in data["stdout"]
    assert "***REDACTED***" in data["stdout"]


@pytest.mark.asyncio
async def test_child_process_never_sees_credentials(host_settings, monkeypatch):
    host_settings()
    monkeypatch.setenv("LLM_API_KEY", "sk-should-never-leak-000000000000")
    monkeypatch.setenv("TAVILY_API_KEYS", "tvly-should-never-leak")
    command = "set" if sys.platform == "win32" else "env"
    body = router_module.ShellRunRequest(command=command)
    data = (await router_module.run_shell(body, write_request())).data
    assert "should-never-leak" not in data["stdout"]
    assert "ECLIPTRIX_AGENT_HOST=1" in data["stdout"]


@pytest.mark.asyncio
async def test_shell_disabled_switch(host_settings):
    host_settings(shell_enabled=False)
    body = router_module.ShellRunRequest(command="echo hi")
    with pytest.raises(AgentHostError) as caught:
        await router_module.run_shell(body, write_request())
    assert caught.value.error_code == "shell_disabled"
    assert caught.value.status_code == 403


# ── 错误信封 / 限流 ───────────────────────────────────────────────────────

def test_envelope_carries_reason_and_sticky(host_settings):
    error = AgentHostError("path_forbidden", reason="host_literal_non_global",
                           remediation="use another host")
    payload = envelope(router_module.error_response(error))
    assert payload["error_details"]["reason"] == "host_literal_non_global"
    assert payload["error_details"]["sticky"] is True
    assert payload["error_details"]["remediation"]


def test_transient_errors_are_not_sticky(host_settings):
    payload = envelope(router_module.error_response(
        AgentHostError("shell_busy")))
    assert payload["error_details"]["sticky"] is False
    assert payload["error_details"]["retryable"] is True


@pytest.mark.asyncio
async def test_per_minute_limit_returns_retry_after(host_settings, monkeypatch):
    host_settings(egress_max_per_minute=2)

    async def fake_fetch(policy, request):
        raise AssertionError("the limiter must fire before any request")

    from app.services.web_research import safe_http_client as client_module

    monkeypatch.setattr(client_module, "_client", None)
    monkeypatch.setattr(client_module, "get_safe_http_client",
                        lambda: _StubClient(fake_fetch))
    egress._rate_hits.clear()
    import time

    now = time.monotonic()
    egress._rate_hits.extend([now, now])
    with pytest.raises(AgentHostError) as caught:
        await egress.http_request("GET", "https://example.com/")
    assert caught.value.error_code == "egress_rate_limited"
    payload = envelope(router_module.error_response(caught.value))
    assert payload["error_details"]["retryable"] is True


@pytest.mark.asyncio
async def test_egress_bodies_accept_the_project_id_the_tools_send(
        host_settings, monkeypatch):
    """AC-G24 的邻接回归：`extra="forbid"` 下多一个字段就是 422。

    前端三个出口工具与 `/fs/*` 一样统一下发 `project_id`（只用于审计归属）；
    spec §6 的 `/egress/*` 请求体表漏了它，一旦模型层照发，整条 tier-2 出口
    在 pydantic 校验阶段就 422，`download_url` 这个"维基图片下载"的唯一出路
    直接不可用。这里钉死三个端点都接受它。
    """
    from app.models.agent_host_models import (
        EgressDiagnoseModel, EgressDownloadModel, EgressRequestModel)

    assert EgressRequestModel(url="https://e.com/", project_id="p-1").project_id \
        == "p-1"
    assert EgressDownloadModel(url="https://e.com/a.jpg", kind="image",
                               project_id="p-1").project_id == "p-1"
    assert EgressDiagnoseModel(url="https://e.com/", project_id="p-1").project_id \
        == "p-1"

    calls = []

    async def fake_request(method, url, headers=None, max_bytes=None,
                            timeout_ms=None, allow_robots=True, project_id=None):
        calls.append(project_id)
        return {"status": 200}

    monkeypatch.setattr(egress, "http_request", fake_request)
    body = EgressRequestModel(method="GET", url="https://e.com/",
                              project_id="p-1")
    await router_module.egress_request(body, write_request())
    assert calls == ["p-1"]


class _StubClient:
    def __init__(self, fetch):
        self._fetch = fetch

    async def fetch(self, policy, request):
        return await self._fetch(policy, request)
