"""分镜完成状态必须继续遵守原生任务的缓存和显式重收约束。"""
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.models.ark_video_models import (
    ArkVideoGenerateRequest,
    ArkVideoStatusResponse,
)
from app.services import ark_video_service as video_service
from app.services import storyboard_video_queue as queue_module
from app.services.ark_video_task_context import VideoTaskContexts
from app.services.storyboard_video_queue import JobState, _StoryboardVideoQueue


@pytest.mark.asyncio
async def test_storyboard_artifact_failure_keeps_native_terminal_context(
    monkeypatch,
):
    manager = VideoTaskContexts()
    monkeypatch.setattr(video_service, "video_task_contexts", manager)
    monkeypatch.setattr(queue_module, "video_task_contexts", manager)
    handle = (await manager.reserve(None))[0]
    ctx = await manager.bind(handle, "native-failed")
    manager.finish(ctx, "failed", "video_download_failed")
    create = AsyncMock(return_value=video_service.VideoSubmission(
        "native-failed", "model", "revision",
    ))
    monkeypatch.setattr(video_service, "create_task", create)
    provider = AsyncMock(side_effect=AssertionError("不能隐式重新收取"))
    monkeypatch.setattr(video_service, "_read_provider", provider)
    queue = _StoryboardVideoQueue()
    job = JobState("sbv-failed", "pack", 0, 0)
    queue._jobs[job.job_id] = job
    queue._handles[job.job_id] = handle

    try:
        await queue._run_job(
            job.job_id, ArkVideoGenerateRequest(prompt="纸船"), handle,
        )
        assert job.status == "failed"
        assert manager.by_task("native-failed") is ctx
        assert manager.config_for(handle) is None
        assert (await video_service.get_status("native-failed")).status == "failed"
        provider.assert_not_awaited()
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_storyboard_ready_rechecks_deleted_cache(monkeypatch, tmp_path):
    manager = VideoTaskContexts()
    monkeypatch.setattr(video_service, "video_task_contexts", manager)
    handle = (await manager.reserve(None))[0]
    ctx = await manager.bind(handle, "native-ready")
    cached = tmp_path / "video.mp4"
    cached.write_bytes(b"verified-fixture")
    ctx.result = {
        "video_url": "/api/storage/files/cached_materials/ark/video.mp4",
        "_fingerprint": video_service.artifacts.file_fingerprint(cached),
    }
    manager.finish(ctx, "succeeded")
    cached.unlink()
    monkeypatch.setattr(
        video_service.artifacts, "lookup_cached", AsyncMock(return_value=None),
    )
    queue = _StoryboardVideoQueue()
    job = JobState(
        "sbv-ready", "pack", 0, 0, status="success", phase="ready",
        ark_task_id="native-ready", video_url=ctx.result["video_url"],
        finished_at=datetime.utcnow(),
    )
    queue._jobs[job.job_id] = job

    try:
        result = await queue.get_job(job.job_id)
        assert result.status == "failed"
        assert result.error_code == "invalid_video_artifact"
        assert result.video_url is None
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_storyboard_revalidation_continues_until_ready(monkeypatch):
    statuses = [
        ArkVideoStatusResponse(
            success=True, message="running", status="running",
            phase="validating", ark_task_id="native-ready",
        ),
        ArkVideoStatusResponse(
            success=True, message="ready", status="succeeded", phase="ready",
            ark_task_id="native-ready", duration=5.2, width=720, height=1280,
            video_url="/api/storage/files/cached_materials/ark/video.mp4",
        ),
    ]
    monkeypatch.setattr(
        video_service, "get_status", AsyncMock(side_effect=statuses),
    )
    queue = _StoryboardVideoQueue()
    job = JobState(
        "sbv-ready", "pack", 0, 0, status="success", phase="ready",
        ark_task_id="native-ready", finished_at=datetime.utcnow(),
    )
    queue._jobs[job.job_id] = job

    assert (await queue.get_job(job.job_id)).phase == "validating"
    result = await queue.get_job(job.job_id)
    assert result.status == "success" and result.phase == "ready"
    assert result.duration == 5.2 and result.height == 1280


