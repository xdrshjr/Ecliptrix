import asyncio
import pytest


@pytest.mark.asyncio
async def test_idempotency_conflict_and_cancel_before_post():
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError
    registry = RunRegistry()
    run, token = await registry.register(None)
    assert await registry.authenticate(run.run_id, token) is run
    count = 0
    async def action():
        nonlocal count
        count += 1
        return {'ok': True}
    assert await registry.execute(run, 'call-1', 'search', {'q': 1}, action, 1) == {'ok': True}
    await registry.execute(run, 'call-1', 'search', {'q': 1}, action, 1)
    assert count == 1
    with pytest.raises(WebResearchError, match='idempotency_conflict'):
        await registry.execute(run, 'call-1', 'search', {'q': 2}, action, 1)
    await registry.cancel_call(run, 'late', 'search', 'timeout')
    with pytest.raises(WebResearchError, match='call_cancelled'):
        await registry.execute(run, 'late', 'search', {}, action, 1)
    await registry.cancel(run.run_id)
    with pytest.raises(WebResearchError, match='run_closed'):
        await registry.authenticate(run.run_id, token)


@pytest.mark.asyncio
async def test_deadline_cancels_work_even_with_valid_lease():
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError
    registry = RunRegistry()
    run, _ = await registry.register(None)
    ended = asyncio.Event()
    async def work():
        try:
            await asyncio.sleep(99)
        finally:
            ended.set()
    with pytest.raises(WebResearchError):
        await registry.execute(run, 'slow', 'fetch', {}, work, .02)
    assert ended.is_set()
    assert run.state == 'active'


@pytest.mark.asyncio
async def test_capacity_and_cancel_tombstone_cannot_be_evicted_to_restart():
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError
    registry = RunRegistry()
    run, _ = await registry.register(None)
    for index in range(80):
        await registry.cancel_call(run, str(index))
    with pytest.raises(WebResearchError, match='research_busy'):
        await registry.cancel_call(run, '81')
    async def forbidden():
        pytest.fail('取消墓碑不允许迟到执行')
    with pytest.raises(WebResearchError, match='call_cancelled'):
        await registry.execute(run, '0', 'fetch', {}, forbidden, 1)
    for _ in range(3):
        await registry.register(None)
    with pytest.raises(WebResearchError, match='research_busy'):
        await registry.register(None)
    await registry.close()


@pytest.mark.asyncio
async def test_identical_inflight_requests_share_one_task():
    from app.services.web_research.run_registry import RunRegistry
    registry = RunRegistry()
    run, _ = await registry.register(None)
    calls = []
    async def work():
        calls.append(True)
        await asyncio.sleep(.01)
        return {'ok': True}
    first, second = await asyncio.gather(
        registry.execute(run, 'same', 'search', {}, work, 1),
        registry.execute(run, 'same', 'search', {}, work, 1))
    assert first == second and len(calls) == 1


@pytest.mark.asyncio
async def test_call_id_is_bound_to_one_action_and_policy_repeat_is_blocked():
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError
    registry = RunRegistry()
    run, _ = await registry.register(None)
    async def rejected():
        raise WebResearchError('url_forbidden')
    with pytest.raises(WebResearchError, match='url_forbidden'):
        await registry.execute(run, 'one', 'fetch', {}, rejected, 1)
    with pytest.raises(WebResearchError, match='idempotency_conflict'):
        await registry.execute(run, 'one', 'download', {}, rejected, 1)
    with pytest.raises(WebResearchError, match='blocked_repeat'):
        await registry.execute(run, 'two', 'fetch', {}, rejected, 1)


@pytest.mark.asyncio
@pytest.mark.parametrize('second_cancel', ['run', 'call'])
async def test_repeated_cancel_does_not_interrupt_cleanup(second_cancel):
    from app.services.web_research.run_registry import RunRegistry
    registry = RunRegistry()
    run, _ = await registry.register(None)
    started, cleaning = asyncio.Event(), asyncio.Event()
    release, cleaned = asyncio.Event(), asyncio.Event()

    async def work():
        try:
            started.set()
            await asyncio.Future()
        finally:
            cleaning.set()
            await release.wait()
            cleaned.set()

    action = asyncio.create_task(
        registry.execute(run, 'active', 'fetch', {}, work, 10))
    await started.wait()
    first = asyncio.create_task(registry.cancel(run.run_id))
    await cleaning.wait()
    second = asyncio.create_task(
        registry.cancel(run.run_id) if second_cancel == 'run'
        else registry.cancel_call(run, 'active'))
    await asyncio.sleep(0)
    release.set()
    await asyncio.gather(first, second, action, return_exceptions=True)
    assert cleaned.is_set()
    assert run.state == 'closed'


@pytest.mark.asyncio
async def test_disconnect_of_cancel_request_does_not_cancel_run_cleanup():
    from app.services.web_research.run_registry import RunRegistry
    registry = RunRegistry()
    run, _ = await registry.register(None)
    started, release = asyncio.Event(), asyncio.Event()

    async def close_browser(current):
        started.set()
        await release.wait()

    registry.close_browser = close_browser
    caller = asyncio.create_task(registry.cancel(run.run_id))
    await started.wait()
    caller.cancel()
    with pytest.raises(asyncio.CancelledError):
        await caller
    release.set()
    await asyncio.wait_for(registry.cancel(run.run_id), 1)
    assert run.state == 'closed'


@pytest.mark.asyncio
async def test_non_sticky_policy_failure_does_not_block_the_same_call():
    """C-4 回归：DNS/代理类失败不是永久的，改完设置必须能重试成功。"""
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError

    registry = RunRegistry()
    run, _ = await registry.register(None)

    async def failing():
        raise WebResearchError("dns_answer_non_global", sticky=False,
                               reason="dns_answer_non_global", layer="dns")

    params = {"url": "https://upload.wikimedia.org/x.jpg"}
    with pytest.raises(WebResearchError, match="dns_answer_non_global"):
        await registry.execute(run, "call-1", "download", params, failing, 1)
    # 同一 (action, digest) 换一个 call id 重试：不得 blocked_repeat。
    with pytest.raises(WebResearchError, match="dns_answer_non_global"):
        await registry.execute(run, "call-2", "download", params, failing, 1)


@pytest.mark.asyncio
async def test_sticky_policy_failure_still_blocks_the_same_call():
    """反向断言：robots 类策略失败仍然永久拒绝同一调用（既有行为不变）。"""
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError

    registry = RunRegistry()
    run, _ = await registry.register(None)

    async def failing():
        raise WebResearchError("robots_disallowed")

    params = {"url": "https://site.example/a"}
    with pytest.raises(WebResearchError, match="robots_disallowed"):
        await registry.execute(run, "call-1", "fetch", params, failing, 1)
    with pytest.raises(WebResearchError, match="blocked_repeat"):
        await registry.execute(run, "call-2", "fetch", params, failing, 1)
