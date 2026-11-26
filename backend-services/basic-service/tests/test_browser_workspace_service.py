"""工作台服务：open/read/act/close、归属、预算、审批、request_user（§4.3.3）。"""
import asyncio

import pytest

from app.models.web_research_models import WebResearchError
from tests.browser_workspace_fakes import make_run, make_service


async def opened(service, run, url="https://x.test/"):
    return await service.open(run, url)


@pytest.mark.asyncio
async def test_open_returns_workspace_result_and_1_day_artifacts():
    service, driver, artifacts = make_service()
    _, run, _ = await make_run()
    result = await opened(service, run)
    assert result["mode"] == "workspace" and result["untrusted"] is True
    assert result["profile"] == {"name": "默认"} and result["session_id"]
    assert result["snapshot_version"] == 1 and result["elements"]
    # AC-C11：工作台来源 artifact 留存 1 天，元数据标 source:'workspace'
    write = artifacts.writes[0]
    assert write.kind == "browser_snapshot" and write.retention_days == 1
    assert write.context["source"] == "workspace"
    # AC-A5：口令类元素永不带值，也不出现在序列化结果里
    assert "hunter2" not in str(result)


@pytest.mark.asyncio
async def test_read_with_screenshot_degrades_without_failing_text():
    service, driver, artifacts = make_service()
    _, run, _ = await make_run()
    tab = (await opened(service, run))["session_id"]
    driver.errors["screenshot"] = WebResearchError("screenshot_unavailable")
    result = await service.read(run, tab, 4000, True)
    assert result["text"] and result["screenshot_error"] == "screenshot_unavailable"
    del driver.errors["screenshot"]
    result = await service.read(run, tab, 4000, True)
    assert result["screenshot_artifact_id"]
    assert artifacts.writes[-1].kind == "screenshot"
    assert artifacts.writes[-1].retention_days == 1


@pytest.mark.asyncio
async def test_foreign_or_forged_session_is_lost_not_readable():
    """AC-A10：别的 run 的标签页、伪造 id 都是 browser_session_lost。"""
    service, driver, _ = make_service()
    _, run_a, _ = await make_run()
    _, run_b, _ = await make_run()
    tab = (await opened(service, run_a))["session_id"]
    for caller, session in [(run_b, tab), (run_a, "forged-id")]:
        with pytest.raises(WebResearchError) as caught:
            await service.read(caller, session)
        assert caught.value.error_code == "browser_session_lost"
        assert caught.value.status_code == 410
    with pytest.raises(WebResearchError):
        await service.close(run_b, tab)


@pytest.mark.asyncio
async def test_stale_snapshot_is_rejected_before_the_round_trip():
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    tab = (await opened(service, run))["session_id"]
    before = len(driver.commands)
    with pytest.raises(WebResearchError) as caught:
        await service.act(run, {"session_id": tab, "action": "click",
                                "element_ref": "e1", "snapshot_version": 0})
    assert caught.value.error_code == "stale_snapshot"
    assert len(driver.commands) == before


@pytest.mark.asyncio
async def test_act_click_result_and_sensitive_fill_never_reaches_driver():
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    first = await opened(service, run)
    tab, version = first["session_id"], first["snapshot_version"]
    result = await service.act(run, {"session_id": tab, "action": "click",
                                     "element_ref": "e1", "snapshot_version": version})
    assert result["mode"] == "workspace" and result["settled"] is True
    with pytest.raises(WebResearchError) as caught:
        await service.act(run, {"session_id": tab, "action": "fill",
                                "element_ref": "e3", "snapshot_version": version,
                                "text": "secret"})
    assert caught.value.error_code == "sensitive_field"
    assert all(c.args.get("text") != "secret" for c in driver.commands)


@pytest.mark.asyncio
async def test_risky_click_asks_in_interactive_and_is_refused_in_yolo():
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    first = await opened(service, run)
    tab, version = first["session_id"], first["snapshot_version"]
    request = {"session_id": tab, "action": "click", "element_ref": "e4",
               "snapshot_version": version}
    driver.next_decision = ("denied", 0)
    with pytest.raises(WebResearchError) as caught:
        await service.act(run, request)
    assert caught.value.error_code == "risky_action_denied" and caught.value.sticky
    assert not any(c.type == "click" for c in driver.commands)
    driver.next_decision = ("approved", 0)
    assert (await service.act(run, request))["session_id"] == tab
    with pytest.raises(WebResearchError) as caught:
        await service.act(run, request, autonomy="yolo")
    assert caught.value.error_code == "risky_action_blocked_autonomous"
    assert caught.value.sticky is False


@pytest.mark.asyncio
async def test_action_budget_exhaustion_closes_the_session():
    service, driver, _ = make_service(settings={"max_actions_per_run": 2})
    _, run, _ = await make_run()
    first = await opened(service, run)
    request = {"session_id": first["session_id"], "action": "scroll",
               "delta_y": 100, "snapshot_version": first["snapshot_version"]}
    await service.act(run, request)
    with pytest.raises(WebResearchError) as caught:
        await service.act(run, request)
    assert caught.value.error_code == "browser_budget_exceeded"
    assert not service.owns(first["session_id"])
    assert run.run_id in driver.released


@pytest.mark.asyncio
async def test_close_releases_control_only_with_last_tab_and_run_end_releases():
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    tab = (await opened(service, run))["session_id"]
    assert await service.close(run, tab) == {"closed": True}
    assert driver.released == [run.run_id]
    await service.release_run("never-used-run")
    assert driver.released == [run.run_id]  # 没用过工作台的 run 零往返


