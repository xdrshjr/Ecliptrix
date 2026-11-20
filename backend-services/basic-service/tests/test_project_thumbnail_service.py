"""独立 SQLite 快照、真实原子缓存和保存/删除竞态。"""
import asyncio
from dataclasses import replace
import io
import os
from pathlib import Path
import subprocess
import threading
import time
from types import SimpleNamespace
from uuid import uuid4

from PIL import Image
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.constants import LOCAL_OWNER_ID
from app.models.db_models import Base, VideoProject
from app.models import effects_db_models  # 注册既有删除路径依赖的表。
from app.services import project_thumbnail_service as service
from app.services.project_thumbnail_media import ProjectThumbnailError
from app.services.video_project_service import video_project_service
from tests.test_project_thumbnail_media import local_root


def document(url="/api/storage/files/first.mp4", clip_start=0):
    return {"materials": [{"id": "m", "type": "video", "url": url}], "uiState": {
        "currentTimelineState": {"tracks": [{"type": "video", "items": [{
            "id": "item", "materialId": "m", "type": "video", "startTime": 5,
            "duration": 2, "clipStart": clip_start, "originalMaterialType": "video",
        }]}]}}}


def jpeg(color="red"):
    output = io.BytesIO()
    Image.new("RGB", (640, 360), color).save(output, "JPEG")
    return output.getvalue()


@pytest_asyncio.fixture
async def context(local_root, monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///" + (local_root / "test.db").as_posix())
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    from app.services.effects.job_service import effect_render_service
    monkeypatch.setattr(effect_render_service, "session_factory", factory)
    identifier = uuid4()
    (local_root / "first.mp4").write_bytes(b"source-one")
    async with factory() as db:
        db.add(VideoProject(id=identifier, user_id=LOCAL_OWNER_ID, name="项目",
                            project_data=document()))
        await db.commit()
    calls = []
    async def extract(source, *, deadline):
        calls.append(source)
        return jpeg()
    monkeypatch.setattr(service, "extract_thumbnail", extract)
    yield service.ProjectThumbnailService(factory), factory, identifier, calls
    await engine.dispose()


async def change(factory, identifier, data):
    async with factory() as db:
        row = await db.get(VideoProject, identifier)
        row.project_data = data
        await db.commit()


@pytest.mark.asyncio
async def test_cache_is_reused_without_touching_project(context):
    thumbnails, factory, identifier, calls = context
    async with factory() as db:
        row = await db.get(VideoProject, identifier)
        before = (row.project_data, row.cover_url, row.updated_at, row.last_opened_at)
    assert await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID) == jpeg()
    assert await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID) == jpeg()
    assert len(calls) == 1
    async with factory() as db:
        row = await db.get(VideoProject, identifier)
        assert (row.project_data, row.cover_url, row.updated_at, row.last_opened_at) == before
    assert service._generation_locks == {}


@pytest.mark.asyncio
async def test_corrupt_cache_rebuilds_and_new_trim_invalidates(context):
    thumbnails, factory, identifier, calls = context
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    directory = service.thumbnail_directory(identifier)
    next(directory.glob("*.jpg")).write_bytes(b"broken")
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    await change(factory, identifier, document(clip_start=.5))
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert len(calls) == 3
    assert len(list(directory.glob("*.jpg"))) == 2


@pytest.mark.asyncio
async def test_simultaneous_same_project_requests_decode_once(context):
    thumbnails, _, identifier, calls = context
    results = await asyncio.gather(*(thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID) for _ in range(5)))
    assert results == [jpeg()] * 5
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("delete", [False, True])
async def test_save_or_delete_while_decoding_rejects_old_result(context, monkeypatch, delete):
    thumbnails, factory, identifier, _ = context
    entered, release = asyncio.Event(), asyncio.Event()
    async def extract(source, *, deadline):
        entered.set()
        await release.wait()
        return jpeg()
    monkeypatch.setattr(service, "extract_thumbnail", extract)
    task = asyncio.create_task(thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID))
    await entered.wait()
    if delete:
        async with factory() as db:
            assert await video_project_service.delete_project(db, LOCAL_OWNER_ID, str(identifier))
    else:
        await change(factory, identifier, document(clip_start=1))
    release.set()
    with pytest.raises(ProjectThumbnailError) as error:
        await task
    assert error.value.code == ("PROJECT_NOT_FOUND" if delete else "PROJECT_THUMBNAIL_STALE")
    assert not service.thumbnail_directory(identifier).exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("hit", [False, True])
