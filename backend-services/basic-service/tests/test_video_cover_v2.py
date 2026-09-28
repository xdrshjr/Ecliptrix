"""封面工作室：规范文档、CAS 和不可变成品回归。"""
import asyncio
import io
from uuid import uuid4

import pytest
from PIL import Image
from pydantic import ValidationError
from app.models.db_models import VideoProject
from app.models.video_cover_v2_models import (
    CoverDocument,
    SaveCoverRequest,
    CoverError,
)
from app.services import video_cover_asset_service as assets
from app.services import video_cover_v2_service as service


def png(size=(1920, 1080), color="red"):
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, "PNG")
    return output.getvalue()


async def project(db, monkeypatch, tmp_path):
    from app.config import settings

    monkeypatch.setattr(assets.storage_service, "root", tmp_path)
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))
    row = VideoProject(name="封面测试")
    db.add(row)
    await db.commit()
    return str(row.id)


async def draft(db, identifier, **changes):
    document = CoverDocument(fields={"title": "中文标题"}, **changes)
    return await service.save_draft(
        db, identifier, SaveCoverRequest(expected_version=0, document=document)
    )


async def revision(db, identifier, **changes):
    saved = await draft(db, identifier, **changes)
    return await service.publish_revision(
        db,
        identifier,
        png(),
        {
            "request_id": "publish-1",
            "expected_version": saved["version"],
            "document_hash": saved["document_hash"],
        },
    )


def test_cover_v2_contract_is_available():
    assert CoverDocument().schema_version == 2


@pytest.mark.parametrize(
    "change",
    [
        {"unknown": 1},
        {"duration_frames": 2},
        {"duration_frames": 4.5},
        {"typography": {"title_scale": float("nan")}},
        {"fields": {"title": "字" * 81}},
        {"background": {"kind": "solid", "asset_id": str(uuid4())}},
    ],
)
def test_invalid_document_rejected(change):
    with pytest.raises(ValidationError):
        CoverDocument(**change)


@pytest.mark.asyncio
async def test_cas_rejects_stale_and_preserves_draft(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    saved = await draft(db_session, identifier)
    for expected in (0, 8):
        with pytest.raises(CoverError, match="草稿已") as error:
            await service.save_draft(
                db_session,
                identifier,
                SaveCoverRequest(
                    expected_version=expected, document=CoverDocument()
                ),
            )
        assert error.value.code == "COVER_VERSION_CONFLICT"
    state = await service.load_state(db_session, identifier)
    assert state["document"] == saved["document"]


@pytest.mark.asyncio
async def test_publish_retry_after_draft_changes_returns_original(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    first = await revision(db_session, identifier)
    await service.save_draft(
        db_session,
        identifier,
        SaveCoverRequest(
            expected_version=1, document=CoverDocument(fields={"title": "新标题"})
        ),
    )
    options = {
        "request_id": "publish-1",
        "expected_version": 1,
        "document_hash": first["document_hash"],
    }
    retry = await service.publish_revision(
        db_session, identifier, png(), options
    )
    assert retry["id"] == first["id"]
    with pytest.raises(CoverError) as error:
        await service.publish_revision(
            db_session, identifier, png(color="blue"), options
        )
    assert error.value.code == "COVER_REQUEST_CONFLICT"


@pytest.mark.asyncio
async def test_empty_ai_draft_saves_but_does_not_publish(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    saved = await draft(db_session, identifier, mode="ai")
    with pytest.raises(CoverError) as error:
        await service.publish_revision(
            db_session,
            identifier,
            png(),
            {
                "request_id": "x",
                "expected_version": 1,
                "document_hash": saved["document_hash"],
            },
        )
    assert error.value.code == "COVER_DRAFT_NOT_READY"


@pytest.mark.asyncio
async def test_missing_project_is_not_empty_draft(db_session):
    with pytest.raises(CoverError) as error:
        await service.load_state(db_session, str(uuid4()))
    assert error.value.status == 404


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "data",
    [b"<svg/>", b"\x89PNG\r\n\x1a\n", b"x" * (20 * 1024 * 1024 + 1)],
    ids=["svg", "broken-png", "oversized"],
)
async def test_invalid_or_oversized_image_rejected(data):
    with pytest.raises(CoverError):
        await assets.decode_image(data)


@pytest.mark.asyncio
async def test_pixel_limit_checked_before_load():
    with pytest.raises(CoverError):
        await assets.decode_image(png((8001, 4000)))


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/a.png",
        "file:///a.png",
        "/api/storage/files/../../escape.png",
        "/api/storage/files/C:/escape.png",
    ],
)
def test_source_path_rejects_remote_and_traversal(url, monkeypatch, tmp_path):
    monkeypatch.setattr(assets.storage_service, "root", tmp_path)
    with pytest.raises(CoverError):
        assets.local_source_path(url)


@pytest.mark.asyncio
async def test_foreign_background_rejected(db_session, monkeypatch, tmp_path):
    first = await project(db_session, monkeypatch, tmp_path)
    second = await project(db_session, monkeypatch, tmp_path)
    asset = await service.upload_asset(db_session, first, png((20, 20)))
    with pytest.raises(CoverError):
        await draft(
            db_session,
            second,
            background={"kind": "asset", "asset_id": asset["asset_id"]},
        )


def api_app(db):
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    from app.database import get_db_session
    from app.routers.video_cover_v2 import router
    from app.routers.video_cover import router as legacy_router
    from app.models.base_models import ErrorResponse

    app = FastAPI()

    async def session():
        yield db

    async def error_handler(request, exc):
        return JSONResponse(
            status_code=exc.status,
            content=ErrorResponse(
                success=False,
                message=str(exc),
                error_code=exc.code,
                error_details=exc.details,
            ).model_dump(mode="json"),
        )

    app.dependency_overrides[get_db_session] = session
    app.add_exception_handler(CoverError, error_handler)
    app.include_router(router, prefix="/api")
    app.include_router(legacy_router, prefix="/api")
    return app


