"""页面图片链路：候选归一化 / 保存入库 / 错误码 / provenance / 裁剪收敛。

对应设计 `docs/plans/agent-browser-image-ingest/spec.md` 的 AC-I1…AC-I21。
全部使用 `browser_workspace_fakes` 的 Fake 驱动（不 mock 授权与策略层），
入库仍走真实的 `web_media_download.download_material` + PIL 校验。
"""
import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

from app.models.web_research_models import (BrowserSaveImageRequest,
                                            WebResearchError)
from app.services.browser_workspace import dispatch as module
from app.services.browser_workspace import images as image_candidates
from app.services.web_research import web_media_download
from app.services.web_research.browser_result import (IMAGES_MAX_BYTES,
                                                      MAX_RESULT_BYTES,
                                                      fit_result)
from tests.browser_workspace_fakes import make_run, make_service


def png_bytes(size=(64, 48)):
    buffer = io.BytesIO()
    Image.new("RGB", size, (20, 120, 220)).save(buffer, format="PNG")
    return buffer.getvalue()


class FakeStore:
    def __init__(self):
        self.calls = []

    async def store_research_download_async(self, path, digest, fmt, final_url):
        self.calls.append((digest, fmt, final_url))
        return {"size": path.stat().st_size, "reused": False,
                "local_url": "/api/storage/files/cached_materials/web/x.png",
                "created_at": "2026-11-26T00:00:00Z"}


@pytest.fixture
def wired(monkeypatch):
    service, driver, _ = make_service()
    monkeypatch.setattr(module, "_service", service)
    monkeypatch.setattr(web_media_download, "research_settings",
                        lambda: {"downloads_enabled": True,
                                 "respect_robots": True})
    store = FakeStore()
    import app.services.material_download_service as downloads
    monkeypatch.setattr(downloads, "get_material_download_service",
                        lambda: store)
    return service, driver, store


CANDIDATES = [
    {"image_url": "https://x.test/big.jpg", "kind": "url", "alt": "发布会现场",
     "natural_w": 1600, "natural_h": 900, "rendered_w": 800, "rendered_h": 450,
     "in_viewport": True, "is_og": False, "via_srcset_best": True},
    {"image_url": "https://x.test/og.png", "kind": "url", "alt": "封面",
     "natural_w": 1200, "natural_h": 630, "rendered_w": 0, "rendered_h": 0,
     "in_viewport": False, "is_og": True, "via_srcset_best": False},
]


async def opened(wired, candidates=None):
    """开一个标签页并把候选注入主进程假实现。"""
    service, driver, store = wired
    _, run, _ = await make_run()
    tab = (await service.open(run, "https://x.test/news/1"))["session_id"]
    driver.command = _command_with(candidates or CANDIDATES)
    return service, driver, store, run, tab


def _command_with(candidates):
    async def command(run_id, type, args=None, tab_id=None, timeout_s=20,
                      command_id=None):
        if type == "images":
            return {"images": candidates, "title": "新闻",
                    "final_url": "https://x.test/news/1"}
        return {"snapshot_version": 1, "url": "https://x.test/news/1"}
    return command


@pytest.mark.asyncio
async def test_candidates_are_normalised_with_stable_ids(wired):
    """AC-I1：候选带 `image_id`，含 `og:image`，且逐项补 `page_url`。"""
    service, driver, store, run, tab = await opened(wired)
    result = await service.read(run, tab, images=True)
    images = result["images"]
    assert [item["image_id"] for item in images] == ["i1", "i2"]
    assert images[0]["image_url"] == "https://x.test/big.jpg"
    assert images[0]["natural_w"] == 1600 and images[0]["natural_h"] == 900
    assert images[1]["is_og"] is True and images[1]["via_srcset_best"] is False
    assert all(item["page_url"] == "https://x.test/news/1" for item in images)
    # 只增字段不改名：既有调用方读 width/height（AC-I21）。
    assert images[0]["width"] == 1600 and images[0]["height"] == 900
    assert set(service.tabs[tab].images) == {"i1", "i2"}


