import pytest


@pytest.mark.asyncio
async def test_research_http_degradation_keeps_quality_and_run_idempotency(monkeypatch):
    import httpx
    from types import SimpleNamespace
    from fastapi import FastAPI
    from app.models.web_research_models import WebSearchData, WebResearchError
    from app.services.web_research.provenance import source_record, add_candidate
    from app.services.web_research.run_registry import RunRegistry
    from app.services.web_research.web_research_service import WebResearchService
    from app.services.model_settings_service import model_settings_service
    import app.services.web_research.web_research_service as service_module
    from app.routers import web_research_router, research_run_router
    registry = RunRegistry()
    config = {'enabled': True, 'use_research_model': True,
              'research_context_window_tokens': 16384, 'artifact_retention_days': 7}
    run, token = await registry.register(None, config=config)
    calls, writes = [], []
    class Search:
        async def search(self, topic, maximum, run=None):
            source = source_record('https://source.example/', '来源')
            add_candidate(run, source['url'], source)
            return WebSearchData(results=[{'source_id': source['id'],
                'url': source['url'], 'snippet': '可用摘要'}], sources=[source])
    class Fetch:
        async def page(self, url):
            return {'title': '正文', 'text': '可引用原文', 'final_url': url}
    class Store:
        async def write(self, *args):
            writes.append(args)
            return SimpleNamespace(id='00000000-0000-4000-8000-000000000001')
    async def resolve():
        return SimpleNamespace(model_name='configured-model')
    async def model(*args):
        calls.append(True)
        raise WebResearchError('research_model_rejected')
    service = WebResearchService(Search(), Fetch(), model)
    monkeypatch.setattr(research_run_router, 'run_registry', registry)
    monkeypatch.setattr(research_run_router, 'research_settings', lambda: config)
    monkeypatch.setattr(web_research_router, 'get_web_research_service', lambda: service)
    monkeypatch.setattr(service_module, 'get_artifact_store', Store)
    monkeypatch.setattr(model_settings_service, 'resolve_research_config', resolve)
    app = FastAPI()
    app.include_router(web_research_router.router, prefix='/api')
    @app.exception_handler(WebResearchError)
    async def error_handler(request, error):
        return research_run_router.error_response(error)
    headers = {'x-research-run': run.run_id, 'x-research-token': token,
               'x-tool-call-id': 'same-research-call'}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                base_url='http://test') as client:
        first = await client.post('/api/web-research/research',
                                  headers=headers, json={'topic': '主题'})
        repeated = await client.post('/api/web-research/research',
                                     headers=headers, json={'topic': '主题'})
    assert first.status_code == repeated.status_code == 200
    assert first.json()['success'] is True
    report = first.json()['data']
    assert report == repeated.json()['data']
    assert report['quality'] == 'full_text'
    assert report['degraded'] == 'research_model_unavailable'
    assert report['model_usage']['query']['attempts'] == 1
    assert report['model_usage']['synthesis']['reason'] == 'prior_stage_failed'
    assert report['model_used'] is None
    assert 'evidence' not in report and 'operations' not in report
    assert len(calls) == len(writes) == 1


@pytest.mark.asyncio
async def test_connection_sync_work_cannot_outlive_outer_budget(monkeypatch):
    import asyncio
    import time
    from starlette.requests import Request
    from app.routers import web_research_router as module
    class Service:
        def _api_keys(self):
            return ['configured']
        async def search(self, *args, **kwargs):
            time.sleep(0.025)
    monkeypatch.setattr(module, 'get_web_search_service', Service)
    monkeypatch.setattr(module, 'CONNECTION_TIMEOUT', 0.005, raising=False)
    monkeypatch.setattr(module, '_last_test', 0)
    monkeypatch.setattr(module, '_test_lock', asyncio.Lock())
    monkeypatch.setenv('RESEARCH_RENDERER_ORIGIN', 'http://127.0.0.1:3000')
    request = Request({'type': 'http', 'headers': [
        (b'origin', b'http://127.0.0.1:3000'), (b'content-type', b'application/json')]})
    response = await module.test_connection(request)
    assert response.data['reachable'] is False
    assert response.data['error_code'] == 'upstream_timeout'


