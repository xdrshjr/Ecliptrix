import asyncio
import socket

import pytest


def test_preserves_query_and_rejects_private_literals():
    from app.services.web_research.safe_http_client import normalize_url
    from app.models.web_research_models import WebResearchError
    assert normalize_url('HTTPS://Example.com/A?q=Secret#x') == 'https://example.com/A?q=Secret'
    for url in ['http://127.0.0.1/', 'http://[::ffff:127.0.0.1]/',
                'http://224.0.0.1/', 'http://[ff02::1]/',
                'https://user:pass@example.com/', 'http://example.com:8080/']:
        with pytest.raises(WebResearchError):
            normalize_url(url)


def test_proxy_url_normalization_allows_loopback_and_userinfo():
    from app.services.web_research.safe_http_client import normalize_proxy_url
    from app.models.web_research_models import WebResearchError
    assert normalize_proxy_url(
        'http://127.0.0.1:7890') == 'http://127.0.0.1:7890'
    assert normalize_proxy_url(
        'http://user:sec%40ret@127.0.0.1:7890') == \
        'http://user:sec%40ret@127.0.0.1:7890'
    for url in ['ftp://127.0.0.1:21', 'http://127.0.0.1', '',
                'http://127.0.0.1:7890/?x=1']:
        with pytest.raises(WebResearchError):
            normalize_proxy_url(url)


@pytest.mark.asyncio
async def test_resolver_rejects_mixed_public_private_answers(monkeypatch):
    from app.services.web_research.safe_http_client import GuardedResolver
    from app.models.web_research_models import WebResearchError
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(WebResearchError):
        await GuardedResolver().resolve('example.com', 443)


@pytest.mark.asyncio
async def test_limiter_shrink_keeps_existing_requests_accounted():
    from app.services.web_research.safe_http_client import CapacityLimiter
    limiter = CapacityLimiter(2)
    await limiter.acquire()
    await limiter.acquire()
    await limiter.update(1)
    waiter = asyncio.create_task(limiter.acquire())
    await asyncio.sleep(0)
    await limiter.release()
    assert not waiter.done()
    await limiter.release()
    await asyncio.wait_for(waiter, 1)
    await limiter.release()


@pytest.mark.asyncio
async def test_redirect_to_private_host_never_reaches_private_server():
    from app.services.web_research.safe_http_client import (
        SafeHttpClient, FetchPolicy, RequestSpec, HttpResult)
    from app.models.web_research_models import WebResearchError
    received = []
    async def incoming(reader, writer):
        received.append(True)
        writer.close()
        await writer.wait_closed()
    server = await asyncio.start_server(incoming, '127.0.0.1', 0)
    async def fixture(policy, request):
        return HttpResult(request.url, 302, {'location': 'http://127.0.0.1/'}, b'')
    try:
        client = SafeHttpClient(transport=fixture)
        with pytest.raises(WebResearchError, match='url_forbidden'):
            await client.fetch(FetchPolicy(respect_robots=False), RequestSpec('https://public.example/'))
        assert received == []
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_redirect_robots_and_response_size_are_checked_every_hop():
    from app.services.web_research.safe_http_client import (
        SafeHttpClient, FetchPolicy, RequestSpec, HttpResult)
    from app.models.web_research_models import WebResearchError
    calls = []
    async def fixture(policy, request):
        calls.append(request.url)
        if request.url.endswith('/robots.txt'):
            body = b'User-agent: *\nDisallow: /' if 'target' in request.url else b''
            return HttpResult(request.url, 200, {}, body)
        return HttpResult(request.url, 302, {'location': 'https://target.example/page'}, b'')
    client = SafeHttpClient(transport=fixture)
    with pytest.raises(WebResearchError, match='robots_disallowed'):
        await client.fetch(FetchPolicy(), RequestSpec('https://source.example/page'))
    assert 'https://target.example/robots.txt' in calls
    assert 'https://target.example/page' not in calls
    async def huge(policy, request):
        return HttpResult(request.url, 200, {}, b'x' * 11)
    with pytest.raises(WebResearchError, match='response_too_large'):
        await SafeHttpClient(transport=huge).fetch(
            FetchPolicy(max_bytes=10, respect_robots=False), RequestSpec('https://public.example/'))


