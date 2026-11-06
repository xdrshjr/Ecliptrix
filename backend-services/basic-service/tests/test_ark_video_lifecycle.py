"""任务容量、配置生命周期和上游错误行为。"""
import asyncio
from types import SimpleNamespace

import pytest


def config():
    return SimpleNamespace(api_key="fake-video-secret", model_id="model", config_revision="revision")


@pytest.mark.asyncio
async def test_reservation_is_atomic_with_one_remaining_slot():
    from app.services.ark_video_task_context import VideoTaskContexts
    from app.services.credential_errors import VideoError
    manager = VideoTaskContexts(capacity=1)
    values = await asyncio.gather(manager.reserve(config()), manager.reserve(config()), return_exceptions=True)
    assert sum(isinstance(item, VideoError) for item in values) == 1
    assert manager.active_count == 1
    await manager.close()


@pytest.mark.asyncio
async def test_inflight_task_keeps_original_key_and_never_returns_cdn(monkeypatch, tmp_path):
    import httpx
    from app.config import settings
    from app.models.ark_video_models import ArkVideoGenerateRequest
    from app.services import ark_video_service as service
    from app.services.ark_video_task_context import VideoTaskContexts
    manager = VideoTaskContexts()
    monkeypatch.setattr(service, "video_task_contexts", manager)
    monkeypatch.setattr(settings, "ark_video_api_key", "old-video-key")
    calls = []
    async def post(client, url, **kwargs):
        calls.append(kwargs["headers"]["Authorization"])
        return httpx.Response(200, json={"id": "native"}, request=httpx.Request("POST", url))
    async def get(client, url, **kwargs):
        calls.append(kwargs["headers"]["Authorization"])
        return httpx.Response(200, json={"status": "succeeded", "content": {"video_url": "https://example.com/video.mp4"}})
    gate = asyncio.Event()
    path = tmp_path / "verified.mp4"
    path.write_bytes(b"fixture")
    async def collect(*args, **kwargs):
        await gate.wait()
        return {"video_url": "/api/storage/files/cached_materials/ark/native.mp4", "duration": 5.08,
                "width": 720, "height": 1280, "_fingerprint": service.artifacts.file_fingerprint(path)}
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    monkeypatch.setattr(service.artifacts, "collect_artifact", collect)
    submission = await service.create_task(ArkVideoGenerateRequest(prompt="纸船"))
    monkeypatch.setattr(settings, "ark_video_api_key", "new-video-key")
    status = await service.get_status(submission.task_id)
    assert (status.status, status.phase, status.video_url) == ("running", "downloading", None)
    await service.get_status(submission.task_id)
    assert calls == ["Bearer old-video-key", "Bearer old-video-key"]
    assert manager.config_for(manager.by_task("native").handle) is None
    gate.set()
    await manager.by_task("native").worker
    ready = await service.get_status("native")
    assert ready.phase == "ready" and ready.height == 1280
    await manager.close()


@pytest.mark.asyncio
async def test_late_status_cannot_revive_expired_context(monkeypatch):
    from app.services import ark_video_service as service
    from app.services.ark_video_task_context import VideoTaskContexts
    manager = VideoTaskContexts()
    monkeypatch.setattr(service, "video_task_contexts", manager)
    handle = (await manager.reserve(config()))[0]
    ctx = await manager.bind(handle, "native")
    manager.finish(ctx, "timeout", "video_task_expired")
    await service._apply_provider(ctx, {"status": "succeeded", "content": {"video_url": "https://example.com/a.mp4"}})
    assert ctx.status == "timeout" and ctx.worker is None
    await manager.close()


@pytest.mark.asyncio
async def test_artifact_retry_reuses_original_without_key_or_provider(monkeypatch, tmp_path):
    from app.services import ark_video_service as service
    from app.services.ark_video_task_context import VideoTaskContexts
    manager = VideoTaskContexts()
    monkeypatch.setattr(service, "video_task_contexts", manager)
    handle = (await manager.reserve(None))[0]
    ctx = await manager.bind(handle, "native")
    manager.finish(ctx, "failed", "video_cache_failed")
    original = tmp_path / "original.mp4"
    original.write_bytes(b"fixture")
    async def find(task_id):
        return original
    gate = asyncio.Event()
    async def collect(task_id, url, cached_path, phase):
        assert url is None and cached_path == original
        await gate.wait()
        return {"video_url": "/api/storage/files/ready.mp4"}
    monkeypatch.setattr(service.artifacts, "find_original", find)
    monkeypatch.setattr(service.artifacts, "collect_artifact", collect)
    monkeypatch.setattr(service, "resolve_video_config", lambda: pytest.fail("不能重新要求 Key"))
    status = await service.get_status("native", retry_artifact=True)
    assert status.status == "running"
    gate.set()
    await ctx.worker
    await manager.close()
    assert manager.active_count == 0