@pytest.mark.asyncio
@pytest.mark.parametrize('code,status,category', [
    ('provider_rate_limited', 429, 'transient'),
    ('provider_quota_exceeded', 503, 'configuration'),
    ('provider_rejected', 503, 'configuration'),
    ('provider_response_invalid', 502, 'internal'),
    ('provider_response_too_large', 502, 'internal'),
    ('upstream_timeout', 504, 'transient'),
])
async def test_connection_and_tool_error_envelope(monkeypatch, code, status, category):
    import asyncio
    import httpx
    from fastapi import FastAPI
    from app.models.web_research_models import WebResearchError
    from app.routers import web_research_router as module
    from app.routers.research_run_router import error_response
    class Service:
        def _api_keys(self):
            return ['fake-secret']
        async def search(self, *args, **kwargs):
            raise WebResearchError(code)
    monkeypatch.setattr(module, 'get_web_search_service', Service)
    monkeypatch.setattr(module, '_last_test', 0)
    monkeypatch.setattr(module, '_test_lock', asyncio.Lock())
    monkeypatch.setenv('RESEARCH_RENDERER_ORIGIN', 'http://127.0.0.1:3000')
    app = FastAPI()
    app.include_router(module.router, prefix='/api')
    @app.exception_handler(WebResearchError)
    async def handler(request, error):
        return error_response(error)
    async def execute(request, action, params, function, timeout):
        return await function(None)
    monkeypatch.setattr(module, 'tool_action', execute)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                base_url='http://test') as client:
        denied = await client.post('/api/web-research/test-connection', json={})
        assert denied.status_code == 403
        tested = await client.post('/api/web-research/test-connection', json={},
            headers={'origin': 'http://127.0.0.1:3000'})
        assert tested.status_code == 200
        assert tested.json()['data'] == {
            'configured': True, 'reachable': False, 'error_code': code}
        busy = await client.post('/api/web-research/test-connection', json={},
            headers={'origin': 'http://127.0.0.1:3000'})
        assert busy.status_code == 429
        assert busy.json()['error_code'] == 'research_busy'
        failed = await client.post('/api/web-research/search', json={'query': 'x'})
        assert failed.status_code == status
        assert failed.json()['error_code'] == code
        assert failed.json()['error_details']['failure_class'] == category
        assert 'fake-secret' not in failed.text + tested.text


def test_every_registered_code_has_an_explicit_failure_class():
    """AC-40：正文错误码逐码登记，507 与存储失败不得是 transient。"""
    from app.models.web_research_models import (
        FAILURE_CLASS_BY_CODE, STATUS, WebResearchError, failure_class_for)
    assert sorted(set(STATUS) - set(FAILURE_CLASS_BY_CODE)) == []
    for code, status in STATUS.items():
        error = WebResearchError(code)
        assert (error.status_code, error.failure_class) == (
            status, FAILURE_CLASS_BY_CODE[code])
    for code in ('artifact_quota_exceeded', 'cache_commit_failed'):
        assert STATUS[code] == 507
        assert failure_class_for(code, STATUS[code]) != 'transient'
    # blocked_repeat 只在 configuration / policy 上生效（run_registry）。
    for code in ('provider_not_configured', 'url_forbidden',
                 'browser_disabled', 'artifact_quota_exceeded'):
        assert WebResearchError(code).failure_class in {'configuration', 'policy'}
    for code in ('provider_rate_limited', 'upstream_timeout'):
        assert WebResearchError(code).failure_class == 'transient'


@pytest.mark.asyncio
async def test_capabilities_reports_resolved_egress_and_four_segments(monkeypatch):
    """AC-33 / §13：出口可自证，四段可用性与用户开关分开。"""
    import httpx
    from fastapi import FastAPI
    from app.routers import research_browser_router as module
    import app.services.web_research.safe_http_client as http_module
    from app.services.system_settings_service import research_settings
    config = dict(research_settings())
    config.update(enabled=True, browser_enabled=True, downloads_enabled=True,
                  use_research_model=False)
    monkeypatch.setattr(module, 'research_settings', lambda: config)
    monkeypatch.setattr(module, 'browser_service', lambda: FakeBrowser())
    monkeypatch.setattr(http_module, 'default_proxy_settings', lambda: {
        'mode': 'auto', 'proxy_url': 'http://user:secret@10.0.0.9:8080',
        'resolved_from': 'system', 'respect_robots': True, 'concurrency': 3})
    app = FastAPI()
    app.include_router(module.router, prefix='/api')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                base_url='http://test') as client:
        response = await client.get('/api/web-research/capabilities')
    assert response.status_code == 200
    data = response.json()['data']
    assert data['proxy'] == {'mode': 'auto', 'resolved_from': 'system',
                             'target': 'http://10.0.0.9:8080'}
    assert 'secret' not in response.text and 'user' not in data['proxy']['target']
    assert data['browser'] == {'available': False, 'enabled': True,
                               'error_code': 'browser_unavailable'}
    assert data['search']['configured'] in {True, False}
    assert set(data) >= {'search', 'browser', 'downloads', 'research_model',
                         'proxy', 'limits'}


