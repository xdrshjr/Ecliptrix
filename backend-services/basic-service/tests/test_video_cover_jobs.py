"""计费任务的持久幂等、取消占位和适配器兼容。"""
from unittest.mock import AsyncMock
from contextlib import asynccontextmanager
import asyncio
import threading
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.db_models import ProjectCoverJob
from app.models.video_cover_v2_models import CoverJobRequest, CoverError
from app.services.video_cover_job_service import CoverJobService
from app.services import ark_image_service
from app.models.ark_image_models import ArkImageGenerateRequest
from tests.test_video_cover_v2 import project, draft
from tests.test_video_cover_v2 import png


@pytest.mark.asyncio
async def test_submit_during_dispatch_shutdown_does_not_lose_wakeup(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    await draft(
        db_session, identifier, mode="ai", aspect_ratio="21:9",
        generation={"prompt": "森林", "count": 1},
    )
    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)
    scanned, release, generated = (
        asyncio.Event(), asyncio.Event(), asyncio.Event()
    )
    first_scan = True

    @asynccontextmanager
    async def session_factory():
        nonlocal first_scan
        pause_after_scan = first_scan
        first_scan = False
        async with factory() as db:
            yield db
        if pause_after_scan:
            scanned.set()
            await release.wait()

    async def provider(*args, **kwargs):
        generated.set()
        return [], None

    monkeypatch.setattr(
        ark_image_service, "generate_images_with_pack", provider
    )
    jobs = CoverJobService(session_factory)
    jobs.wake()
    await scanned.wait()
    try:
        await jobs.submit(db_session, identifier, request())
        release.set()
        await asyncio.wait_for(generated.wait(), timeout=2)
    finally:
        release.set()
        jobs._closed = True
        await asyncio.gather(*jobs._active.values())
        if jobs._dispatcher:
            await jobs._dispatcher
        await jobs.close()


def request(key="generate-1", **changes):
    return CoverJobRequest(
        request_id=key,
        base_version=1,
        mode="ai",
        template_id="editorial",
        prompt="森林",
        count=1,
        aspect_ratio="21:9",
        **changes
    )


