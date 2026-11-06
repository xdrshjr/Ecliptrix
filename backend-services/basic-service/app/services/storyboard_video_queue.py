"""分镜视频队列：排队冻结配置，直到本地 ready 才释放执行名额。"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.config import settings
from app.models.ark_video_models import (
    ArkVideoGenerateRequest, ArkVideoStatusResponse,
)
from app.services import ark_video_service
from app.services.ark_video_config import resolve_video_config
from app.services.ark_video_payload import build_payload
from app.services.ark_video_task_context import video_task_contexts
from app.services.credential_errors import VideoError
from app.services.queue_manager import queue_manager

QUEUE_NAME = "storyboard_video_generation"


@dataclass
class JobState:
    job_id: str
    pack_id: str
    frame_index: int
    repeat_index: int
    status: str = "queued"
    phase: str | None = "queued"
    model: str | None = None
    ark_task_id: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    error: str | None = None
    error_code: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None


class _StoryboardVideoQueue:
    def __init__(self) -> None:
        self._jobs: dict[str, JobState] = {}
        self._handles: dict[str, str] = {}
        self._workers: dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None
        self._initialized = False

    async def initialize(self) -> None:
        if self._initialized:
            return
        await queue_manager.create_queue(QUEUE_NAME, max_concurrent=settings.storyboard.video_generation.max_concurrent)
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        self._initialized = True

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(60)
            cutoff = datetime.utcnow() - timedelta(seconds=settings.storyboard.video_generation.job_retention_seconds)
            for job_id in list(self._jobs):
                job = self._jobs.get(job_id)
                if job and job.status == "queued":
                    job = await self.get_job(job_id)
                if job and job.finished_at and job.finished_at < cutoff:
                    self._jobs.pop(job_id, None)

    async def close(self) -> None:
        if self._cleanup_task:
            self._cleanup_task.cancel()
            await asyncio.gather(self._cleanup_task, return_exceptions=True)
            self._cleanup_task = None
        for job_id in list(self._handles):
            await self.cancel(job_id)
        self._initialized = False

    async def cancel(self, job_id: str) -> None:
        await queue_manager.cancel_task(job_id)
        worker = self._workers.get(job_id)
        if worker and worker is not asyncio.current_task():
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
        handle = self._handles.pop(job_id, None)
        if handle:
            await video_task_contexts.release(handle)
        job = self._jobs.get(job_id)
        if job and job.finished_at is None:
            self._fail(job, "video_wait_cancelled")

    async def enqueue(self, *, pack_id: str, frame_index: int, repeat_index: int,
                      description: str, duration: int, frame_data_uri: str,
                      context_handle: str | None = None) -> str:
        request = ArkVideoGenerateRequest(prompt=description, duration=duration, image_urls=[frame_data_uri])
        if context_handle is None:
            config = resolve_video_config()
            await build_payload(request, config)
            context_handle = (await video_task_contexts.reserve(config))[0]
        try:
            await self.initialize()
            ctx = video_task_contexts.context(context_handle)
            job_id = f"sbv-{uuid.uuid4().hex}"
            self._jobs[job_id] = JobState(job_id, pack_id, frame_index, repeat_index, model=ctx.model)
            self._handles[job_id] = context_handle
            await queue_manager.enqueue_task(
                QUEUE_NAME, self._run_job,
                task_args=(job_id, request, context_handle), task_id=job_id,
                metadata={"pack_id": pack_id, "frame_index": frame_index, "repeat_index": repeat_index},
            )
            return job_id
        except BaseException:
            await video_task_contexts.release(context_handle)
            if "job_id" in locals():
                self._handles.pop(job_id, None)
                self._jobs.pop(job_id, None)
            raise

    @staticmethod
    def _fail(job: JobState, code: str, status: str = "failed") -> None:
        job.status, job.error, job.error_code = status, code, code
        job.finished_at = datetime.utcnow()

    async def _run_job(self, job_id: str, request: ArkVideoGenerateRequest, context_handle: str) -> None:
        job = self._jobs.get(job_id)
        if job is None:
            await video_task_contexts.release(context_handle)
            return
        self._workers[job_id] = asyncio.current_task()
        job.status, job.started_at = "generating", datetime.utcnow()
        cfg = settings.storyboard.video_generation
        try:
            async with asyncio.timeout(cfg.timeout_seconds):
                submission = await ark_video_service.create_task(request, context_handle=context_handle)
                job.ark_task_id, job.model = submission.task_id, submission.model_id
                await self._poll(job, cfg.poll_interval_seconds)
        except TimeoutError:
            if job.ark_task_id:
                self._fail(job, "video_wait_timeout", "timeout")
            else:
                self._fail(job, "generation_submission_unknown")
        except asyncio.CancelledError:
            self._fail(job, "video_wait_cancelled")
            raise
        except Exception as error:
            code = error.code if isinstance(error, VideoError) else "video_generation_failed"
            self._fail(job, code, "timeout" if code == "video_task_expired" else "failed")
        finally:
            ctx = video_task_contexts.by_task(job.ark_task_id)
            # 保留已脱敏的终态，普通查询不能重新触发失败产物下载。
            if ctx is None or ctx.finished_at is None:
                await video_task_contexts.release(context_handle)
            self._handles.pop(job_id, None)
            self._workers.pop(job_id, None)

    def _apply_status(
        self, job: JobState, status: ArkVideoStatusResponse,
    ) -> bool:
        job.phase, job.model = status.phase, status.model
        ready = (
            status.status == "succeeded" and status.phase == "ready"
            and bool(status.video_url)
        )
        for key in ("video_url", "thumbnail_url", "duration", "width", "height"):
            setattr(job, key, getattr(status, key) if ready else None)
        if ready:
            job.status = "success"
            job.error = job.error_code = None
            job.finished_at = job.finished_at or datetime.utcnow()
            return True
        if status.status in ("failed", "timeout"):
            self._fail(
                job, status.error_code or "video_generation_failed",
                status.status,
            )
            return True
        job.status = "generating"
        job.error = job.error_code = None
        return False

    async def retry_artifact(self, job: JobState) -> ArkVideoStatusResponse:
        """显式重收同一任务，并让后续分镜查询跟随其本地状态。"""
        status = await ark_video_service.get_status(
            job.ark_task_id, retry_artifact=True,
        )
        if not self._apply_status(job, status):
            job.finished_at = None
        return status

    async def _poll(self, job: JobState, interval: float) -> None:
        failures = 0
        while True:
            try:
                status = await ark_video_service.get_status(job.ark_task_id)
            except VideoError as error:
                failures += 1
                if not error.details.get("retryable") or failures > 3:
                    raise
                delay = error.details.get("retry_after_seconds", (5, 10, 20)[failures - 1])
                if delay > 60:
                    raise
                await asyncio.sleep(delay)
                continue
            failures = 0
            if self._apply_status(job, status):
                return
            await asyncio.sleep(interval)

    async def get_job(self, job_id: str) -> JobState | None:
        job = self._jobs.get(job_id)
        if job and job.ark_task_id and (
            job.status == "success"
            or (job.status == "generating" and job_id not in self._workers)
        ):
            # 缓存删改或上下文淘汰后，分镜也必须重新验证本地 ready。
            status = await ark_video_service.get_status(job.ark_task_id)
            self._apply_status(job, status)
        if job and job.status == "queued":
            task = await queue_manager.get_task_status(job_id)
            handle = self._handles.get(job_id)
            if task and getattr(task.status, "value", task.status) == "cancelled":
                await self.cancel(job_id)
            elif handle:
                try:
                    ctx = video_task_contexts.context(handle)
                    expired = ctx.finished_at is not None
                except VideoError:
                    expired = True
                if expired:
                    await self.cancel(job_id)
                    self._fail(job, "video_task_expired", "timeout")
        return job

    async def list_jobs(self, job_ids: list[str]) -> list[JobState | None]:
        return [await self.get_job(job_id) for job_id in job_ids]

    async def position_in_queue(self, job_id: str) -> int | None:
        task = await queue_manager.get_task_status(job_id)
        if task and getattr(task.status, "value", task.status) == "queued":
            return task.position_in_queue
        return None

    def jobs_snapshot(self) -> dict[str, JobState]:
        return dict(self._jobs)


storyboard_video_queue = _StoryboardVideoQueue()