def test_capabilities_limits_never_expose_proxy_credentials(monkeypatch):
    """AC-33：limits 与 proxy 两处都不得回显 userinfo（D-01 的另一半）。"""
    from app.routers.research_browser_router import _public_limits
    limits = _public_limits({'custom_proxy_url': 'http://user:pw@proxy.local:7890',
                             'tavily_api_keys': ['secret-key'], 'enabled': True})
    assert limits['custom_proxy_url'] == 'http://proxy.local:7890'
    assert 'tavily_api_keys' not in limits
    assert 'pw' not in str(limits)


@pytest.mark.asyncio
async def test_settings_error_envelope_stays_out_of_research_paths(monkeypatch):
    """§4.1：设置中心的 404/500 不得被改写成 invalid_parameters。"""
    import httpx
    from app.main import app
    app.dependency_overrides.clear()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                base_url='http://test') as client:
        unknown = await client.get('/api/system-settings/not_a_category')
        missing = await client.get('/api/web-research/does-not-exist')
    assert unknown.status_code == 404
    assert unknown.json()['error_code'] == 'HTTP_404'
    assert unknown.json()['message'] not in {'invalid_parameters', 'Unknown category'}
    assert missing.status_code in {404, 405}
    assert missing.headers['cache-control'] == 'no-store'


@pytest.mark.asyncio
async def test_run_past_deadline_reports_run_closed(monkeypatch):
    """超期 run 报 410 run_closed，而不是负超时导致的 upstream_timeout。"""
    import time
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError
    registry = RunRegistry()
    run, _token = await registry.register(None, config={'enabled': True})
    run.deadline = time.monotonic() - 1

    async def work():
        return 'never'

    with pytest.raises(WebResearchError) as error:
        await registry.execute(run, 'call-1', 'search', {}, work, 30)
    assert (error.value.error_code, error.value.status_code) == ('run_closed', 410)


class FakeBrowser:
    async def availability(self):
        return {'available': False, 'error_code': 'browser_unavailable'}


def test_proxy_egress_without_userinfo(monkeypatch):
    """AC-33：出口目标去掉认证信息，来源可为 settings/env/system/direct。"""
    import app.services.web_research.safe_http_client as http_module
    assert http_module.public_proxy_target(
        'http://user:pass@proxy.local:3128') == 'http://proxy.local:3128'
    assert http_module.public_proxy_target('') == ''
    monkeypatch.setattr(http_module, '_resolve_proxy',
                        lambda mode, settings: ('http://127.0.0.1:7890', 'env'))
    summary = http_module.resolved_proxy_summary()
    assert summary == {'mode': summary['mode'], 'resolved_from': 'env',
                       'target': 'http://127.0.0.1:7890'}


def test_custom_proxy_url_is_validated_when_saved():
    """D-17：保存期即校验 http(s)://host:port，空值表示无自定义代理。"""
    from app.models.system_settings_models import validate_setting_payload
    for bad in ('ftp://host:1', 'http://host', 'http://host:port',
                'socks5://127.0.0.1:1080', 'http://host:7890/path'):
        with pytest.raises(ValueError):
            validate_setting_payload('web_research', 'custom_proxy_url', bad)
    for good in ('', 'http://127.0.0.1:7890',
                 'http://user:pass@proxy.local:8080', 'https://[::1]:8443'):
        validate_setting_payload('web_research', 'custom_proxy_url', good)


