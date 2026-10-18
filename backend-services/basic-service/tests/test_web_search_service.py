import pytest


@pytest.mark.asyncio
async def test_no_key_is_configuration_failure(monkeypatch):
    from app.services.web_research.web_search_service import WebSearchService
    from app.models.web_research_models import WebResearchError
    service = WebSearchService()
    monkeypatch.setattr(service, '_api_keys', lambda: [])
    with pytest.raises(WebResearchError) as error:
        await service.search('topic')
    assert error.value.status_code == 503
    assert error.value.failure_class == 'configuration'


@pytest.mark.asyncio
async def test_three_key_limit_and_provider_payload(monkeypatch):
    from app.services.web_research.web_search_service import WebSearchService
    from app.models.web_research_models import WebResearchError
    service, calls = WebSearchService(), []
    monkeypatch.setattr(service, '_api_keys', lambda: ['a', 'b', 'c', 'd'])
    async def post(key, payload):
        calls.append(payload)
        raise WebResearchError('provider_rejected')
    monkeypatch.setattr(service, '_tavily_post', post)
    with pytest.raises(WebResearchError):
        await service.search('topic', include_images=True)
    assert len(calls) == 3
    assert calls[0]['include_raw_content'] is False
    assert calls[0]['include_images'] is True


@pytest.mark.asyncio
@pytest.mark.parametrize('code', ['provider_quota_exceeded',
                                 'upstream_error', 'upstream_timeout'])
async def test_rejected_then_terminal_error_never_rotates(monkeypatch, code):
    from app.services.web_research.web_search_service import WebSearchService
    from app.models.web_research_models import WebResearchError
    service, calls = WebSearchService(), []
    monkeypatch.setattr(service, '_api_keys', lambda: ['a', 'a', '', 'b', 'c'])
    async def post(key, payload):
        calls.append(key)
        raise WebResearchError('provider_rejected' if key == 'a' else code)
    monkeypatch.setattr(service, '_tavily_post', post)
    with pytest.raises(WebResearchError) as error:
        await service.search('topic')
    assert error.value.error_code == code
    assert calls == ['a', 'b']


@pytest.mark.asyncio
async def test_rate_limited_waits_retry_after_then_rotates_key(monkeypatch):
    """D-12：429 读 Retry-After（≤2s）后换 key，最多三次。"""
    import asyncio
    from app.services.web_research.web_search_service import WebSearchService
    from app.models.web_research_models import WebResearchError
    service, calls, sleeps = WebSearchService(), [], []
    monkeypatch.setattr(service, '_api_keys', lambda: ['a', 'b', 'c'])
    async def post(key, payload):
        calls.append(key)
        error = WebResearchError('provider_rate_limited')
        error.retry_after = 1.5
        raise error
    async def sleep(delay):
        sleeps.append(delay)
    monkeypatch.setattr(service, '_tavily_post', post)
    monkeypatch.setattr(asyncio, 'sleep', sleep)
    with pytest.raises(WebResearchError) as error:
        await service.search('topic')
    assert error.value.error_code == 'provider_rate_limited'
    assert calls == ['a', 'b', 'c']
    assert sleeps and all(delay <= 2 for delay in sleeps)


@pytest.mark.asyncio
async def test_success_reuses_source_and_keeps_signature_private(monkeypatch):
    from app.services.web_research.web_search_service import WebSearchService
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError
    service, calls = WebSearchService(), []
    run, _ = await RunRegistry().register(None)
    monkeypatch.setattr(service, '_api_keys', lambda: ['a', 'b'])
    async def post(key, payload):
        calls.append(key)
        if key == 'a':
            raise WebResearchError('provider_rejected')
        return {'results': [{'url': 'https://example.com/page', 'title': 'Page'}],
                'images': [{'url': 'https://example.com/a?sig=secret',
                            'source_url': 'https://example.com/page'}]}
    monkeypatch.setattr(service, '_tavily_post', post)
    result = await service.search('topic', include_images=True, run=run)
    assert calls == ['a', 'b']
    assert result.images[0]['source_id'] == result.sources[0]['id']
    assert 'secret' not in result.model_dump_json()
    assert len(run.candidates) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['deadline', 'cancel', 'closed', 'invalid'])
async def test_commit_guard_leaves_no_candidates(monkeypatch, failure):
    import asyncio
    from app.services.web_research import web_search_service as module
    from app.services.web_research.run_registry import RunRegistry
    from app.models.web_research_models import WebResearchError
    service = module.WebSearchService()
    run, _ = await RunRegistry().register(None)
    monkeypatch.setattr(service, '_api_keys', lambda: ['a'])
    async def post(key, payload):
        return {'results': [{'url': 'https://example.com'}],
                'images': [None] if failure == 'invalid' else []}
    monkeypatch.setattr(service, '_tavily_post', post)
    if failure != 'invalid':
        original = module.normalize_search_payload
        def normalize(*args):
            result = original(*args)
            if failure == 'deadline':
                monkeypatch.setattr(module, '_clock', lambda: float('inf'))
            elif failure == 'closed':
                run.state = 'closed'
            else:
                asyncio.current_task().cancel()
            return result
        monkeypatch.setattr(module, 'normalize_search_payload', normalize)
    with pytest.raises((WebResearchError, asyncio.CancelledError)):
        await service.search('topic', include_images=True, run=run)
    assert not run.candidates


@pytest.mark.asyncio
async def test_credentials_share_total_timeout(monkeypatch):
    import asyncio
    from app.services.web_research import web_search_service as module
    from app.models.web_research_models import WebResearchError
    service, calls = module.WebSearchService(), []
    monkeypatch.setattr(service, '_api_keys', lambda: ['a', 'b', 'c'])
    now = [0.0]
    monkeypatch.setattr(module, '_clock', lambda: now[0])
    async def post(key, payload):
        calls.append(key)
        now[0] += 16
        raise WebResearchError('provider_rejected')
    monkeypatch.setattr(service, '_tavily_post', post)
    with pytest.raises(WebResearchError, match='upstream_timeout'):
        await service.search('topic')
    assert calls == ['a']