async def test_rechecks_newly_available_higher_priority_source(context, monkeypatch, hit, local_root):
    thumbnails, factory, identifier, _ = context
    data = document()
    data["materials"][0]["cacheUrl"] = "/api/storage/files/priority.mp4"
    await change(factory, identifier, data)
    if hit:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
        original = service._read_cache
        def read(*args):
            result = original(*args)
            (local_root / "priority.mp4").write_bytes(b"new-priority")
            return result
        monkeypatch.setattr(service, "_read_cache", read)
    else:
        async def extract(source, *, deadline):
            (local_root / "priority.mp4").write_bytes(b"new-priority")
            return jpeg()
        monkeypatch.setattr(service, "extract_thumbnail", extract)
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_STALE"


@pytest.mark.asyncio
async def test_retention_recovery_and_project_deletion_preserve_other_assets(context):
    thumbnails, factory, identifier, _ = context
    for trim in range(5):
        await change(factory, identifier, document(clip_start=trim))
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    directory = service.thumbnail_directory(identifier)
    assert len(list(directory.glob("*.jpg"))) == 3
    extra = directory / ("0" * 64 + ".jpg")
    extra.write_bytes(jpeg())
    part = directory / ("1" * 64 + f".{uuid4()}.part")
    part.write_bytes(b"unfinished")
    os.utime(part, (0, 0))
    sentinel = directory.parent / "effects" / "keep.txt"
    sentinel.parent.mkdir()
    sentinel.write_text("keep")
    service.recover_project_thumbnails(identifier, True)
    assert len(list(directory.glob("*.jpg"))) == 3 and not part.exists()
    service.cleanup_project_thumbnails(identifier)
    assert not directory.exists() and sentinel.read_text() == "keep"


@pytest.mark.asyncio
async def test_failed_publish_never_leaves_partial_jpeg(context, monkeypatch):
    thumbnails, _, identifier, _ = context
    def fail(*args):
        raise OSError("写盘失败")
    monkeypatch.setattr(service.os, "replace", fail)
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_STORAGE_UNAVAILABLE"
    assert list(service.thumbnail_directory(identifier).iterdir()) == []


@pytest.mark.asyncio
async def test_hardlinked_cache_is_rejected_without_touching_target(context, local_root):
    thumbnails, _, identifier, _ = context
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    cache = next(service.thumbnail_directory(identifier).glob("*.jpg"))
    target = local_root / "untouched.jpg"
    os.link(cache, target)
    before = target.stat().st_mtime_ns
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_STORAGE_UNAVAILABLE"
    service.cleanup_project_thumbnails(identifier)
    assert target.stat().st_mtime_ns == before


@pytest.mark.asyncio
@pytest.mark.parametrize("layer", ["projects", "project", "thumbnails"])
async def test_windows_junction_cannot_redirect_cache(context, local_root, layer):
    if os.name != "nt":
        pytest.skip("此用例验证 Windows 真 junction")
    thumbnails, _, identifier, _ = context
    directory = service.thumbnail_directory(identifier)
    link = {"projects": directory.parent.parent, "project": directory.parent,
            "thumbnails": directory}[layer]
    link.parent.mkdir(parents=True, exist_ok=True)
    target = local_root / "retained-assets" / str(uuid4()) / "covers"
    target.mkdir(parents=True)
    sentinel = target / "keep.jpg"
    sentinel.write_bytes(jpeg())
    before = sentinel.stat().st_mtime_ns
    result = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True)
    assert result.returncode == 0
    try:
        with pytest.raises(ProjectThumbnailError) as error:
            await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
        assert error.value.code == "PROJECT_THUMBNAIL_STORAGE_UNAVAILABLE"
        with pytest.raises(OSError):
            service.cleanup_project_thumbnails(identifier)
        assert sentinel.read_bytes() == jpeg() and sentinel.stat().st_mtime_ns == before
    finally:
        link.rmdir()


