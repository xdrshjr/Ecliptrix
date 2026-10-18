"""静态抓取：解析、不可变快照与分页语义（AC-34）。"""
from types import SimpleNamespace

import pytest

from app.models.web_research_models import WebFetchRequest, WebResearchError
from app.services.web_research.web_fetch_service import parse_page, WebFetchService

ARTIFACT = "11111111-2222-3333-4444-555555555555"
RUN = SimpleNamespace(run_id="run-1", project_id=None)


def test_html_removes_active_content_and_preserves_image_queries():
    page = parse_page(b'<title>T</title><script>secret</script><nav>N</nav><main>hello</main><img src="/a.png?q=1">', 'https://example.com/final')
    assert 'hello' in page['text'] and 'secret' not in page['text']
    assert page['images'][0]['image_url'] == 'https://example.com/a.png?q=1'


class FakeStore:
    def __init__(self, body=b""):
        self.body = body
        self.writes = 0
        self.reads = []

    async def write(self, kind, body, context, retention_days=7):
        self.writes += 1
        self.body = body
        return SimpleNamespace(id=ARTIFACT)

    async def read(self, identifier, project_id, offset=0, max_bytes=4000):
        from app.services.web_research.artifact_store import byte_page
        self.reads.append((identifier, project_id, offset, max_bytes))
        return {"kind": "page", **byte_page(self.body, offset, max_bytes),
                "sources": [{"id": "src-1", "url": "https://example.com",
                             "final_url": "https://example.com/final",
                             "title": "Example"}]}


class FakeFetch(WebFetchService):
    """跳过真实解析：只统计抓取次数，便于证明分页不重新抓取。"""

    def __init__(self, text="第一页内容"):
        super().__init__(client=object())
        self.store = FakeStore()
        self.pages = 0
        self.text = text

    async def page(self, url):
        self.pages += 1
        return {"title": "Example", "text": self.text, "images": [], "links": [],
                "final_url": url}


def run(coroutine):
    import asyncio
    return asyncio.run(coroutine)


def test_offset_zero_fetches_once_and_stores_one_snapshot():
    service = FakeFetch("abcdefghij" * 20)
    data = run(service.fetch(url="https://example.com", max_bytes=500, run=RUN))
    assert service.pages == 1
    assert service.store.writes == 1
    assert data.artifact_id == ARTIFACT
    assert data.snapshot_stable is True
    assert data.content == service.store.body.decode()[:len(data.content)]


def test_paging_reads_the_snapshot_even_when_the_site_changed():
    service = FakeFetch("旧内容" * 100)
    first = run(service.fetch(url="https://example.com", max_bytes=500, run=RUN))
    # 站点在两次调用之间更新：分页不得重新抓取，语义不得漂移。
    service.text = "新内容" * 100
    second = run(service.fetch(artifact_id=ARTIFACT, offset=first.next_offset,
                               max_bytes=500, run=RUN))
    assert service.pages == 1
    assert service.store.writes == 1
    assert second.content and "新" not in second.content
    assert second.artifact_id == ARTIFACT
    assert service.store.reads == [(ARTIFACT, None, first.next_offset, 500)]


def test_offset_without_artifact_is_rejected():
    service = FakeFetch()
    with pytest.raises(WebResearchError) as error:
        run(service.fetch(url="https://example.com", offset=100, run=RUN))
    assert error.value.error_code == "invalid_offset"
    assert service.store.writes == 0


def test_request_requires_exactly_one_source_and_artifact_for_offset():
    assert WebFetchRequest(url="https://example.com").offset == 0
    assert WebFetchRequest(artifact_id=ARTIFACT, offset=10).offset == 10
    with pytest.raises(ValueError):
        WebFetchRequest(url="https://example.com", artifact_id=ARTIFACT)
    with pytest.raises(ValueError):
        WebFetchRequest(url="https://example.com", offset=10)
    with pytest.raises(ValueError):
        WebFetchRequest()