@pytest.mark.asyncio
async def test_consent_is_asked_once_for_concurrent_opens_and_denial_is_sticky():
    service, driver, _ = make_service()
    driver.consent = False
    driver.next_decision = ("denied", 0)
    _, run, _ = await make_run()
    results = await asyncio.gather(opened(service, run), opened(service, run),
                                   return_exceptions=True)
    assert all(isinstance(r, WebResearchError) and r.error_code == "consent_denied"
               for r in results)
    assert len([a for a in driver.approvals.values() if a["kind"] == "consent"]) == 1
    assert service.consent_denied(run)
    assert results[0].sticky is True


@pytest.mark.asyncio
async def test_authorization_delay_up_to_120s_still_succeeds_without_real_waiting():
    """AC-A13：审批晚到 60–120 s（假时钟），open/act/request_user 都成功。"""
    for delay in (60, 119):
        service, driver, _ = make_service()
        driver.consent = False
        driver.next_decision = ("approved", delay)
        _, run, _ = await make_run()
        first = await opened(service, run)
        assert first["mode"] == "workspace"
        risky = {"session_id": first["session_id"], "action": "click",
                 "element_ref": "e4", "snapshot_version": first["snapshot_version"]}
        assert (await service.act(run, risky))["session_id"]
        driver.next_decision = ("completed", delay)
        done = await service.request_user(run, "login", "需要登录")
        assert done["status"] == "completed"


def test_wait_caps_are_below_both_timeout_layers():
    from app.routers.research_browser_router import HUMAN_WAIT_TIMEOUT_S
    from app.services.browser_workspace import approvals
    longest = max(approvals.CONSENT_WAIT_S, approvals.RISKY_WAIT_S,
                  approvals.HANDOFF_WAIT_S)
    assert longest < HUMAN_WAIT_TIMEOUT_S == 135


@pytest.mark.asyncio
async def test_approval_beyond_the_cap_expires_and_the_banner_is_withdrawn():
    service, driver, _ = make_service()
    driver.consent = False
    driver.next_decision = ("approved", 500)
    _, run, _ = await make_run()
    with pytest.raises(WebResearchError) as caught:
        await opened(service, run)
    assert caught.value.error_code == "consent_denied"
    assert driver.cancelled_approvals  # 不留残条


@pytest.mark.asyncio
async def test_cancelling_a_waiting_call_withdraws_the_pending_approval():
    service, driver, _ = make_service()
    driver.consent = False
    driver.next_decision = ("never", 0)
    _, run, _ = await make_run()
    original = driver.approval_wait

    async def slow(approval_id, wait_ms):
        await asyncio.sleep(0.01)
        return await original(approval_id, wait_ms)
    driver.approval_wait = slow
    task = asyncio.create_task(opened(service, run))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(driver.cancelled_approvals) == 1


@pytest.mark.asyncio
async def test_request_user_three_states_and_attempt_cap():
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    await opened(service, run)
    driver.next_decision = ("never", 0)
    waiting = await service.request_user(run, "login", "登录", None, 10)
    assert waiting["status"] == "waiting"
    handoff = waiting["handoff_id"]
    again = await service.request_user(run, "login", "登录", handoff, 10)
    assert again["status"] == "waiting" and again["handoff_id"] == handoff
    with pytest.raises(WebResearchError) as caught:
        await service.request_user(run, "login", "登录", handoff, 10)
    assert caught.value.error_code == "handoff_timeout"
    driver.next_decision = ("cancelled", 0)
    cancelled = await service.request_user(run, "captcha", "验证码")
    assert cancelled["status"] == "cancelled"
    with pytest.raises(WebResearchError):
        await service.request_user(run, "login", "x",
                                   "00000000-0000-4000-8000-000000000000")


@pytest.mark.asyncio
async def test_handoff_reason_prefix_is_the_login_contract():
    """W1 契约：主进程 loginHeuristics.isLoginHandoff 只认 `login:` 前缀。"""
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    await opened(service, run)
    driver.next_decision = ("never", 0)
    await service.request_user(run, "login", "请登录", None, 10)
    await service.request_user(run, "captcha", "请过验证码", None, 10)
    reasons = [r["reason"] for r in driver.approvals.values()]
    assert reasons[0].startswith("login:")
    assert reasons[1].startswith("captcha:") and not reasons[1].startswith("login:")


@pytest.mark.asyncio
async def test_navigation_precheck_blocks_before_any_command():
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    with pytest.raises(WebResearchError) as caught:
        await service.open(run, "https://www.paypal.com/")
    assert caught.value.error_code == "sensitive_site_blocked"
    assert driver.commands == []


@pytest.mark.asyncio
async def test_run_release_cancels_pending_approvals_and_forgets_tabs():
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    tab = (await opened(service, run))["session_id"]
    approval = await service.waiter.create(run, "handoff", "x")
    await service.release_run(run.run_id)
    assert not service.owns(tab) and approval in driver.cancelled_approvals
    assert run.run_id in driver.released


@pytest.mark.asyncio
async def test_audit_records_host_only_never_input_text():
    from app.services.agent_host import audit
    audit.clear()
    service, driver, _ = make_service()
    _, run, _ = await make_run()
    first = await service.open(run, "https://x.test/path?q=secret-token")
    await service.act(run, {"session_id": first["session_id"], "action": "fill",
                            "element_ref": "e2", "text": "MY-TYPED-TEXT",
                            "snapshot_version": first["snapshot_version"]})
    dumped = str(list(audit.entries))
    assert "x.test" in dumped and "browser" in dumped
    assert "MY-TYPED-TEXT" not in dumped and "secret-token" not in dumped