@pytest.mark.asyncio
async def test_repeated_cancellation_waits_for_real_write_before_delete(context, monkeypatch):
    thumbnails, factory, identifier, _ = context
    entered, release = threading.Event(), threading.Event()
    original = service._write_cache
    def blocked(*args):
        entered.set()
        assert release.wait(5)
        return original(*args)
    monkeypatch.setattr(service, "_write_cache", blocked)
    request = asyncio.create_task(thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID))
    while not entered.is_set():
        await asyncio.sleep(.01)
    request.cancel()
    request.cancel()
    async def delete():
        async with factory() as db:
            return await video_project_service.delete_project(db, LOCAL_OWNER_ID, str(identifier))
    deletion = asyncio.create_task(delete())
    await asyncio.sleep(.03)
    request.cancel()
    assert not deletion.done()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await request
    assert await deletion
    assert not service.thumbnail_directory(identifier).exists()
    assert service._generation_locks == {}


@pytest.mark.asyncio
async def test_failed_delete_commit_preserves_thumbnail(context, monkeypatch):
    thumbnails, factory, identifier, _ = context
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    path = next(service.thumbnail_directory(identifier).glob("*.jpg"))
    async with factory() as db:
        original, commits = db.commit, 0
        async def fail_final_commit():
            nonlocal commits
            commits += 1
            if commits == 2:
                raise RuntimeError("数据库删除提交失败")
            await original()
        monkeypatch.setattr(db, "commit", fail_final_commit)
        with pytest.raises(RuntimeError):
            await video_project_service.delete_project(db, LOCAL_OWNER_ID, str(identifier))
    assert path.read_bytes() == jpeg()
    async with factory() as db:
        assert await db.get(VideoProject, identifier) is not None


@pytest.mark.asyncio
async def test_budget_expiring_at_shared_lock_prevents_decoding(context, monkeypatch):
    thumbnails, _, identifier, calls = context
    from app.services.video_cover_asset_service import project_locks
    monkeypatch.setattr(service, "WORK_BUDGET", .03)
    async with project_locks(identifier):
        with pytest.raises(ProjectThumbnailError) as error:
            await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_TIMEOUT"
    assert calls == [] and service._generation_locks == {}


@pytest.mark.asyncio
async def test_generation_lock_busy_reclaims_waiter(context, monkeypatch):
    thumbnails, _, identifier, _ = context
    entered, release = asyncio.Event(), asyncio.Event()
    async def blocked(*args, **kwargs):
        entered.set()
        await release.wait()
        return jpeg()
    monkeypatch.setattr(service, "extract_thumbnail", blocked)
    monkeypatch.setattr(service, "GENERATION_LOCK_TIMEOUT", .03)
    request = asyncio.create_task(thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID))
    await entered.wait()
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_BUSY"
    release.set()
    await request
    assert service._generation_locks == {}


@pytest.mark.asyncio
async def test_budget_expiring_during_atomic_write_waits_before_returning(context, monkeypatch):
    _, _, identifier, _ = context
    entered, release = threading.Event(), threading.Event()
    def delayed(*args):
        entered.set()
        assert release.wait(5)
        service._write_cache(*args)
    # 先通过屏障确认真实写盘线程已启动，再使剩余预算到期；避免机器
    # 负载使预算在 SQLite 阶段耗尽，误把未启动写盘当作线程清理失败。
    async with service._generation_lock(str(identifier), time.monotonic() + 5):
        async with service._project_lock(str(identifier), time.monotonic() + 5):
            operation = asyncio.create_task(service.run_blocking(delayed, str(identifier), "1" * 64, jpeg()))
            while not entered.is_set():
                await asyncio.sleep(.001)
            timer = asyncio.get_running_loop().call_later(.08, release.set)
            started = time.monotonic()
            try:
                with pytest.raises(ProjectThumbnailError) as error:
                    await service.within_budget(operation, started + .02)
            finally:
                release.set()
                timer.cancel()
    assert error.value.code == "PROJECT_THUMBNAIL_TIMEOUT"
    assert time.monotonic() - started >= .06
    assert len(list(service.thumbnail_directory(identifier).glob("*.jpg"))) == 1
    assert service._generation_locks == {}


