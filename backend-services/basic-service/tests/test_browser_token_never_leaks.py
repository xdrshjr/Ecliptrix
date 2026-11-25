"""控制令牌不出现在响应/日志/审计/bash 子进程 env（spec §4.3.5 / AC-F6）。"""
import json
import logging

import pytest

from app.services.agent_host import audit, shell_runner
from tests.browser_workspace_fakes import make_run, make_service

TOKEN = "WS-TOKEN-" + "x9" * 16


@pytest.fixture(autouse=True)
def token_env(monkeypatch):
    monkeypatch.setenv("BROWSER_WORKSPACE_CONTROL_TOKEN", TOKEN)
    monkeypatch.setenv("BROWSER_WORKSPACE_CONTROL_URL", "http://127.0.0.1:1")


def test_bash_child_environment_has_no_control_token_or_url_token(monkeypatch):
    monkeypatch.setattr(shell_runner, "ENV_ALLOWLIST",
                        (*shell_runner.ENV_ALLOWLIST, "BROWSER_WORKSPACE_CONTROL_TOKEN"))
    environment = shell_runner._environment("project-1")
    assert "BROWSER_WORKSPACE_CONTROL_TOKEN" not in environment
    assert TOKEN not in json.dumps(environment)


@pytest.mark.asyncio
async def test_tool_results_audit_and_logs_never_contain_the_token(caplog):
    caplog.set_level(logging.DEBUG)
    audit.clear()
    service, driver, artifacts = make_service()
    _, run, _ = await make_run()
    first = await service.open(run, "https://x.test/p?token=abc")
    read = await service.read(run, first["session_id"], 4000, True)
    from app.services.browser_workspace import dispatch as module
    module._service = service
    try:
        capabilities = await module.dispatch.capabilities()
    finally:
        module._service = None
    blob = json.dumps([first, read, capabilities, list(audit.entries),
                       [w.context for w in artifacts.writes]], default=str)
    assert TOKEN not in blob and TOKEN not in caplog.text
    assert "BROWSER_WORKSPACE_CONTROL" not in blob


def test_error_details_do_not_echo_endpoint_or_token():
    from app.models.web_research_models import WebResearchError
    from app.routers.research_run_router import error_details
    from app.services.browser_workspace.control_client import error_from_payload
    error = error_from_payload(503, {"error_code": "workspace_unavailable"})
    assert isinstance(error, WebResearchError)
    assert TOKEN not in json.dumps(error_details(error), default=str)