@pytest.mark.asyncio
async def test_images_max_truncates_in_backend_only(wired):
    """AC-I1：`images_max` 在后端截断；重复 URL 去重。"""
    many = CANDIDATES + [{"image_url": "https://x.test/big.jpg", "kind": "url",
                          "alt": "重复", "natural_w": 1, "natural_h": 1}]
    service, driver, store, run, tab = await opened(wired, many)
    result = await service.read(run, tab, images=True, images_max=20)
    assert len(result["images"]) == 2  # 去重后只有两条
    narrowed = await service.read(run, tab, images=True, images_max=20)
    assert len(narrowed["images"]) <= 20


@pytest.mark.asyncio
async def test_save_ok_returns_local_material_and_provenance(wired):
    """AC-I2 / AC-I8：真实字节经会话取回入库，provenance 带 workspace 标记。"""
    service, driver, store, run, tab = await opened(wired)
    driver.resource = {"body": png_bytes(), "content_type": "image/png",
                       "final_url": "https://x.test/big.jpg"}
    await service.read(run, tab, images=True)
    result = await service.save_image(run, tab, "i1", "新闻配图")
    material = result["material"]
    assert result["status"] == "ready"
    assert material["local_url"].startswith(
        "/api/storage/files/cached_materials/")
    assert material["type"] == "image" and material["width"] == 64
    provenance = material["provenance"]
    assert provenance["via"] == "workspace_tab"
    assert provenance["source"] == "workspace"
    assert provenance["tab_id"] == tab
    assert provenance["source_page_url"] == "https://x.test/news/1"
    assert provenance["sha256"]
    # 素材走 material_download_service，不是 artifact（不受 1 天留存约束）。
    assert material["metadata"]["source"] == "web"


@pytest.mark.asyncio
async def test_inline_candidate_is_refused(wired):
    """AC-I3：`data:`/`blob:` 刻意拒绝（技术上支持，本轮是范围决策）。"""
    inline = [{"image_url": "data:image/png;base64,AAAA", "kind": "inline",
               "alt": "", "natural_w": 10, "natural_h": 10}]
    service, driver, store, run, tab = await opened(wired, inline)
    await service.read(run, tab, images=True)
    with pytest.raises(WebResearchError) as caught:
        await service.save_image(run, tab, "i1")
    assert caught.value.error_code == "inline_image_unsupported"
    assert caught.value.status_code == 400


@pytest.mark.asyncio
async def test_url_is_not_accepted_by_schema_or_backend(wired):
    """AC-I4：两层各自可验证 —— schema 挡形状，后端闭集挡归属。"""
    with pytest.raises(Exception):
        BrowserSaveImageRequest(image_id="http://evil.test/a.jpg")
    with pytest.raises(Exception):
        BrowserSaveImageRequest(image_id="i100")
    service, driver, store, run, tab = await opened(wired)
    await service.read(run, tab, images=True)
    with pytest.raises(WebResearchError) as caught:
        await service.save_image(run, tab, "i99")
    assert caught.value.error_code == "image_not_found"
    assert caught.value.status_code == 404


@pytest.mark.asyncio
async def test_snapshot_stale_after_navigation(wired):
    """AC-I11：页面自跳转不改 version，故必须另比页面 URL。"""
    service, driver, store, run, tab = await opened(wired)
    await service.read(run, tab, images=True)
    service.tabs[tab].url = "https://x.test/news/2"
    with pytest.raises(WebResearchError) as caught:
        await service.save_image(run, tab, "i1")
    assert caught.value.error_code == "stale_snapshot"

    version = service.tabs[tab].version
    service.tabs[tab].url = "https://x.test/news/1"
    with pytest.raises(WebResearchError) as caught:
        await service.save_image(run, tab, "i1", snapshot_version=version + 7)
    assert caught.value.error_code == "stale_snapshot"