@pytest.mark.asyncio
async def test_cancel_before_post_never_generates(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    jobs = CoverJobService()
    wake = AsyncMock()
    monkeypatch.setattr(jobs, "wake", lambda: wake())
    cancelled = await jobs.cancel(
        db_session, identifier, request_id="generate-1"
    )
    created = await jobs.submit(db_session, identifier, request())
    assert created["job_id"] == cancelled["job_id"]
    assert created["status"] == "cancelled"
    wake.assert_not_called()
    changed = request().model_copy(update={"prompt": "其他"})
    with pytest.raises(CoverError) as error:
        await jobs.submit(db_session, identifier, changed)
    assert error.value.code == "COVER_REQUEST_CONFLICT"


@pytest.mark.asyncio
async def test_duplicate_submission_and_queue_limit(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    await draft(
        db_session,
        identifier,
        mode="ai",
        aspect_ratio="21:9",
        generation={"prompt": "森林", "count": 1},
    )
    jobs = CoverJobService()
    monkeypatch.setattr(jobs, "wake", lambda: None)
    one = await jobs.submit(db_session, identifier, request())
    duplicate = await jobs.submit(db_session, identifier, request())
    assert duplicate["job_id"] == one["job_id"]
    await jobs.submit(db_session, identifier, request("generate-2"))
    with pytest.raises(CoverError) as error:
        await jobs.submit(db_session, identifier, request("generate-3"))
    assert error.value.status == 429
    await jobs.cancel(db_session, identifier, job_id=one["job_id"])
    await jobs.submit(db_session, identifier, request("generate-3"))


@pytest.mark.asyncio
async def test_stale_job_rejected_before_admission(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    await draft(db_session, identifier)
    jobs = CoverJobService()
    with pytest.raises(CoverError) as error:
        await jobs.submit(db_session, identifier, request())
    assert error.value.code == "COVER_VERSION_CONFLICT"


@pytest.mark.asyncio
async def test_restart_interrupts_without_resubmitting(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    db_session.add(
        ProjectCoverJob(
            project_id=UUID(identifier),
            request_id="restart",
            status="running",
            phase="generating",
        )
    )
    await db_session.commit()
    jobs = CoverJobService(
        async_sessionmaker(db_session.bind, expire_on_commit=False)
    )
    await jobs.start()
    db_session.expire_all()
    row = (await db_session.execute(select(ProjectCoverJob))).scalar_one()
    assert row.status == "interrupted"
    assert not jobs._active


@pytest.mark.asyncio
async def test_ark_defer_download_returns_urls_without_downloading(
    monkeypatch, tmp_path
):
    import httpx

    monkeypatch.setattr(ark_image_service.settings, "ark_api_key", "fixture")
    monkeypatch.setattr(
        ark_image_service,
        "_resolve_multi_references",
        AsyncMock(return_value=(None, "森林")),
    )
    post = AsyncMock(
        return_value=httpx.Response(
            200,
            request=httpx.Request("POST", "https://example.com"),
            json={"data": [{"url": "https://example.com/image.png"}]},
        )
    )
    get = AsyncMock()
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    result, pack = await ark_image_service.generate_images_with_pack(
        ArkImageGenerateRequest(prompt="森林", mode="basic", grid_mode=False),
        defer_download=True,
    )
    assert result[0].image_url == "https://example.com/image.png"
    assert result[0].local_url is None
    assert pack is None
    get.assert_not_called()
    assert post.call_count == 1


@pytest.mark.asyncio
async def test_worker_uses_one_basic_generation_and_keeps_draft_unchanged(
    db_session, monkeypatch, tmp_path
):
    from app.models.ark_image_models import ArkImageResult
    from app.services import video_cover_asset_service as assets
    from app.services.video_cover_v2_service import get_document

    identifier = await project(db_session, monkeypatch, tmp_path)
    await draft(
        db_session,
        identifier,
        mode="ai",
        aspect_ratio="21:9",
        generation={"prompt": "森林", "count": 1},
    )
    provider = AsyncMock(
        return_value=(
            [ArkImageResult(image_url="https://example.com/image.png")],
            None,
        )
    )
    monkeypatch.setattr(
        ark_image_service, "generate_images_with_pack", provider
    )
    monkeypatch.setattr(
        assets, "download_image", AsyncMock(return_value=png((20, 20)))
    )
    jobs = CoverJobService(
        async_sessionmaker(db_session.bind, expire_on_commit=False)
    )
    monkeypatch.setattr(jobs, "wake", lambda: None)
    created = await jobs.submit(db_session, identifier, request())
    await jobs._dispatch()
    await asyncio.gather(*jobs._active.values())
    row = await jobs.get(db_session, identifier, created["job_id"])
    assert row.status == "succeeded"
    assert len(row.result_asset_ids) == 1
    assert (await get_document(db_session, identifier)).version == 1
    assert provider.call_count == 1
    sent = provider.call_args.args[0]
    assert (
        sent.mode,
        sent.grid_mode,
        sent.aspect_ratio,
        sent.size,
        sent.watermark,
    ) == ("basic", False, "16:9", "1280x720", True)
    assert provider.call_args.kwargs == {"defer_download": True}


@pytest.mark.asyncio
async def test_cancel_does_not_release_slot_until_worker_exits(
    db_session, monkeypatch, tmp_path
):
    started, release = asyncio.Event(), asyncio.Event()

    async def slow_provider(*args, **kwargs):
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()
        return [], None

    identifier = await project(db_session, monkeypatch, tmp_path)
    await draft(
        db_session,
        identifier,
        mode="ai",
        aspect_ratio="21:9",
        generation={"prompt": "森林", "count": 1},
    )
    monkeypatch.setattr(
        ark_image_service, "generate_images_with_pack", slow_provider
    )
    jobs = CoverJobService(
        async_sessionmaker(db_session.bind, expire_on_commit=False)
    )
    monkeypatch.setattr(jobs, "wake", lambda: None)
    created = await jobs.submit(db_session, identifier, request())
    await jobs._dispatch()
    await started.wait()
    await jobs.cancel(db_session, identifier, job_id=created["job_id"])
    await jobs.cancel(db_session, identifier, job_id=created["job_id"])
    assert len(jobs._active) == 1
    release.set()
    await asyncio.gather(*jobs._active.values())
    assert not jobs._active
    row = await jobs.get(db_session, identifier, created["job_id"])
    assert row.status == "cancelled" and row.result_asset_ids == []


@pytest.mark.asyncio
async def test_ark_default_keeps_legacy_download_behavior(
    monkeypatch, tmp_path
):
    import httpx

    monkeypatch.setattr(ark_image_service.settings, "ark_api_key", "fixture")
    monkeypatch.setattr(
        ark_image_service.settings.storage, "root", str(tmp_path)
    )
    monkeypatch.setattr(
        ark_image_service,
        "_resolve_multi_references",
        AsyncMock(return_value=(None, "森林")),
    )
    post = AsyncMock(
        return_value=httpx.Response(
            200,
            request=httpx.Request("POST", "https://example.com"),
            json={"data": [{"url": "https://example.com/image.png"}]},
        )
    )
    get = AsyncMock(
        return_value=httpx.Response(
            200,
            request=httpx.Request("GET", "https://example.com/image.png"),
            content=png((20, 20)),
        )
    )
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    result, _ = await ark_image_service.generate_images_with_pack(
        ArkImageGenerateRequest(prompt="森林")
    )
    assert result[0].local_url.startswith("/api/storage/files/images/ark/")
    assert get.call_count == 1
    assert list(tmp_path.rglob("*.png"))


@pytest.mark.asyncio
async def test_global_execution_slots_and_project_serialization(
    db_session, monkeypatch, tmp_path
):
    entered, release = asyncio.Queue(), asyncio.Event()

    async def provider(*args, **kwargs):
        await entered.put(True)
        await release.wait()
        return [], None

    monkeypatch.setattr(
        ark_image_service, "generate_images_with_pack", provider
    )
    jobs = CoverJobService(
        async_sessionmaker(db_session.bind, expire_on_commit=False)
    )
    monkeypatch.setattr(jobs, "wake", lambda: None)
    identifiers = []
    for _ in range(3):
        identifier = await project(db_session, monkeypatch, tmp_path)
        identifiers.append(identifier)
        await draft(
            db_session,
            identifier,
            mode="ai",
            aspect_ratio="21:9",
            generation={"prompt": "森林", "count": 1},
        )
        await jobs.submit(db_session, identifier, request())
    await jobs.submit(db_session, identifiers[0], request("second"))
    await jobs._dispatch()
    await entered.get()
    await entered.get()
    assert len(jobs._active) == len(jobs._active_projects) == 2
    release.set()
    await asyncio.gather(*jobs._active.values())
    await jobs._dispatch()
    await asyncio.gather(*jobs._active.values())
    assert not jobs._active


@pytest.mark.asyncio
async def test_delete_during_download_never_resurrects_assets(
    db_session, monkeypatch, tmp_path
):
    from app.models.ark_image_models import ArkImageResult
    from app.services import video_cover_asset_service as assets
    from app.services.video_project_service import video_project_service
    from app.constants import LOCAL_OWNER_ID

    downloading, release = asyncio.Event(), asyncio.Event()

    async def download(url):
        downloading.set()
        await release.wait()
        return png((20, 20))

    identifier = await project(db_session, monkeypatch, tmp_path)
    await draft(
        db_session,
        identifier,
        mode="ai",
        aspect_ratio="21:9",
        generation={"prompt": "森林", "count": 1},
    )
    monkeypatch.setattr(
        ark_image_service,
        "generate_images_with_pack",
        AsyncMock(
            return_value=(
                [ArkImageResult(image_url="https://example.com/image.png")],
                None,
            )
        ),
    )
    monkeypatch.setattr(assets, "download_image", download)
    jobs = CoverJobService(
        async_sessionmaker(db_session.bind, expire_on_commit=False)
    )
    monkeypatch.setattr(jobs, "wake", lambda: None)
    await jobs.submit(db_session, identifier, request())
    await jobs._dispatch()
    await downloading.wait()
    await video_project_service.delete_project(
        db_session, LOCAL_OWNER_ID, identifier
    )
    release.set()
    await asyncio.gather(*jobs._active.values())
    assert not assets.cover_directory(identifier).exists()
    assert (
        not (await db_session.execute(select(ProjectCoverJob))).scalars().all()
    )


@pytest.mark.asyncio
async def test_cancel_waits_for_local_asset_read_thread(
    db_session, monkeypatch, tmp_path
):
    from app.models.ark_image_models import ArkImageResult
    from app.services import video_cover_asset_service as assets

    started = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()
    events = []
    image = png((20, 20))

    def slow_read(path):
        loop.call_soon_threadsafe(started.set)
        release.wait(5)
        events.append("read_finished")
        return image

    identifier = await project(db_session, monkeypatch, tmp_path)
    (tmp_path / "local.png").write_bytes(image)
    await draft(
        db_session,
        identifier,
        mode="ai",
        aspect_ratio="21:9",
        generation={"prompt": "森林", "count": 1},
    )
    provider = AsyncMock(
        return_value=(
            [ArkImageResult(local_url="/api/storage/files/local.png")],
            None,
        )
    )
    monkeypatch.setattr(
        ark_image_service, "generate_images_with_pack", provider
    )
    monkeypatch.setattr(assets, "read_limited", slow_read)
    jobs = CoverJobService(
        async_sessionmaker(db_session.bind, expire_on_commit=False)
    )
    monkeypatch.setattr(jobs, "wake", lambda: None)
    created = await jobs.submit(db_session, identifier, request())
    await jobs._dispatch()
    active = list(jobs._active.values())
    active[0].add_done_callback(lambda task: events.append("worker_finished"))
    await started.wait()
    try:
        await jobs.cancel(db_session, identifier, job_id=created["job_id"])
        # 模拟磁盘读取比取消回执更晚完成，观察真实退出顺序。
        timer = loop.call_later(0.1, release.set)
        await asyncio.gather(*active)
        await asyncio.to_thread(release.wait, 5)
        timer.cancel()
    finally:
        release.set()
    assert events == ["read_finished", "worker_finished"]