DIRECT = {'mode': 'direct', 'proxy_url': '', 'respect_robots': True,
          'concurrency': 3}


@pytest.mark.asyncio
async def test_actual_http_decompression_enforces_decoded_limit(monkeypatch):
    import gzip
    from aiohttp import web
    from app.services.web_research.safe_http_client import (
        SafeHttpClient, FetchPolicy, RequestSpec)
    from app.models.web_research_models import WebResearchError
    async def compressed(request):
        return web.Response(body=gzip.compress(b'x' * 100000),
                            headers={'Content-Encoding': 'gzip'})
    app = web.Application()
    app.router.add_get('/', compressed)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    class FixtureResolver:
        async def resolve(self, host, port=0, family=0):
            return [{'hostname': host, 'host': '127.0.0.1', 'port': fixture_port,
                     'family': socket.AF_INET, 'proto': 6, 'flags': 0}]
        async def close(self):
            pass
    fixture_port = port
    # 直连模式：即使环境里有代理变量也不走代理（Fake-IP 代理环境恢复可用
    # 靠的是 auto 模式，直连必须保留全量本地校验语义）。
    monkeypatch.setenv('HTTP_PROXY', 'http://127.0.0.1:1')
    try:
        client = SafeHttpClient(resolver=FixtureResolver(),
                                proxy_settings=DIRECT)
        with pytest.raises(WebResearchError, match='response_too_large'):
            await client.fetch(FetchPolicy(max_bytes=1024, respect_robots=False),
                               RequestSpec('http://fixture.example/'))
    finally:
        await runner.cleanup()


@pytest.mark.asyncio
async def test_proxy_mode_routes_target_through_mock_proxy():
    """代理模式（AC-10）：目标经本地 mock 代理可达，回环代理地址不被误判。"""
    from aiohttp import web
    from app.services.web_research.safe_http_client import (
        SafeHttpClient, FetchPolicy, RequestSpec)
    seen = []

    async def proxy_index(request):
        seen.append((request.method, request.path, request.host))
        return web.Response(text='via-proxy', content_type='text/plain')

    proxy_app = web.Application()
    # 代理收到的是绝对 URI 请求行，路径不固定，必须用 catch-all。
    proxy_app.router.add_route('*', '/{tail:.*}', proxy_index)
    runner = web.AppRunner(proxy_app, handler_args={'reuse_address': True})
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        client = SafeHttpClient(proxy_settings={
            'mode': 'custom', 'proxy_url': f'http://127.0.0.1:{port}',
            'respect_robots': False, 'concurrency': 3})
        result = await client.fetch(
            FetchPolicy(respect_robots=False),
            RequestSpec('http://fixture.example/path?q=1'))
        assert result.status == 200
        # aiohttp 以绝对 URI 请求行发往代理；服务端解析出 host=目标主机、
        # 路径=目标路径——证明目标经代理转发而非本地直连。
        assert seen and seen[0][0] == 'GET'
        assert seen[0][1].startswith('/path')
        assert seen[0][2] == 'fixture.example'
    finally:
        await runner.cleanup()


@pytest.mark.asyncio
async def test_proxy_mode_rejects_private_literal_targets_without_proxy_hit():
    """代理模式只放宽 DNS 校验；字面私网/metadata 目标仍然拒绝（§3.4）。"""
    from app.services.web_research.safe_http_client import (
        SafeHttpClient, FetchPolicy, RequestSpec)
    from app.models.web_research_models import WebResearchError
    async def unreachable(policy, request):
        raise AssertionError('request must not leave the client')
    client = SafeHttpClient(
        transport=unreachable,
        proxy_settings={'mode': 'custom', 'proxy_url': 'http://127.0.0.1:9',
                        'respect_robots': False, 'concurrency': 3})
    for url in ('http://192.168.1.5/', 'http://169.254.169.254/latest/meta-data',
                'http://[fd00::1]/'):
        with pytest.raises(WebResearchError, match='url_forbidden'):
            await client.fetch(FetchPolicy(respect_robots=False),
                               RequestSpec(url))


