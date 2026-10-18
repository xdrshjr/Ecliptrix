"""静态读取与不可变资料分页；不会隐式启动浏览器。"""
from app.models.web_research_models import WebFetchData, WebResearchError
from app.services.system_settings_service import research_settings
from .safe_http_client import FetchPolicy, RequestSpec, get_safe_http_client
from .provenance import clip_bytes, source_record, display_url
from .artifact_store import byte_page, get_artifact_store


def parse_page(body, url):
    from .media_worker import parse_html
    page = parse_html(body, url)
    for link in page["links"]:
        link["url"] = display_url(link["url"])
    return page


class WebFetchService:
    def __init__(self, client=None, store=None):
        self.client = client or get_safe_http_client()
        self.store = store

    def _artifacts(self):
        return self.store or get_artifact_store()

    async def page(self, url):
        policy = FetchPolicy(respect_robots=research_settings()["respect_robots"])
        response = await self.client.fetch(policy, RequestSpec(url))
        if response.status >= 400:
            raise WebResearchError("upstream_error", status_code=502)
        content_type = response.headers.get("content-type", "").lower()
        if not any(t in content_type for t in ["html", "text/plain", "application/json"]):
            raise WebResearchError("unsupported_content_type")
        if "html" in content_type:
            # HTML 解析使用受管子进程，超时后可终止。
            from .media_worker import parse_html_async
            page = await parse_html_async(response.body, response.url)
            for link in page["links"]:
                link["url"] = display_url(link["url"])
        else:
            page = {"title": "", "text": response.body.decode("utf-8", "replace"),
                    "images": [], "links": []}
        page["final_url"] = response.url
        return page

    async def fetch(self, url=None, output_format="text", max_bytes=4000,
                    offset=0, run=None, max_length=None, artifact_id=None):
        """offset>0 只读既有快照；只有 offset=0 抓取并写入一次（AC-34）。"""
        page_size = min(max_length or max_bytes, 8000)
        if artifact_id or offset:
            return await self._page(artifact_id, offset, page_size, run)
        if not url:
            raise WebResearchError("invalid_parameters")
        return await self._capture(url, output_format, page_size, run)

    async def _capture(self, url, output_format, page_size, run):
        page = await self.page(url)
        source = source_record(url, page["title"], page["final_url"])
        content = page["text"]
        if output_format == "metadata":
            import json
            content = json.dumps({"title": page["title"], "links": page["links"]},
                                 ensure_ascii=False)
        body = clip_bytes(content, 2 * 1024 * 1024).encode()
        artifact = await self._artifacts().write("page", body, {
            "run_id": run.run_id, "project_id": run.project_id,
            "sources": [source]}, research_settings()["artifact_retention_days"])
        result = byte_page(body, 0, page_size)
        return WebFetchData(url=source["url"], final_url=source["final_url"],
                            title=page["title"], artifact_id=artifact.id,
                            source_id=source["id"], sources=[source],
                            snapshot_stable=True,
                            js_page_suspected=len(content.strip()) < 200, **result)

    async def _page(self, artifact_id, offset, page_size, run):
        if not artifact_id:
            # 站点在两次调用间更新会让已确认的 offset 漂移（D-02）。
            raise WebResearchError("invalid_offset")
        data = await self._artifacts().read(
            str(artifact_id), getattr(run, "project_id", None), offset, page_size)
        if data.get("kind") != "page":
            raise WebResearchError("unsupported_content_type")
        sources = data.get("sources") or []
        source = sources[0] if sources else {}
        return WebFetchData(
            url=source.get("url", ""),
            final_url=source.get("final_url") or source.get("url", ""),
            title=source.get("title", ""), artifact_id=str(artifact_id),
            source_id=source.get("id", ""), sources=sources,
            snapshot_stable=True, js_page_suspected=False,
            content=data["content"], next_offset=data["next_offset"],
            truncated=data["truncated"], total_bytes=data["total_bytes"])


_service = None


def get_web_fetch_service():
    global _service
    if _service is None:
        _service = WebFetchService()
    return _service
