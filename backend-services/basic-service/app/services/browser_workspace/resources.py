"""经工作台标签页取回登录态/防盗链资源，并走既有严格入库路径（spec §4.3.1 / §6.2）。

差别只在**字节来源**：由该标签页的分区会话带 Cookie 与 Referer 取回。取回后的
魔数/大小/尺寸校验、`cached_materials` 入库、provenance 全部复用
`web_media_download.download_material`（provenance 额外带 `via:'workspace_tab'`）。
"""
from types import SimpleNamespace

from app.models.web_research_models import WebResearchError
from app.services.web_research.provenance import display_url, source_record

LIMITS = {"image": 10 * 1024 * 1024, "media": 100 * 1024 * 1024}


def _validated(payload, kind, maximum, url=""):
    """主进程回传的二进制 → 与 SafeHttpClient 响应同形（status/body/url）。"""
    body = payload.get("body") or b""
    content_type = (payload.get("content_type") or "").split(";")[0].strip().lower()
    if not body:
        raise WebResearchError("download_failed", status_code=502)
    if len(body) > maximum:
        raise WebResearchError("resource_too_large", status_code=422)
    if kind == "image" and not content_type.startswith("image/"):
        raise WebResearchError("resource_not_image", status_code=422)
    return SimpleNamespace(status=200, body=body, url=payload.get("final_url") or url)


async def fetch_via_tab(run, source, url, kind, maximum):
    """Agent 路径：`candidate_id` 对应的候选来自某个工作台标签页。"""
    from .dispatch import get_workspace_service
    payload = await get_workspace_service().fetch_resource(
        run, source["tab_id"], url, kind, min(maximum, LIMITS[kind]))
    return _validated(payload, kind, min(maximum, LIMITS[kind]), url)


async def save_resource(tab_id, url, kind, page_url=None, name=None):
    """用户右键「保存到素材库」：没有 run，标签页归属由主进程校验（用户页签）。"""
    from app.services.web_research.web_media_download import download_material
    from .dispatch import get_workspace_service

    if kind not in LIMITS:
        raise WebResearchError("invalid_parameters")
    driver = get_workspace_service().driver
    source = source_record(page_url or url)
    source.update(via="workspace_tab", tab_id=str(tab_id),
                  source_page_verified=False)

    request = SimpleNamespace(kind=kind, url=url, name=name,
                              source_page_url=display_url(page_url or ""))
    # 用户路径无 run：先取回再以 `fetched` 交给同一入库函数（跳过 fetch_via_tab）。
    payload = await driver.fetch_resource(str(tab_id), url, kind, LIMITS[kind])
    fetched = _validated(payload, kind, LIMITS[kind], url)
    return await download_material(request, None, source, fetched=fetched)