@pytest.mark.asyncio
async def test_proxy_mode_fake_ip_resolution_delegates_to_proxy():
    """Fake-IP 环境（AC-10）：目标解析结果为 198.18.x 也不能挡住代理模式。"""
    from aiohttp import web
    from app.services.web_research.safe_http_client import (
        SafeHttpClient, FetchPolicy, RequestSpec)

    async def proxy_index(request):
        return web.Response(text='fake-ip-ok', content_type='text/plain')

    proxy_app = web.Application()
    proxy_app.router.add_get('/', proxy_index)
    runner = web.AppRunner(proxy_app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]

    class FakeIpResolver:
        """直连模式下这是致命的；代理模式必须根本不用它。"""
        async def resolve(self, host, port=0, family=0):
            raise AssertionError('proxy mode must not resolve target locally')

        async def close(self):
            pass

    try:
        client = SafeHttpClient(
            resolver=FakeIpResolver(),
            proxy_settings={'mode': 'custom',
                            'proxy_url': f'http://127.0.0.1:{port}',
                            'respect_robots': False, 'concurrency': 3})
        result = await client.fetch(
            FetchPolicy(respect_robots=False),
            RequestSpec('http://example.com/'))
        assert result.status == 200
        assert result.body == b'fake-ip-ok'
    finally:
        await runner.cleanup()


def test_auto_mode_priority_custom_settings_then_env_then_system(monkeypatch):
    from app.services.web_research import safe_http_client as mod

    monkeypatch.setattr(
        mod, 'default_proxy_settings', mod.default_proxy_settings, raising=False)
    import app.services.system_settings_service as settings_service

    monkeypatch.setattr(settings_service, 'research_settings',
                        lambda: {'proxy_mode': 'auto',
                                 'custom_proxy_url': 'http://10.10.10.10:7890'})
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:2')
    monkeypatch.setenv('WEB_RESEARCH_SYSTEM_PROXY', 'http://127.0.0.1:3')
    resolved = mod.default_proxy_settings()
    assert resolved['proxy_url'] == 'http://10.10.10.10:7890'

    monkeypatch.setattr(settings_service, 'research_settings',
                        lambda: {'proxy_mode': 'auto', 'custom_proxy_url': ''})
    resolved = mod.default_proxy_settings()
    assert resolved['proxy_url'] == 'http://127.0.0.1:2'

    monkeypatch.delenv('HTTPS_PROXY', raising=False)
    monkeypatch.delenv('HTTP_PROXY', raising=False)
    monkeypatch.delenv('ALL_PROXY', raising=False)
    monkeypatch.delenv('https_proxy', raising=False)
    monkeypatch.delenv('http_proxy', raising=False)
    monkeypatch.delenv('all_proxy', raising=False)
    resolved = mod.default_proxy_settings()
    assert resolved['proxy_url'] == 'http://127.0.0.1:3'

    monkeypatch.delenv('WEB_RESEARCH_SYSTEM_PROXY', raising=False)
    resolved = mod.default_proxy_settings()
    assert resolved['proxy_url'] == '' and resolved['mode'] == 'auto'

    monkeypatch.setattr(settings_service, 'research_settings',
                        lambda: {'proxy_mode': 'direct'})
    resolved = mod.default_proxy_settings()
    assert resolved['proxy_url'] == ''


@pytest.mark.asyncio
async def test_robots_unavailable_is_fail_closed_and_cached():
    from app.services.web_research.safe_http_client import (
        SafeHttpClient, FetchPolicy, RequestSpec, HttpResult)
    from app.models.web_research_models import WebResearchError
    calls = []

    async def flaky(policy, request):
        calls.append(request.url)
        if request.url.endswith('/robots.txt'):
            raise WebResearchError('upstream_timeout')
        return HttpResult(request.url, 200, {}, b'page')

    client = SafeHttpClient(
        transport=flaky,
        proxy_settings={'mode': 'direct', 'proxy_url': '',
                        'respect_robots': True, 'concurrency': 3})
    with pytest.raises(WebResearchError, match='robots_unavailable'):
        await client.fetch(FetchPolicy(), RequestSpec('https://site.example/a'))
    before = len(calls)
    # 缓存有效期内同 origin 同样拒绝，且不再发起新的 robots 请求。
    with pytest.raises(WebResearchError, match='robots_unavailable'):
        await client.fetch(FetchPolicy(), RequestSpec('https://site.example/b'))
    assert len(calls) == before

