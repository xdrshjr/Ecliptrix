"""进程内任务预留及有期限的私有凭证快照。"""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field
from uuid import uuid4

from app.services.ark_video_config import VideoRuntimeConfig
from app.services.credential_errors import VideoError


def validate_task_id(task_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", task_id):
        raise VideoError("video_parameters_unsupported", field="task_id")
    return task_id


@dataclass
class VideoTaskContext:
    handle: str
    snapshot_id: str | None
    model: str | None
    config_revision: str | None
    created_at: float = field(default_factory=time.monotonic)
    task_id: str | None = None
    status: str = "queued"
    phase: str | None = "queued"
    result: dict = field(default_factory=dict)
    error_code: str | None = None
    finished_at: float | None = None
    retry_at: float = 0
    worker: asyncio.Task | None = field(default=None, repr=False)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


class VideoTaskContexts:
    def __init__(self, capacity: int = 200, ttl: float = 1800) -> None:
        self.capacity = capacity
        self.ttl = ttl
        self._contexts: dict[str, VideoTaskContext] = {}
        self._tasks: dict[str, str] = {}
        self._snapshots: dict[str, tuple[VideoRuntimeConfig, int]] = {}
        self._lock = asyncio.Lock()
        self._reaper: asyncio.Task | None = None

    @property
    def active_count(self) -> int:
        return sum(ctx.finished_at is None for ctx in self._contexts.values())

    async def start(self) -> None:
        if self._reaper is None or self._reaper.done():
            self._reaper = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(60)
            await self.reap()

    async def reserve(self, config: VideoRuntimeConfig | None, count: int = 1) -> list[str]:
        await self.reap()
        async with self._lock:
            for handle, ctx in list(self._contexts.items()):
                if len(self._contexts) + count <= self.capacity:
                    break
                if ctx.finished_at is not None and not ctx.lock.locked():
                    self._remove(handle)
            if count < 1 or len(self._contexts) + count > self.capacity:
                raise VideoError("video_task_capacity", status_code=429, retryable=False)
            snapshot_id = str(uuid4()) if config else None
            if snapshot_id:
                self._snapshots[snapshot_id] = (config, count)
            handles = []
            for _ in range(count):
                handle = str(uuid4())
                self._contexts[handle] = VideoTaskContext(
                    handle, snapshot_id, config.model_id if config else None,
                    config.config_revision if config else None,
                )
                handles.append(handle)
            return handles

    def context(self, handle: str) -> VideoTaskContext:
        ctx = self._contexts.get(handle)
        if ctx is None:
            raise VideoError("video_task_expired", status_code=410, retryable=False)
        return ctx

    def by_task(self, task_id: str) -> VideoTaskContext | None:
        return self._contexts.get(self._tasks.get(task_id, ""))

    def config_for(self, handle: str) -> VideoRuntimeConfig | None:
        ctx = self.context(handle)
        entry = self._snapshots.get(ctx.snapshot_id or "")
        return entry[0] if entry else None

    async def bind(self, handle: str, task_id: str) -> VideoTaskContext:
        validate_task_id(task_id)
        async with self._lock:
            ctx = self.context(handle)
            if ctx.finished_at is not None or time.monotonic() - ctx.created_at >= self.ttl:
                raise VideoError("video_task_expired", status_code=410, retryable=False)
            if task_id in self._tasks and self._tasks[task_id] != handle:
                raise VideoError("invalid_provider_response", status_code=502)
            ctx.task_id = task_id
            ctx.status, ctx.phase = "running", "generating"
            self._tasks[task_id] = handle
            return ctx

    def drop_secret(self, handle: str) -> None:
        ctx = self.context(handle)
        snapshot_id = ctx.snapshot_id
        entry = self._snapshots.get(snapshot_id or "")
        if entry:
            if entry[1] == 1:
                del self._snapshots[snapshot_id]
            else:
                self._snapshots[snapshot_id] = (entry[0], entry[1] - 1)
        ctx.snapshot_id = None

    def finish(self, ctx: VideoTaskContext, status: str, error_code: str | None = None) -> None:
        self.drop_secret(ctx.handle)
        ctx.status, ctx.error_code = status, error_code
        ctx.finished_at = time.monotonic()
        if status == "succeeded":
            ctx.phase = "ready"

    def _remove(self, handle: str) -> None:
        ctx = self._contexts.get(handle)
        if ctx is None:
            return
        self.drop_secret(handle)
        if ctx.task_id:
            self._tasks.pop(ctx.task_id, None)
        self._contexts.pop(handle, None)

    async def release(self, handle: str) -> None:
        async with self._lock:
            ctx = self._contexts.get(handle)
            if ctx is None:
                return
            worker = ctx.worker
            self._remove(handle)
        if worker and not worker.done():
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)

    async def reap(self) -> None:
        workers = []
        now = time.monotonic()
        async with self._lock:
            for handle, ctx in list(self._contexts.items()):
                if ctx.finished_at is None and now - ctx.created_at >= self.ttl:
                    self.finish(ctx, "timeout", "video_task_expired")
                    if ctx.worker and not ctx.worker.done():
                        ctx.worker.cancel()
                        workers.append(ctx.worker)
                elif ctx.finished_at is not None and now - ctx.finished_at >= 3600 and not ctx.lock.locked():
                    self._remove(handle)
        if workers:
            await asyncio.gather(*workers, return_exceptions=True)

    async def close(self) -> None:
        if self._reaper:
            self._reaper.cancel()
            await asyncio.gather(self._reaper, return_exceptions=True)
            self._reaper = None
        for handle in list(self._contexts):
            await self.release(handle)
        self._snapshots.clear()


video_task_contexts = VideoTaskContexts()