@pytest.mark.asyncio
async def test_storyboard_explicit_retry_updates_following_queue_reads(
    monkeypatch,
):
    from app.routers.ark_video_router import get_video_status

    statuses = [
        ArkVideoStatusResponse(
            success=True, message="running", status="running",
            phase="downloading", ark_task_id="native-retry",
        ),
        ArkVideoStatusResponse(
            success=True, message="ready", status="succeeded", phase="ready",
            ark_task_id="native-retry",
            video_url="/api/storage/files/cached_materials/ark/retry.mp4",
        ),
    ]
    reader = AsyncMock(side_effect=statuses)
    monkeypatch.setattr(video_service, "get_status", reader)
    queue = _StoryboardVideoQueue()
    monkeypatch.setattr(queue_module, "storyboard_video_queue", queue)
    job = JobState(
        "sbv-retry", "pack", 0, 0, status="failed",
        ark_task_id="native-retry", error_code="video_cache_failed",
        finished_at=datetime.utcnow(),
    )
    queue._jobs[job.job_id] = job

    assert (await get_video_status(job.job_id, True)).status == "running"
    assert (await get_video_status(job.job_id)).status == "succeeded"
    assert reader.await_count == 2


@pytest.mark.asyncio
async def test_storyboard_submission_deadline_is_unknown_without_native_id(
    monkeypatch,
):
    import asyncio

    manager = VideoTaskContexts()
    monkeypatch.setattr(queue_module, "video_task_contexts", manager)
    handle = (await manager.reserve(None))[0]
    config = SimpleNamespace(timeout_seconds=0.01, poll_interval_seconds=0.01)
    monkeypatch.setattr(queue_module, "settings", SimpleNamespace(
        storyboard=SimpleNamespace(video_generation=config),
    ))

    async def pending_submission(*args, **kwargs):
        await asyncio.sleep(10)

    monkeypatch.setattr(video_service, "create_task", pending_submission)
    queue = _StoryboardVideoQueue()
    job = JobState("sbv-unknown", "pack", 0, 0)
    queue._jobs[job.job_id] = job
    queue._handles[job.job_id] = handle
    try:
        await queue._run_job(
            job.job_id, ArkVideoGenerateRequest(prompt="纸船"), handle,
        )
        assert job.error_code == "generation_submission_unknown"
        assert manager.active_count == 0
    finally:
        await manager.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("status,provider_code,expected", [
    (401, "AuthenticationError", "provider_authentication"),
    (403, "PermissionDenied", "provider_authentication"),
    (429, "TooManyRequests", "provider_rate_limited"),
    (400, "ModelNotOpen", "provider_unavailable"),
])
async def test_storyboard_preserves_controlled_submission_errors(
    monkeypatch, status, provider_code, expected,
):
    import httpx
    from app.config import settings
    from app.services.ark_video_config import resolve_video_config

    manager = VideoTaskContexts()
    monkeypatch.setattr(queue_module, "video_task_contexts", manager)
    monkeypatch.setattr(video_service, "video_task_contexts", manager)
    monkeypatch.setattr(settings, "ark_video_api_key", "fake-video-key")
    handle = (await manager.reserve(resolve_video_config()))[0]
    response = httpx.Response(
        status,
        request=httpx.Request("POST", video_service.ARK_API_BASE),
        json={"error": {
            "code": provider_code, "message": "PRIVATE-PROVIDER-BODY",
        }},
    )
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    queue = _StoryboardVideoQueue()
    job = JobState("sbv-provider-error", "pack", 0, 0)
    queue._jobs[job.job_id] = job
    queue._handles[job.job_id] = handle

    try:
        await queue._run_job(
            job.job_id, ArkVideoGenerateRequest(prompt="纸船"), handle,
        )
        assert job.status == "failed" and job.error_code == expected
        assert job.error == expected and "PRIVATE" not in repr(job)
        assert post.await_count == 1 and manager.active_count == 0
    finally:
        await manager.close()