@pytest.mark.asyncio
async def test_recovery_isolates_thumbnail_io_failure_and_cleans_orphans(context, monkeypatch):
    thumbnails, factory, identifier, _ = context
    from app.services import video_cover_asset_service as assets
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    orphan = uuid4()
    directory = service.thumbnail_directory(orphan, create=True)
    (directory / ("0" * 64 + ".jpg")).write_bytes(jpeg())
    original = service.recover_project_thumbnails
    seen = []
    def recover(project_id, is_live):
        seen.append(str(project_id))
        if str(project_id) == str(identifier):
            raise PermissionError("不可访问目录")
        original(project_id, is_live)
    monkeypatch.setattr(service, "recover_project_thumbnails", recover)
    async with factory() as db:
        await assets.recover_storage(db)
    assert set(seen) == {str(identifier), str(orphan)}
    assert not directory.exists()


@pytest.mark.asyncio
async def test_source_replacement_during_decode_is_stale(context, monkeypatch, local_root):
    thumbnails, _, identifier, _ = context
    async def extract(*args, **kwargs):
        (local_root / "first.mp4").write_bytes(b"replaced-source-with-new-size")
        return jpeg()
    monkeypatch.setattr(service, "extract_thumbnail", extract)
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_STALE"
    assert not service.thumbnail_directory(identifier).exists()


@pytest.mark.asyncio
async def test_renaming_and_playhead_changes_reuse_cache(context):
    thumbnails, factory, identifier, calls = context
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    async with factory() as db:
        row = await db.get(VideoProject, identifier)
        row.name = "重命名"
        data = document()
        data["uiState"]["currentTimelineState"]["currentTime"] = 100
        row.project_data = data
        await db.commit()
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_first_missing_source_does_not_skip_to_later_video(context, local_root):
    thumbnails, factory, identifier, calls = context
    data = document("/api/storage/files/missing.mp4")
    data["materials"].append({"id": "later", "type": "video", "url": "/api/storage/files/first.mp4"})
    data["uiState"]["currentTimelineState"]["tracks"][0]["items"].append({
        "id": "later", "materialId": "later", "type": "video", "startTime": 10,
        "duration": 2, "originalMaterialType": "video"})
    await change(factory, identifier, data)
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_SOURCE_UNAVAILABLE" and calls == []


@pytest.mark.asyncio
async def test_delete_during_cached_read_does_not_return_old_image(context, monkeypatch):
    thumbnails, factory, identifier, _ = context
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    entered, release = threading.Event(), threading.Event()
    original = service._read_cache
    def blocked(*args):
        data = original(*args)
        entered.set()
        assert release.wait(5)
        return data
    monkeypatch.setattr(service, "_read_cache", blocked)
    request = asyncio.create_task(thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID))
    while not entered.is_set():
        await asyncio.sleep(.01)
    try:
        async with factory() as db:
            assert await video_project_service.delete_project(db, LOCAL_OWNER_ID, str(identifier))
    finally:
        release.set()
    with pytest.raises(ProjectThumbnailError) as error:
        await request
    assert error.value.code == "PROJECT_NOT_FOUND"
    assert not service.thumbnail_directory(identifier).exists()