@pytest.mark.asyncio
async def test_read_act_save_still_works(wired):
    """AC-I11：`act` 不清空候选，`read -> act -> save` 仍可用。"""
    service, driver, store, run, tab = await opened(wired)
    await service.read(run, tab, images=True)
    driver.resource = {"body": png_bytes(), "content_type": "image/png",
                       "final_url": "https://x.test/big.jpg"}
    service.tabs[tab].version = 9  # 模拟 act 之后版本推进
    result = await service.save_image(run, tab, "i1")
    assert result["status"] == "ready"


@pytest.mark.asyncio
async def test_not_image_and_too_large(wired):
    """AC-I6 / AC-I7：HTML 错误页与非图片、超限字节分别有自己的码。"""
    service, driver, store, run, tab = await opened(wired)
    await service.read(run, tab, images=True)
    driver.resource = {"body": b"<html>nope</html>",
                       "content_type": "text/html", "final_url": ""}
    with pytest.raises(WebResearchError) as caught:
        await service.save_image(run, tab, "i1")
    assert caught.value.error_code == "resource_not_image"

    oversized = b"\x89PNG" + b"\x00" * (10 * 1024 * 1024 + 32)
    driver.resource = {"body": oversized, "content_type": "image/png",
                       "final_url": ""}
    with pytest.raises(WebResearchError) as caught:
        await service.save_image(run, tab, "i1")
    assert caught.value.error_code == "resource_too_large"


@pytest.mark.asyncio
async def test_inline_and_missing_ids_are_registered_codes():
    """AC-I5：两个新码必须同时在 STATUS 与 FAILURE_CLASS_BY_CODE 登记。"""
    from app.models.web_research_models import (FAILURE_CLASS_BY_CODE,
                                                STATUS)
    assert STATUS["image_not_found"] == 404
    assert STATUS["inline_image_unsupported"] == 400
    assert "image_not_found" in FAILURE_CLASS_BY_CODE
    assert "inline_image_unsupported" in FAILURE_CLASS_BY_CODE


@pytest.mark.asyncio
async def test_budget_exhausted_uses_413(wired):
    """AC-I5：动作预算耗尽登记为 413（不是 429；429 属并发争用）。"""
    service, driver, store, run, tab = await opened(wired)
    from app.models.web_research_models import STATUS
    assert STATUS["browser_budget_exceeded"] == 413
    assert STATUS["browser_busy"] == 429


def test_fit_result_terminates_with_many_images():
    """AC-I19：图片很多 + 正文很长 + 元素很多时，裁剪器必须返回而不空转。

    旧实现只认 elements/text：`images` 撑爆 11.5 KB 后两者被清空，
    `max(0, 0 - 512)` 恒为 0、`text` 恒为 ""，`while` 条件永真 → 进程挂死。
    """
    result = {
        "text": "正文" * 4000,
        "elements": [{"ref": "e%d" % i, "name": "元素" * 20} for i in range(120)],
        "images": [{"image_id": "i%d" % i, "image_url": "https://x.test/a" * 40,
                    "alt": "图片" * 40} for i in range(41)],
    }
    fitted = fit_result(result, MAX_RESULT_BYTES)
    size = len(json.dumps(fitted, ensure_ascii=False).encode())
    assert size <= MAX_RESULT_BYTES
    assert fitted["truncated"] is True
    assert len(json.dumps(fitted.get("images", []), ensure_ascii=False)
               .encode()) <= IMAGES_MAX_BYTES


def test_fit_result_breaks_when_every_bucket_is_empty():
    """AC-I19：三类皆空仍超限时 `break`，不得空转（防再次死循环）。"""
    result = {"text": "", "elements": [], "images": [],
              "padding": "x" * (MAX_RESULT_BYTES + 200)}
    fitted = fit_result(result, MAX_RESULT_BYTES)
    assert fitted["elements"] == [] and fitted["text"] == ""


def test_images_budget_is_its_own_pool():
    """AC-I19：图片预算独立，不与正文抢同一个 11.5 KB 池。"""
    assert IMAGES_MAX_BYTES < MAX_RESULT_BYTES