@pytest.mark.asyncio
async def test_api_publish_upload_and_download_wire_contract(
    db_session, monkeypatch, tmp_path
):
    import httpx

    identifier = await project(db_session, monkeypatch, tmp_path)
    app = api_app(db_session)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        path = f"/api/video-cover-v2/{identifier}"
        empty = (await client.get(path)).json()
        assert empty["success"] and empty["data"]["version"] == 0
        assert isinstance(empty["data"]["generation_configured"], bool)
        saved = await client.put(
            path,
            json={
                "expected_version": 0,
                "document": CoverDocument(fields={"title": "实际接口"}).model_dump(
                    mode="json"
                ),
            },
        )
        assert saved.status_code == 200
        saved = saved.json()["data"]
        uploaded = await client.post(
            path + "/assets",
            files={"file": ("asset.png", png((20, 20)), "image/png")},
        )
        assert uploaded.status_code == 200
        assert "asset_id" in uploaded.json()["data"]
        published = await client.post(
            path + "/revisions",
            files={"file": ("render.png", png(), "image/png")},
            data={
                "request_id": "api",
                "expected_version": "1",
                "document_hash": saved["document_hash"],
            },
        )
        assert published.status_code == 201, published.text
        result = published.json()["data"]
        download = await client.get(
            path + f"/revisions/{result['id']}/download"
        )
        assert download.status_code == 200
        assert Image.open(io.BytesIO(download.content)).size == (1920, 1080)
        assert identifier not in assets._leases
        bad = await client.post(
            path + "/assets", json={"source_asset_url": "https://example.com/x"}
        )
        assert bad.status_code == 400
        assert bad.json()["error_code"] == "COVER_INVALID_ASSET"


@pytest.mark.asyncio
async def test_two_concurrent_same_version_writes_only_one_succeeds(
    db_session, monkeypatch, tmp_path
):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    identifier = await project(db_session, monkeypatch, tmp_path)
    await draft(db_session, identifier)
    sessions = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def save(title):
        async with sessions() as db:
            return await service.save_draft(
                db,
                identifier,
                SaveCoverRequest(
                    expected_version=1,
                    document=CoverDocument(fields={"title": title}),
                ),
            )

    results = await asyncio.gather(save("A"), save("B"), return_exceptions=True)
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, CoverError) for result in results) == 1


@pytest.mark.asyncio
async def test_legacy_import_text_fallback_is_idempotent(
    db_session, monkeypatch, tmp_path
):
    from app.models.db_models import ProjectCover

    identifier = await project(db_session, monkeypatch, tmp_path)
    db_session.add(
        ProjectCover(
            project_id=__import__("uuid").UUID(identifier),
            template_id="title",
            cover_config={
                "textLayers": [
                    {"key": "title", "text": "旧标题"},
                    {"key": "other", "text": "旧副标题"},
                ]
            },
            image_source="frame",
            aspect_ratio="16:9",
        )
    )
    await db_session.commit()
    first = await service.legacy_import(db_session, identifier, "legacy")
    assert first["document"]["fields"]["title"] == "旧标题"
    await service.save_draft(
        db_session,
        identifier,
        SaveCoverRequest(
            expected_version=1, document=CoverDocument(fields={"title": "保留修改"})
        ),
    )
    retry = await service.legacy_import(db_session, identifier, "legacy")
    assert retry["document"]["fields"]["title"] == "保留修改"


@pytest.mark.asyncio
async def test_remote_redirect_validates_each_hop(monkeypatch):
    import httpx
    from unittest.mock import AsyncMock

    loop = asyncio.get_running_loop()
    resolver = AsyncMock(
        side_effect=[
            [(2, 1, 6, "", ("93.184.216.34", 443))],
            [(2, 1, 6, "", ("127.0.0.1", 80))],
        ]
    )
    monkeypatch.setattr(loop, "getaddrinfo", resolver)
    requests = []

    async def handle(request):
        requests.append(request)
        return httpx.Response(
            302, headers={"location": "http://private.example/x"}
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(handle), **kwargs
        ),
    )
    with pytest.raises(CoverError):
        await assets.download_image("https://public.example/image")
    assert len(requests) == 1
    assert requests[0].url.host == "93.184.216.34"
    assert requests[0].headers["host"] == "public.example"


@pytest.mark.asyncio
async def test_remote_download_stops_at_byte_limit(monkeypatch):
    import httpx
    from unittest.mock import AsyncMock

    chunks = []

    class LargeStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index in range(500):
                chunks.append(index)
                yield b"x" * 65536

    async def handle(request):
        return httpx.Response(200, stream=LargeStream())

    monkeypatch.setattr(
        assets, "_validate_remote", AsyncMock(return_value="93.184.216.34")
    )
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(handle), **kwargs
        ),
    )
    with pytest.raises(CoverError) as error:
        await assets.download_image("https://public.example/image")
    assert error.value.status == 413
    assert len(chunks) == 321


@pytest.mark.asyncio
async def test_blocking_worker_failure_does_not_override_cancellation():
    import threading

    started = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()

    def fail_after_release():
        loop.call_soon_threadsafe(started.set)
        release.wait(5)
        raise ValueError("图片读取失败")

    task = asyncio.create_task(assets.run_blocking(fail_after_release))
    await started.wait()
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