@pytest.mark.asyncio
async def test_cancel_simultaneous_with_generation_lock_acquisition_releases_lock():
    caller = None
    class CancellingLock(asyncio.Lock):
        async def acquire(self):
            result = await super().acquire()
            caller.cancel()
            return result
    key, lock = str(uuid4()), CancellingLock()
    service._generation_locks[key] = service._GenerationLock(lock)
    async def request():
        async with service._generation_lock(key, time.monotonic() + 1):
            return "不应开始业务工作"
    caller = asyncio.create_task(request())
    with pytest.raises(asyncio.CancelledError):
        await caller
    assert not lock.locked() and key not in service._generation_locks


@pytest.mark.asyncio
async def test_cancel_simultaneous_with_shared_lock_entry_releases_lock(monkeypatch):
    from contextlib import asynccontextmanager
    caller, lock = None, asyncio.Lock()
    @asynccontextmanager
    async def project_lock(*args):
        async with lock:
            caller.cancel()
            yield
    monkeypatch.setattr(service, "project_locks", project_lock)
    async def request():
        async with service._project_lock(str(uuid4()), time.monotonic() + 1):
            return "不应开始业务工作"
    caller = asyncio.create_task(request())
    with pytest.raises(asyncio.CancelledError):
        await caller
    assert not lock.locked()


@pytest.mark.asyncio
@pytest.mark.parametrize("hit", [False, True])
async def test_ready_download_cache_remapping_is_stale(context, local_root, monkeypatch, hit):
    from app.services import project_thumbnail_media as media
    thumbnails, factory, identifier, _ = context
    await change(factory, identifier, document("https://example.com/current.mp4"))
    (local_root / "second.mp4").write_bytes(b"second-local-source")
    current = ["/api/storage/files/first.mp4"]
    class Cache:
        async def lookup_async(self, **kwargs):
            return SimpleNamespace(status="ready")
        def local_url_for(self, row):
            return current[0]
    monkeypatch.setattr(media, "get_material_download_service", Cache)
    if hit:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
        original = service._read_cache
        def read(*args):
            data = original(*args)
            current[0] = "/api/storage/files/second.mp4"
            return data
        monkeypatch.setattr(service, "_read_cache", read)
    else:
        async def extract(*args, **kwargs):
            current[0] = "/api/storage/files/second.mp4"
            return jpeg()
        monkeypatch.setattr(service, "extract_thumbnail", extract)
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_STALE"


@pytest.mark.asyncio
async def test_final_source_lookup_respects_remaining_budget(context, monkeypatch):
    from app.services import project_thumbnail_media as media
    thumbnails, factory, identifier, _ = context
    await change(factory, identifier, document("https://example.com/current.mp4"))
    class Cache:
        calls = 0
        async def lookup_async(self, **kwargs):
            self.calls += 1
            if self.calls > 1:
                await asyncio.sleep(.2)
            return SimpleNamespace(status="ready")
        def local_url_for(self, row):
            return "/api/storage/files/first.mp4"
    cache = Cache()
    monkeypatch.setattr(media, "get_material_download_service", lambda: cache)
    monkeypatch.setattr(service, "WORK_BUDGET", .08)
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_TIMEOUT"
    assert not service.thumbnail_directory(identifier).exists()
    assert service._generation_locks == {}


@pytest.mark.asyncio
async def test_symlink_cache_is_rejected_without_touching_cover(context, local_root):
    thumbnails, _, identifier, _ = context
    await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    cache = next(service.thumbnail_directory(identifier).glob("*.jpg"))
    target = cache.parent.parent / "covers" / "keep.jpg"
    target.parent.mkdir()
    target.write_bytes(jpeg())
    before = target.stat().st_mtime_ns
    cache.unlink()
    try:
        os.symlink(target, cache)
    except OSError:
        pytest.skip("当前账户无符号链接权限；真 junction 与硬链接另有用例")
    with pytest.raises(ProjectThumbnailError) as error:
        await thumbnails.get_thumbnail(identifier, LOCAL_OWNER_ID)
    assert error.value.code == "PROJECT_THUMBNAIL_STORAGE_UNAVAILABLE"
    service.cleanup_project_thumbnails(identifier)
    assert target.read_bytes() == jpeg() and target.stat().st_mtime_ns == before
