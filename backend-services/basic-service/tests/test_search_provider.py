"""供应商边界：真实 HTTPX 流、有限解析及无秘密错误。"""
import asyncio
import json
import httpx
import pytest

from app.models.web_research_models import WebResearchError


class Stream(httpx.AsyncByteStream):
    def __init__(self, chunks):
        self.chunks, self.reads, self.closed = chunks, 0, 0

    async def __aiter__(self):
        for chunk in self.chunks:
            self.reads += 1
            if isinstance(chunk, BaseException):
                raise chunk
            yield chunk

    async def aclose(self):
        self.closed += 1


def provider(monkeypatch, stream, status=200, headers=None):
    from app.services.web_research import search_provider as module
    client = httpx.AsyncClient

    def respond(request):
        assert request.headers['accept-encoding'] == 'identity'
        assert str(request.url) == 'https://api.tavily.com/search'
        return httpx.Response(status, headers=headers, stream=stream)

    monkeypatch.setattr(module.httpx, 'AsyncClient', lambda **kw:
                        client(transport=httpx.MockTransport(respond), **kw))
    return module


@pytest.mark.asyncio
@pytest.mark.parametrize('extra', [0, 1])
async def test_raw_size_boundary(monkeypatch, extra):
    body = b'{"results":[]}'
    body += b' ' * (1048576 - len(body) + extra)
    stream = Stream([body[i:i+4096] for i in range(0, len(body), 4096)])
    module = provider(monkeypatch, stream)
    if extra:
        with pytest.raises(WebResearchError, match='provider_response_too_large'):
            await module.fetch_search_response('secret', {})
    else:
        assert await module.fetch_search_response('secret', {}) == {'results': []}
    assert stream.closed == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('encoding', ['gzip', 'deflate', 'br', 'zstd', 'identity,gzip'])
async def test_compression_rejected_before_read(monkeypatch, encoding):
    stream = Stream([b'never read compressed secret'])
    module = provider(monkeypatch, stream, headers={'Content-Encoding': encoding})
    with pytest.raises(WebResearchError, match='provider_response_invalid'):
        await module.fetch_search_response('secret', {})
    assert stream.reads == 0
    assert stream.closed == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('status,code,category', [
    (401, 'provider_rejected', 'configuration'),
    (403, 'provider_rejected', 'configuration'),
    (429, 'provider_rate_limited', 'transient'),
    (432, 'provider_quota_exceeded', 'configuration'),
    (433, 'provider_quota_exceeded', 'configuration'),
    (422, 'provider_request_invalid', 'internal'),
    (400, 'provider_request_invalid', 'internal'),
    (302, 'upstream_error', 'transient'),
    (500, 'upstream_error', 'transient'),
])
async def test_status_never_reads_error_body(monkeypatch, status, code, category):
    stream = Stream([b'secret provider response'])
    module = provider(monkeypatch, stream, status)
    with pytest.raises(WebResearchError) as caught:
        await module.fetch_search_response('secret', {})
    assert caught.value.error_code == code
    assert caught.value.failure_class == category
    assert 'secret' not in str(caught.value)
    assert stream.reads == 0 and stream.closed == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('body', [b'null', b'[]', b'"text"', b'\xff',
    b'{"results":[],"x":NaN}', b'{"results":[],"x":Infinity}',
    b'{"x":' + b'9'*5000 + b'}', b'['*1100 + b']'*1100])
async def test_bad_json_is_classified_and_closed(monkeypatch, body):
    stream = Stream([body])
    module = provider(monkeypatch, stream)
    with pytest.raises(WebResearchError, match='provider_response_invalid'):
        await module.fetch_search_response('secret', {})
    assert stream.closed == 1


@pytest.mark.asyncio
async def test_cancel_propagates_and_closes(monkeypatch):
    stream = Stream([asyncio.CancelledError()])
    module = provider(monkeypatch, stream)
    with pytest.raises(asyncio.CancelledError):
        await module.fetch_search_response('secret', {})
    assert stream.closed == 1


def normalize(payload, **options):
    from app.services.web_research.search_provider import normalize_search_payload
    return normalize_search_payload(payload, {'max_results': 5,
                                             'include_images': True, **options})


@pytest.mark.parametrize('payload', [None, [], '', {}, {'results': None},
    {'results': {}}, {'results': [None, 2, 'bad']},
    {'results': [], 'images': {}},
    {'results': [{'url': 'https://example.com', 'title': {}}]},
    {'results': [], 'images': [{'url': 'https://example.com', 'description': []}]},
    {'results': [{'url': 'https://example.com'}], 'images': [None]},
    {'results': [None], 'images': ['https://example.com/a.png']}])
def test_bad_collections_fail_atomically(payload):
    with pytest.raises(WebResearchError, match='provider_response_invalid'):
        normalize(payload)


@pytest.mark.parametrize('url', ['http://[bad', 'http://x:bad',
    'http://x:99999', 'https://u:p@x/', 'https://', 'file:///a',
    ' https://x', 'https://x ', 'https://x/\n', 'https://x/\\a',
    'https://x/\ud800', 'https://x/\x7f', 'https://x/a b'])
def test_invalid_url_never_reaches_source_creation(url):
    with pytest.raises(WebResearchError, match='provider_response_invalid'):
        normalize({'results': [{'url': url}]})


@pytest.mark.parametrize('url', ['https://[::1]garbage/', 'https://a|b/',
                                'https://x/\u0080', 'https://-bad.example/'])
def test_malformed_host_and_unicode_control(url):
    with pytest.raises(WebResearchError, match='provider_response_invalid'):
        normalize({'results': [{'url': url}]})


def test_window_dedup_and_utf8_limits():
    valid = {'url': 'https://example.com/?sig=a', 'title': '蜜蜂😀'*400,
             'content': '蝴蝶'*300}
    payload = {'results': [None, valid, valid,
        {**valid, 'url': 'https://example.com/?sig=b'}] + [valid]*40,
        'images': ['https://example.com/a.png']*40}
    result = normalize(payload)
    assert len(result.results) == 2
    assert len(result.results[0]['title'].encode()) <= 512
    assert len(result.results[0]['content'].encode()) <= 400
    assert result.discarded_results == 42
    assert result.discarded_images == 39


def test_valid_surrogate_pair_and_invalid_member():
    result = normalize({'results': [
        {'url': 'https://example.com/a', 'title': '\ud83d\ude00'},
        {'url': 'https://example.com/b', 'title': '\ud800'}]})
    assert result.results[0]['title'] == '😀'
    assert result.discarded_results == 1


def test_empty_disabled_images_and_invalid_source_fallback():
    assert normalize({'results': [], 'images': {}}, include_images=False).images == []
    result = normalize({'results': [], 'images': [
        {'url': 'https://example.com/a', 'source_url': '\ud800'}]})
    assert result.images[0]['source_url'] == 'https://example.com/a'


def test_output_limits_include_discarded_count():
    result = normalize({'results': [{'url': f'https://example.com/{i}'}
                                    for i in range(40)],
                        'images': [f'https://example.com/{i}.png'
                                   for i in range(40)]}, max_results=8)
    assert len(result.results) == 8 and result.discarded_results == 32
    assert len(result.images) == 12 and result.discarded_images == 28