def test_settings_strict_scalars_and_unknown_keys():
    from app.models.system_settings_models import validate_setting_payload
    for key, value in [('enabled', 'false'), ('context_window_tokens', True), ('global_concurrency', 4), ('unknown', 3)]:
        with pytest.raises(ValueError):
            validate_setting_payload('web_research', key, value)
    validate_setting_payload('web_research', 'enabled', False)


def test_download_union_and_search_extra_rejected():
    from app.models.web_research_models import WebDownloadRequest, WebSearchRequest
    with pytest.raises(ValueError):
        WebDownloadRequest(kind='image', url='https://example.com', candidate_id='x')
    with pytest.raises(ValueError):
        WebSearchRequest(query='x', secret='oops')


@pytest.mark.asyncio
async def test_settings_credentials_all_routes_redact_and_require_origin(tmp_path, monkeypatch):
    import httpx
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.db_models import SystemSetting, SettingsAuditLog
    from app.models.web_research_models import WebResearchError
    from app.routers import web_research_router, system_settings_router
    from app.routers.research_run_router import error_response
    import app.services.system_settings_service as module
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'settings.db'))
    async with engine.begin() as connection:
        await connection.run_sync(SystemSetting.__table__.create)
        await connection.run_sync(SettingsAuditLog.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    service = module.SystemSettingsService()
    monkeypatch.setattr(module, 'async_session_factory', factory)
    monkeypatch.setattr(module, 'system_settings_service', service)
    monkeypatch.setattr(web_research_router, 'system_settings_service', service)
    monkeypatch.setattr(system_settings_router, 'system_settings_service', service)
    import app.services.web_research.web_search_service as search_module
    monkeypatch.setattr(search_module, 'system_settings_service', service)
    monkeypatch.setenv('RESEARCH_RENDERER_ORIGIN', 'http://127.0.0.1:3000')
    await service.ensure_defaults_seeded()
    await service.load_all()
    app = FastAPI()
    app.include_router(web_research_router.router, prefix='/api')
    app.include_router(system_settings_router.router, prefix='/api')
    @app.exception_handler(WebResearchError)
    async def research_error(request, error):
        return error_response(error)
    headers = {'origin': 'http://127.0.0.1:3000'}
    secret = 'fake-never-echo-tavily-secret'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        missing = await client.put('/api/web-research/credentials', json={'tavily_api_keys': [secret]})
        assert missing.status_code == 403
        saved = await client.put('/api/web-research/credentials', headers=headers, json={'tavily_api_keys': [secret]})
        assert saved.status_code == 200 and secret not in saved.text
        read = await client.get('/api/system-settings/web_research')
        assert secret not in read.text
        credential = next(item for item in read.json()['settings'] if item['key'] == 'tavily_api_keys')
        assert credential['value'] == {'configured': True, 'key_count': 1}
        refused = await client.put('/api/system-settings/web_research/tavily_api_keys', headers=headers, json={'value': [secret]})
        assert refused.status_code == 400 and secret not in refused.text
        for path in ['/api/system-settings/web_research/reset', '/api/system-settings/reset-all']:
            denied = await client.post(path, json={})
            assert denied.status_code == 403
        reset = await client.post('/api/system-settings/web_research/reset', headers=headers, json={})
        assert reset.status_code == 200 and secret not in reset.text
        assert service.get('web_research', 'tavily_api_keys') is None
        cleared = await client.put('/api/web-research/credentials', headers=headers, json={'tavily_api_keys': []})
        assert cleared.status_code == 200
        assert search_module.WebSearchService()._api_keys() == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_credentials_failure_does_not_log_token_or_database_secret(monkeypatch, caplog):
    import httpx
    from app.main import app
    from app.routers.web_research_router import system_settings_service
    secret = 'credential-database-failure-secret'
    token = 'run-token-must-never-be-logged'
    async def fail(*args, **kwargs):
        raise RuntimeError(secret)
    monkeypatch.setattr(system_settings_service, 'update_setting', fail)
    monkeypatch.setenv('RESEARCH_RENDERER_ORIGIN', 'http://127.0.0.1:3000')
    with caplog.at_level('DEBUG'):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            result = await client.put('/api/web-research/credentials',
                headers={'origin': 'http://127.0.0.1:3000', 'X-Research-Token': token},
                json={'tavily_api_keys': [secret]})
    assert result.status_code == 500
    assert secret not in result.text and secret not in caplog.text
    assert token not in caplog.text