@pytest.mark.asyncio
async def test_over_capacity_batch_is_all_or_nothing():
    from app.services.ark_video_task_context import VideoTaskContexts
    from app.services.credential_errors import VideoError
    manager = VideoTaskContexts(capacity=2)
    with pytest.raises(VideoError):
        await manager.reserve(config(), count=3)
    assert manager.active_count == 0


@pytest.mark.asyncio
async def test_invalid_original_explicit_retry_refreshes_only_same_task(monkeypatch, tmp_path):
    from unittest.mock import AsyncMock
    from app.services import ark_video_service as service
    from app.services.ark_video_task_context import VideoTaskContexts
    from app.services.credential_errors import VideoError
    manager = VideoTaskContexts()
    monkeypatch.setattr(service, "video_task_contexts", manager)
    handle = (await manager.reserve(None))[0]
    ctx = await manager.bind(handle, "native")
    manager.finish(ctx, "failed", "invalid_video_artifact")
    monkeypatch.setattr(service.artifacts, "find_original", AsyncMock(return_value=tmp_path / "bad.mp4"))
    collector = AsyncMock(side_effect=[VideoError("invalid_video_artifact"), {"video_url": "/api/storage/files/ready.mp4"}])
    reader = AsyncMock(return_value={"status": "succeeded", "content": {"video_url": "https://example.com/video.mp4"}})
    monkeypatch.setattr(service.artifacts, "collect_artifact", collector)
    monkeypatch.setattr(service, "_read_provider", reader)
    monkeypatch.setattr(service, "resolve_video_config", config)
    await service.get_status("native", retry_artifact=True)
    await ctx.worker
    reader.assert_awaited_once_with("native", "fake-video-secret")
    assert collector.await_count == 2 and ctx.status == "succeeded"
    await manager.close()


@pytest.mark.asyncio
async def test_terminal_context_releases_secret_and_ttl_reaps_worker():
    from app.services.ark_video_task_context import VideoTaskContexts
    manager = VideoTaskContexts(capacity=3, ttl=0.01)
    first, second = await manager.reserve(config(), count=2)
    await manager.bind(first, "first")
    manager.drop_secret(first)
    assert manager.config_for(first) is None
    assert manager.config_for(second).api_key == "fake-video-secret"
    ctx = manager.context(second)
    ctx.worker = asyncio.create_task(asyncio.sleep(10))
    await asyncio.sleep(0.02)
    await manager.reap()
    assert ctx.status == "timeout"
    assert manager.config_for(second) is None
    assert ctx.worker is None or ctx.worker.done()
    await manager.close()


@pytest.mark.asyncio
async def test_submission_network_failure_is_unknown_and_never_retried(
    monkeypatch,
):
    import httpx
    from unittest.mock import AsyncMock
    from app.config import settings
    from app.models.ark_video_models import ArkVideoGenerateRequest
    from app.services import ark_video_service as service
    from app.services.ark_video_task_context import VideoTaskContexts
    from app.services.credential_errors import VideoError

    manager = VideoTaskContexts()
    monkeypatch.setattr(service, "video_task_contexts", manager)
    monkeypatch.setattr(settings, "ark_video_api_key", "fake-video-key")
    post = AsyncMock(side_effect=httpx.ReadTimeout("response lost"))
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    try:
        with pytest.raises(VideoError) as error:
            await service.create_task(ArkVideoGenerateRequest(prompt="纸船"))
        assert error.value.code == "generation_submission_unknown"
        assert error.value.details["retryable"] is False
        assert manager.active_count == 0 and post.await_count == 1
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_completed_cache_revalidation_has_a_fresh_local_deadline(
    monkeypatch, tmp_path,
):
    from unittest.mock import AsyncMock
    from app.services import ark_video_service as service
    from app.services.ark_video_task_context import VideoTaskContexts

    manager = VideoTaskContexts()
    monkeypatch.setattr(service, "video_task_contexts", manager)
    handle = (await manager.reserve(None))[0]
    ctx = await manager.bind(handle, "old-ready")
    ctx.created_at -= manager.ttl + 1
    cached = tmp_path / "cached.mp4"
    cached.write_bytes(b"changed-fixture")
    manager.finish(ctx, "succeeded")
    gate = asyncio.Event()

    async def collect(*args, **kwargs):
        await gate.wait()
        return {"video_url": "/api/storage/files/cache.mp4"}

    monkeypatch.setattr(service.artifacts, "collect_artifact", collect)
    monkeypatch.setattr(
        service.artifacts, "lookup_cached", AsyncMock(return_value=cached),
    )
    try:
        assert (await service.get_status("old-ready")).phase == "validating"
        assert (await service.get_status("old-ready")).status == "running"
    finally:
        await manager.close()
