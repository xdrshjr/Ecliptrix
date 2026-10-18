"""图片发现只创建候选，实际下载交给统一严格媒体入口。"""
from types import SimpleNamespace
from .provenance import add_candidate, source_record
from .web_fetch_service import get_web_fetch_service
from .web_media_download import download_material


class WebImageService:
    async def discover_images(self, url=None, max_images=8, min_width=0,
                              run=None, session_id=None):
        if session_id:
            from .browser_service import get_browser_service
            page = await get_browser_service().images(run, str(session_id))
        else:
            page = await get_web_fetch_service().page(url)
        source = source_record(url or page["final_url"], page["title"], page["final_url"])
        source["source_page_verified"] = True
        images = []
        for image in page["images"]:
            if image.get("width") and image["width"] < min_width:
                continue
            images.append(add_candidate(run, image["image_url"], source,
                alt=image.get("alt", ""), width=image.get("width"), height=image.get("height")))
            if len(images) >= max_images:
                break
        return images

    async def download_image(self, url, name=None, run=None):
        return await download_material(SimpleNamespace(kind="image", url=url, name=name), run)

    async def download_media(self, url, name=None, run=None):
        return await download_material(SimpleNamespace(kind="media", url=url, name=name), run)


_service = None


def get_web_image_service():
    global _service
    if _service is None:
        _service = WebImageService()
    return _service
