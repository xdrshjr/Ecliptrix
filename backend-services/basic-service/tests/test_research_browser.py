import pytest


@pytest.mark.asyncio
async def test_real_chromium_dynamic_page_actions_and_screenshot():
    from app.services.web_research.smoke import run_smoke
    result = await run_smoke()
    assert result['dynamic_text'] and result['screenshot']
    assert result['stale_rejected'] and result['network_guard']
    assert result['search'] and result['scroll'] and result['closed']
    # AC-39：同源子资源经路由放行，动态页因此可见/可截图。
    assert result['subresources'] >= 2


@pytest.mark.asyncio
async def test_native_redirect_keeps_final_origin_or_fails_closed():
    from app.services.web_research.smoke import verify_redirects
    result = await verify_redirects()
    # 具体分支断言：实现必须失败关闭，绝不以原 origin 承载新正文（AC-22）。
    assert result['branch'] == 'redirect_unsupported'
    assert result['private_requests'] == 0
    assert result['robots_checked']


@pytest.mark.asyncio
async def test_session_ownership_expiry_and_total_budget():
    from app.services.web_research.smoke import verify_lifecycle
    result = await verify_lifecycle()
    assert all(result.values())


@pytest.mark.asyncio
async def test_background_polling_and_all_browser_network_channels_fail_closed():
    from app.services.web_research.smoke import verify_network_isolation
    result = await verify_network_isolation()
    assert result['private_requests'] == 0
    assert result['post_requests'] == 0
    # AC-39 两侧断言：路由拒绝可观测，且没有任何请求绕过路由直连。
    assert result['blocked_methods'] >= 1
    assert result['background_stopped']
    assert result['proxy_denied'] and result['websocket_denied']


@pytest.mark.asyncio
async def test_actions_serialize_and_dom_mutation_invalidates_refs():
    from app.services.web_research.smoke import verify_actions
    result = await verify_actions()
    assert result['mutation_stale'] and result['serialized']
    assert result['unsafe_actions_blocked'] and result['cancelled_waiter']


@pytest.mark.asyncio
async def test_screenshot_quota_failure_preserves_text_and_references():
    from app.models.web_research_models import WebResearchError
    from app.services.web_research.smoke import fixture
    async with fixture() as (service, run, _, artifacts, _):
        opened = await service.open(run, 'https://fixture.example/')
        original = artifacts.write
        async def limited(kind, body, context, retention_days=7):
            if kind == 'screenshot':
                raise WebResearchError('artifact_quota_exceeded')
            return await original(kind, body, context, retention_days)
        artifacts.write = limited
        result = await service.read(run, opened['session_id'], screenshot=True)
        assert result['text'] and result['snapshot_artifact_id']
        assert result['elements']
        assert result['screenshot_error'] == 'artifact_quota_exceeded'


@pytest.mark.asyncio
async def test_cancel_during_navigation_closes_pending_network_and_context():
    import asyncio
    from app.services.web_research.smoke import fixture
    async with fixture() as (service, run, transport, _, _):
        pending = asyncio.create_task(service.open(run, 'https://fixture.example/slow'))
        await asyncio.wait_for(transport.slow_started.wait(), 10)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(pending, 2)
        assert not service.sessions
        assert run.session_id is None


@pytest.mark.asyncio
async def test_capability_handshake_does_not_leave_an_idle_browser():
    from app.services.web_research.smoke import fixture
    async with fixture() as (service, _, _, _, _):
        assert (await service.availability())['available']
        assert service.browser is None
        assert service.driver is None
        assert (await service.availability())['available']


@pytest.mark.asyncio
async def test_large_real_screenshot_is_reduced_without_losing_text():
    from app.services.web_research.smoke import fixture
    async with fixture() as (service, run, _, artifacts, _):
        opened = await service.open(run, 'https://fixture.example/')
        page = service.sessions[opened['session_id']].page
        await page.evaluate('''() => {
          const canvas=document.createElement('canvas');
          canvas.width=1280;canvas.height=720;
          canvas.style='position:fixed;inset:0;width:1280px;height:720px';
          document.body.append(canvas);
          const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(1280,720);
          let seed=12345;
          for(let i=0;i<pixels.data.length;i++) {
            seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
            pixels.data[i]=i%4===3?255:seed&255;
          }
          ctx.putImageData(pixels,0,0);
        }''')
        result = await service.read(run, opened['session_id'], screenshot=True)
        image = artifacts.rows[result['screenshot_artifact_id']].body
        assert len(image) <= 2 * 1024 * 1024
        assert result['text'] and result['snapshot_artifact_id']


@pytest.mark.asyncio
async def test_cancel_during_driver_handshake_reaps_spawned_driver(monkeypatch):
    import asyncio
    import playwright.async_api as api
    from app.services.web_research.browser_service import BrowserService
    manager = api.async_playwright()
    start = manager.start
    ready = asyncio.Event()
    async def delayed_start():
        driver = await start()
        ready.set()
        await asyncio.sleep(30)
        return driver
    manager.start = delayed_start
    monkeypatch.setattr(api, 'async_playwright', lambda: manager)
    # CDP 架构：端点必须有效才会进入 playwright 启动分支。
    service = BrowserService(
        endpoints=('http://127.0.0.1:9', 'http://127.0.0.1:9'))
    task = asyncio.create_task(service._start())
    try:
        await asyncio.wait_for(ready.wait(), 10)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        process = manager._connection._transport._proc
        await asyncio.sleep(.05)
        assert process.returncode is not None
    finally:
        await manager.__aexit__()
        await service.shutdown()