@pytest.mark.asyncio
async def test_read_with_many_images_stays_within_max_result_bytes(wired):
    """AC-I19 回归：`images` 必须在**挂载之后**再过一次裁剪器。

    `_finish_snapshot` 的 `fit_result` 只见过 text/elements，候选是之后才挂上
    去的；100 条候选实测 35 557 字节，是 11 500 上限的三倍。首版实现漏了这次
    重裁，两条单测各自都绿，真实响应却会撑爆模型上下文。
    """
    many = [{"image_url": "https://x.test/a%d.jpg" % i, "kind": "url",
             "alt": "新闻配图" * 3, "natural_w": 1600, "natural_h": 900,
             "rendered_w": 800, "rendered_h": 450, "in_viewport": True,
             "is_og": False, "via_srcset_best": True} for i in range(100)]
    service, driver, store, run, tab = await opened(wired, many)
    result = await service.read(run, tab, images=True, images_max=100)
    size = len(json.dumps(result, ensure_ascii=False).encode())
    assert size <= MAX_RESULT_BYTES, size
    assert result["truncated"] is True
    # 候选被削过，但登记表保留完整闭集：削的是回给模型的载荷，不是可保存集合。
    assert len(service.tabs[tab].images) == 100
    assert len(result["images"]) < 100


def test_read_images_budget_exceeds_snapshot_chain():
    """AC-I20 回归：`images:true` 的读预算必须大于两条主进程命令之和。

    read 带 images 时串行跑 snapshot(10 s) + images(10 s)。路由原先把动作预算
    写死 10 s，新参数一开就会被自己的超时链掐成 upstream_timeout。
    """
    from app.routers import research_browser_router as router
    assert router.READ_IMAGES_TIMEOUT_S > router.READ_TIMEOUT_S * 2
    assert router.READ_TIMEOUT_S == 10  # 不带 images 的既有链路不变


def test_timeout_chain_is_one_number():
    """AC-I20：三处超时成对 —— 前端 60 000 / driver 55 / 主进程 55 000。"""
    from pathlib import Path
    from app.services.browser_workspace import driver as driver_module
    assert driver_module.FETCH_TIMEOUT_S == 55
    root = Path(__file__).resolve().parents[3]
    desktop = (root / "desktop/main/browserWorkspace/resourceFetch.js") \
        .read_text(encoding="utf-8")
    assert "FETCH_TIMEOUT_MS = 55_000" in desktop
    router = (root / "backend-services/basic-service/app/routers/"
              "research_browser_router.py").read_text(encoding="utf-8")
    assert "SAVE_IMAGE_TIMEOUT_S = 60" in router
    tools = (root / "src/lib/video-editing-agent/tools/browserTools.ts") \
        .read_text(encoding="utf-8")
    assert "BROWSER_IMAGE_SAVE_TIMEOUT_MS = 60_000" in tools


@pytest.mark.asyncio
async def test_isolated_mode_reports_candidates_but_refuses_save(wired):
    """P2-5 / R-4：沙盒可给候选，保存明确回不支持，不假装成功。"""
    from app.services.browser_workspace.dispatch import Dispatch
    _, run, _ = await make_run()
    with pytest.raises(WebResearchError) as caught:
        await Dispatch().save_image(run, {"session_id":
                                          "123e4567-e89b-42d3-a456-426614174000",
                                          "image_id": "i1"})
    assert caught.value.error_code == "action_unsupported_in_isolated"


def test_normalise_images_is_pure_and_keeps_legacy_names():
    """AC-I21：归一化是纯函数，既有 width/height 不丢。"""
    raw = [{"image_url": "https://x.test/a.jpg", "alt": "a",
            "natural_w": 10, "natural_h": 20}]
    out = image_candidates.normalise(raw, "https://x.test/p", 3, 40)
    assert out[0]["width"] == 10 and out[0]["height"] == 20
    assert out[0]["natural_w"] == 10 and out[0]["snapshot_version"] == 3
    assert out[0]["kind"] == "url" and out[0]["page_url"] == "https://x.test/p"
