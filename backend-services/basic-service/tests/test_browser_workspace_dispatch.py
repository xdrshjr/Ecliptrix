"""模式选择矩阵与路由分发（spec §4.3.2 / AC-A8 / AC-A9）。"""
import pytest

from app.models.web_research_models import WebResearchError
from app.services.browser_workspace import dispatch as module
from tests.browser_workspace_fakes import make_run, make_service


@pytest.fixture
def workspace(monkeypatch):
    service, driver, artifacts = make_service()
    monkeypatch.setattr(module, "_service", service)
    return service, driver, artifacts


@pytest.mark.asyncio
@pytest.mark.parametrize("header,settings,autonomy,tweak,expected", [
    (None, {}, "interactive", None, ("workspace", None)),
    ("isolated", {}, "interactive", None, ("isolated", "requested_isolated")),
    (None, {"enabled": False}, "interactive", None, ("isolated", "workspace_disabled")),
    (None, {"agent_enabled": False}, "interactive", None, ("isolated", "workspace_disabled")),
    (None, {"agent_profile_mode": "anonymous"}, "interactive", None,
     ("isolated", "anonymous_profile")),
    (None, {}, "interactive", lambda d: setattr(d, "is_configured", False),
     ("isolated", "workspace_unavailable")),
    (None, {}, "interactive", lambda d: setattr(d, "reachable", False),
     ("isolated", "workspace_unavailable")),
    (None, {}, "interactive", lambda d: setattr(d, "locked", True),
     ("isolated", "workspace_locked")),
    (None, {}, "yolo", lambda d: setattr(d, "consent", False),
     ("isolated", "consent_required")),
    (None, {}, "yolo", None, ("workspace", None)),
    (None, {}, "interactive", lambda d: setattr(d, "consent", False),
     ("workspace", None)),
])
async def test_mode_matrix(header, settings, autonomy, tweak, expected):
    service, driver, _ = make_service(settings=settings)
    if tweak:
        tweak(driver)
    _, run, _ = await make_run()
    assert await module.pick_mode(run, header, autonomy, service) == expected


@pytest.mark.asyncio
async def test_consent_denied_run_falls_back_to_isolated_with_reason():
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    service.denied_runs.add(run.run_id)
    assert await module.pick_mode(run, None, "interactive", service) == (
        "isolated", "consent_denied")


@pytest.mark.asyncio
async def test_open_routes_to_isolated_and_marks_mode(workspace, monkeypatch):
    service, driver, _ = workspace
    driver.locked = True
    calls = []

    class Isolated:
        async def open(self, run, url):
            calls.append(url)
            return {"session_id": "s", "url": url}

    monkeypatch.setattr(module, "_isolated", lambda: Isolated())
    monkeypatch.setattr(module, "require_isolated_enabled", lambda: None)
    _, run, _ = await make_run()
    result = await module.dispatch.open(run, "https://x.test/")
    assert calls == ["https://x.test/"] and result["mode"] == "isolated"
    assert result["fallback_reason"] == "workspace_locked"
    assert driver.commands == []  # AC-F8：锁定期间不触碰工作台


@pytest.mark.asyncio
async def test_research_crew_header_never_touches_workspace(workspace, monkeypatch):
    service, driver, _ = workspace

    class Isolated:
        async def open(self, run, url):
            return {"session_id": "s"}

    monkeypatch.setattr(module, "_isolated", lambda: Isolated())
    monkeypatch.setattr(module, "require_isolated_enabled", lambda: None)
    _, run, _ = await make_run()
    result = await module.dispatch.open(run, "https://x.test/", False, "isolated")
    assert result["mode"] == "isolated" and "fallback_reason" not in result
    assert driver.commands == [] and driver.approvals == {}


@pytest.mark.asyncio
async def test_read_act_close_follow_session_ownership(workspace, monkeypatch):
    service, driver, _ = workspace
    _, run, _ = await make_run()
    first = await module.dispatch.open(run, "https://x.test/")
    assert first["mode"] == "workspace"
    tab = first["session_id"]
    read = await module.dispatch.read(run, tab)
    assert read["mode"] == "workspace"
    assert (await module.dispatch.close(run, tab)) == {"closed": True}


@pytest.mark.asyncio
@pytest.mark.parametrize("request_body", [
    {"action": "select", "element_ref": "e1", "option_text": "x"},
    {"action": "hover", "element_ref": "e1"},
    {"action": "back"}, {"action": "forward"}, {"action": "reload"},
    {"action": "wait", "ms": 100},
    {"action": "press", "key": "Tab", "element_ref": "e1"},
    {"action": "press", "key": "Enter"},
    {"action": "fill", "element_ref": "e1", "text": "x" * 300}])
async def test_isolated_rejects_new_actions_without_stickiness(request_body):
    with pytest.raises(WebResearchError) as caught:
        module.check_isolated_action(request_body)
    assert caught.value.error_code == "action_unsupported_in_isolated"
    assert caught.value.sticky is False


def test_isolated_keeps_the_original_four_actions():
    for body in ({"action": "click", "element_ref": "e1"},
                 {"action": "fill", "element_ref": "e1", "text": "x"},
                 {"action": "press", "key": "Enter", "element_ref": "e1"},
                 {"action": "scroll", "delta_y": 10}):
        module.check_isolated_action(body)


@pytest.mark.asyncio
async def test_capabilities_section_has_only_non_sensitive_fields(workspace):
    service, driver, _ = workspace
    section = await module.dispatch.capabilities()
    assert set(section) == {"available", "enabled", "agent_enabled",
                            "consent_granted", "profile", "mode", "error_code"}
    assert section["available"] and section["mode"] == "workspace"
    assert section["profile"] == {"id": "a1", "name": "默认"}
    driver.locked = True
    assert (await module.dispatch.capabilities())["available"] is False
    driver.is_configured = False
    assert (await module.dispatch.capabilities())["error_code"] == "workspace_unavailable"


@pytest.mark.asyncio
async def test_release_hook_is_noop_without_service_and_forwards_with_one(monkeypatch):
    monkeypatch.setattr(module, "_service", None)
    await module.release_run("r1")
    service, driver, _ = make_service()
    monkeypatch.setattr(module, "_service", service)
    service.used.add("r1")
    await module.release_run("r1")
    assert driver.released == ["r1"]
