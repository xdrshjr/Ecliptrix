"""有限凭证轮换与原子候选分配；所有尝试共享搜索截止时间。"""
import asyncio

from app.config import get_settings
from app.models.web_research_models import WebResearchError, WebSearchData
from app.services.system_settings_service import system_settings_service
from .provenance import add_candidate, source_record
from .run_registry import RunRegistry
from .search_provider import fetch_search_response, normalize_search_payload

SEARCH_TIMEOUT = 15


def _clock():
    return asyncio.get_running_loop().time()


def _check_deadline(deadline):
    if _clock() >= deadline:
        raise WebResearchError("upstream_timeout")


class WebSearchService:
    def _api_keys(self):
        configured = system_settings_service.get("web_research", "tavily_api_keys")
        if isinstance(configured, list):
            return configured
        return list(get_settings().tavily_api_keys)

    def usable_keys(self):
        """归一化后实际参与搜索的 key（strip → 去重 → 至多 3 个）。"""
        return list(dict.fromkeys(key.strip() for key in self._api_keys()
                                  if isinstance(key, str) and key.strip()))[:3]

    async def _tavily_post(self, api_key, payload):
        return await fetch_search_response(api_key, payload)

    async def search(self, query, max_results=5, search_depth="basic",
                     include_images=False, run=None):
        deadline = _clock() + SEARCH_TIMEOUT
        keys = self.usable_keys()
        if not keys:
            raise WebResearchError("provider_not_configured")
        payload = {"query": query, "max_results": max_results,
                   "search_depth": search_depth, "include_images": include_images,
                   "include_raw_content": False, "include_answer": False}
        try:
            async with asyncio.timeout_at(deadline):
                body = await self._try_keys(keys, payload, deadline)
                _check_deadline(deadline)
                normalized = normalize_search_payload(body, payload)
                _check_deadline(deadline)
                # 同步解析无法被抢占；提交前交还取消点并重新检查。
                await asyncio.sleep(0)
                _check_deadline(deadline)
                if run is not None:
                    RunRegistry.ensure_active(run)
                return self._result(normalized, run)
        except TimeoutError:
            raise WebResearchError("upstream_timeout") from None

    async def _try_keys(self, keys, payload, deadline):
        """被拒换 key；429 按 Retry-After 等待后换 key，最多 3 次（D-12）。"""
        last = "provider_rejected"
        attempts = 0
        for key in keys:
            _check_deadline(deadline)
            attempts += 1
            if attempts > 3:
                break
            try:
                return await self._tavily_post(key, payload)
            except WebResearchError as error:
                if error.error_code not in {"provider_rejected",
                                            "provider_rate_limited"}:
                    raise
                last = error.error_code
                if last == "provider_rate_limited":
                    await self._wait_retry_after(error, deadline)
        raise WebResearchError(last)

    async def _wait_retry_after(self, error, deadline):
        delay = float(getattr(error, "retry_after", 0) or 0)
        if delay and deadline - _clock() > delay:
            await asyncio.sleep(delay)

    def _result(self, body, run):
        results, images, sources = [], [], {}
        for item in body.results:
            url = item["url"]
            source = source_record(url, item["title"])
            sources[url] = source
            results.append({"source_id": source["id"], "url": source["url"],
                "title": source["title"], "domain": source["domain"],
                "snippet": item["content"]})
            if run is not None:
                add_candidate(run, url, source, kind="page")
        if run is not None:
            for item in body.images:
                page = item["source_url"]
                if page not in sources:
                    sources[page] = source_record(page)
                images.append(add_candidate(run, item["url"], sources[page],
                                            alt=item["description"]))
        return WebSearchData(results=results, sources=list(sources.values()),
                             images=images)


_service = None


def get_web_search_service():
    global _service
    if _service is None:
        _service = WebSearchService()
    return _service
