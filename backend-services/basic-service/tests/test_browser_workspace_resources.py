"""带登录态取图入库：魔数/大小/provenance（spec §4.4.1 / AC-A7）。"""
import io
from types import SimpleNamespace

import pytest
from PIL import Image

from app.models.web_research_models import WebResearchError
from app.services.browser_workspace import dispatch as module
from app.services.web_research import web_media_download
from tests.browser_workspace_fakes import make_run, make_service


def png_bytes(size=(64, 48)):
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


class FakeStore:
    def __init__(self):
        self.calls = []

    async def store_research_download_async(self, path, digest, fmt, final_url):
        self.calls.append((digest, fmt, final_url))
        return {"size": path.stat().st_size, "reused": False,
                "local_url": "/api/storage/files/cached_materials/web/x.png",
                "created_at": "2026-11-25T00:00:00Z"}


@pytest.fixture
def wired(monkeypatch):
    service, driver, _ = make_service()
    monkeypatch.setattr(module, "_service", service)
    monkeypatch.setattr(web_media_download, "research_settings",
                        lambda: {"downloads_enabled": True, "respect_robots": True})
    store = FakeStore()
    import app.services.material_download_service as downloads
    monkeypatch.setattr(downloads, "get_material_download_service", lambda: store)
    return service, driver, store


@pytest.mark.asyncio
async def test_candidate_from_workspace_tab_is_fetched_with_session_and_tagged(wired):
    """AC-A7：候选来自工作台标签页 → 字节经驱动取回，provenance 含 via。"""
    service, driver, store = wired
    driver.resource = {"body": png_bytes(), "content_type": "image/png",
                       "final_url": "https://x.test/p.png"}
    _, run, _ = await make_run()
    tab = (await service.open(run, "https://x.test/"))["session_id"]
    from app.services.web_research.web_image_service import get_web_image_service
    images = await get_web_image_service().discover_images(
        session_id=tab, run=run, max_images=4)
    assert images and images[0]["width"] == 1600
    candidate = run.candidates[images[0]["candidate_id"]]
    assert candidate["source"]["via"] == "workspace_tab"
    request = SimpleNamespace(kind="image", url=candidate["url"], name="图",
                              source_page_url=None)
    result = await web_media_download.download_material(request, run, candidate["source"])
    provenance = result["material"]["provenance"]
    assert provenance["via"] == "workspace_tab" and provenance["source_kind"] == "browser"
    assert provenance["page_url"].startswith("https://x.test")
    assert provenance["captured_at"] and result["material"]["type"] == "image"
    assert store.calls and not driver.commands[-1].type == "download"


@pytest.mark.asyncio
async def test_non_image_and_oversize_bytes_are_refused(wired):
    service, driver, _ = wired
    _, run, _ = await make_run()
    tab = (await service.open(run, "https://x.test/"))["session_id"]
    driver.resource = {"body": b"<html>", "content_type": "text/html", "final_url": ""}
    from app.services.browser_workspace.resources import fetch_via_tab
    source = {"tab_id": tab}
    with pytest.raises(WebResearchError) as caught:
        await fetch_via_tab(run, source, "https://x.test/a", "image", 1024)
    assert caught.value.error_code == "resource_not_image"
    driver.resource = {"body": b"x" * 2048, "content_type": "image/png", "final_url": ""}
    with pytest.raises(WebResearchError) as caught:
        await fetch_via_tab(run, source, "https://x.test/a", "image", 1024)
    assert caught.value.error_code == "resource_too_large"


@pytest.mark.asyncio
async def test_fake_image_with_image_content_type_fails_magic_validation(wired):
    service, driver, _ = wired
    driver.resource = {"body": b"not really a png", "content_type": "image/png",
                       "final_url": ""}
    from app.services.browser_workspace.resources import save_resource
    with pytest.raises(Exception):
        await save_resource("tab-1", "https://x.test/a.png", "image")


@pytest.mark.asyncio
async def test_user_save_resource_has_no_run_and_lands_in_library(wired):
    service, driver, store = wired
    driver.resource = {"body": png_bytes(), "content_type": "image/png",
                       "final_url": ""}
    from app.services.browser_workspace.resources import save_resource
    result = await save_resource("tab-1", "https://x.test/a.png", "image",
                                 "https://x.test/page", "封面")
    assert result["status"] == "ready" and result["material"]["name"] == "封面"
    assert result["material"]["provenance"]["via"] == "workspace_tab"
    assert store.calls