def test_invalid_env_proxy_degrades_to_direct_in_auto_mode(monkeypatch):
    """C-1 回归：非法 env 代理不得让整站 403，auto 降级直连并留痕。"""
    from app.services.web_research import safe_http_client as mod
    import app.services.system_settings_service as settings_service

    monkeypatch.setattr(settings_service, "research_settings",
                        lambda: {"proxy_mode": "auto", "custom_proxy_url": ""})
    monkeypatch.setattr(settings_service, "agent_host_settings",
                        lambda: {"egress_mode": "balanced"})
    for key in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy",
                "WEB_RESEARCH_SYSTEM_PROXY"):
        monkeypatch.delenv(key, raising=False)
    # 缺端口 = 真错（带路径不会复现 C-1，REV-P1-5）。
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1")
    resolved = mod.default_proxy_settings()
    assert resolved["proxy_url"] == ""
    assert resolved["resolved_from"] == "direct"
    assert resolved["invalid_source"] == "env"
    assert resolved["proxy_error"] == ""


@pytest.mark.asyncio
async def test_invalid_custom_proxy_is_a_precise_non_sticky_403():
    """C-1 的另一半：custom 模式必须报精确码，且 sticky=false。"""
    from app.services.web_research.safe_http_client import (
        SafeHttpClient, FetchPolicy, RequestSpec)
    from app.models.web_research_models import WebResearchError

    async def unreachable(policy, request):
        raise AssertionError("request must not leave the client")

    # 刻意**不**注入 transport：非法 custom 代理必须在 `_request()` 里、
    # 任何 socket 建立之前就抛出，这才证明"配置错误不再变成全站 403"。
    del unreachable
    client = SafeHttpClient(proxy_settings={
        "mode": "custom", "proxy_url": "", "proxy_error": "proxy_config_invalid",
        "respect_robots": False, "concurrency": 3})
    with pytest.raises(WebResearchError) as caught:
        await client.fetch(FetchPolicy(respect_robots=False),
                           RequestSpec("https://example.com/"))
    assert caught.value.error_code == "proxy_config_invalid"
    assert caught.value.status_code == 403
    assert caught.value.reason == "proxy_config_invalid"
    assert caught.value.sticky_failure() is False


@pytest.mark.asyncio
async def test_balanced_pins_the_first_answer_and_reuses_it(monkeypatch):
    """AC-G02：balanced 放行 Fake-IP 答复，且第二次命中 resolver 缓存。"""
    from app.services.web_research.safe_http_client import GuardedResolver
    from app.services.web_research.egress_policy import EgressPolicy

    calls = []

    def fake_getaddrinfo(host, port, family, socktype):
        calls.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "",
                 ("198.18.0.7", port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    resolver = GuardedResolver(EgressPolicy(mode="balanced"))
    first = await resolver.resolve("upload.example", 443)
    second = await resolver.resolve("upload.example", 443)
    assert len(calls) == 1
    assert first[0]["host"] == second[0]["host"] == "198.18.0.7"


@pytest.mark.asyncio
async def test_strict_and_balanced_disagree_on_the_same_answer(monkeypatch):
    """AC-G02 的另一半：同一答复 strict 拒绝、balanced 放行。"""
    from app.services.web_research.safe_http_client import GuardedResolver
    from app.services.web_research.egress_policy import EgressPolicy
    from app.models.web_research_models import WebResearchError

    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.7", 443))])
    strict = GuardedResolver(EgressPolicy(mode="strict"))
    with pytest.raises(WebResearchError) as caught:
        await strict.resolve("upload.example", 443)
    assert caught.value.error_code == "dns_answer_non_global"
    assert caught.value.sticky_failure() is False
    balanced = GuardedResolver(EgressPolicy(mode="balanced"))
    assert (await balanced.resolve("upload.example", 443))[0]["host"] == \
        "198.18.0.7"
