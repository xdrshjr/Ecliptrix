"""
Storyboard video-generation job queue.

Wraps ARK video generation with a concurrency-limited queue plus per-job
timeout so that the UI always observes a single in-flight slot budget
regardless of which entry point triggered the work.

Public surface:
    - QUEUE_NAME: constant queue name registered with QueueManager
    - JobState: data class describing a single job's state snapshot
    - initialize(): register the queue + start TTL cleanup (call at startup)
    - enqueue(...): schedule a new ARK generation job, returns job_id
    - get_job(job_id): look up a job's state snapshot
    - list_jobs(job_ids): batch lookup
    - get_queue_info(): wrap QueueManager.get_queue_status

Design notes:
    - Each ARK video generation (a single "repeat") gets one job_id / slot.
    - Slot is released only after success/failed/timeout — in contrast to
      prior Semaphore-around-create_task behaviour which released after
      the ARK submit HTTP call (seconds), not after the ~minute render.
    - The ARK task continues running remotely after local timeout; we do
      not call ARK cancel (the SDK currently provides no cancel method).
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.config import settings
from app.logger import get_logger
from app.models.ark_video_models import ArkVideoGenerateRequest
from app.services import ark_video_service
from app.services.queue_manager import queue_manager

logger = get_logger(__name__)

QUEUE_NAME = "storyboard_video_generation"

JobStatus = str  # "queued" | "generating" | "success" | "failed" | "timeout"


@dataclass
class JobState:
    """Snapshot of a single storyboard video generation job."""

    job_id: str
    pack_id: str
    frame_index: int
    repeat_index: int
    status: JobStatus = "queued"
    ark_task_id: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[int] = None
    error: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class _StoryboardVideoQueue:
    def __init__(self) -> None:
        self._jobs: Dict[str, JobState] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None
        self._initialized = False

    # ---- lifecycle ----------------------------------------------------

    async def initialize(self) -> None:
        """Create the underlying queue and start the TTL cleanup loop."""
        if self._initialized:
            return
        cfg = settings.storyboard.video_generation
        await queue_manager.create_queue(QUEUE_NAME, max_concurrent=cfg.max_concurrent)
        logger.info(
            f"Storyboard video queue initialized: max_concurrent={cfg.max_concurrent}, "
            f"timeout_seconds={cfg.timeout_seconds}, poll_interval={cfg.poll_interval_seconds}s, "
            f"retention={cfg.job_retention_seconds}s"
        )
        # Kick off background cleanup loop (one per process).
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        self._initialized = True

    async def _cleanup_loop(self) -> None:
        """Periodically evict terminal jobs whose finished_at is older than retention."""
        while True:
            try:
                await asyncio.sleep(300)  # every 5 minutes
                retention = settings.storyboard.video_generation.job_retention_seconds
                cutoff = datetime.utcnow() - timedelta(seconds=retention)
                async with self._lock:
                    to_delete = [
                        jid
                        for jid, job in self._jobs.items()
                        if job.finished_at is not None and job.finished_at < cutoff
                    ]
                    for jid in to_delete:
                        self._jobs.pop(jid, None)
                if to_delete:
                    logger.info(
                        f"Storyboard video queue cleanup: removed {len(to_delete)} job(s)"
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - best-effort cleanup
                logger.error(f"Storyboard video queue cleanup error: {exc}", exc_info=True)

    # ---- enqueue / run ------------------------------------------------

    async def enqueue(
        self,
        *,
        pack_id: str,
        frame_index: int,
        repeat_index: int,
        description: str,
        duration: int,
        frame_data_uri: str,
    ) -> str:
        """Schedule an ARK video generation for one frame × one repeat.

        Returns the job_id immediately; the job status is "queued" until a
        slot frees up, then transitions through "generating" to a terminal
        state.
        """
        await self.initialize()

        job_id = f"sbv-{uuid.uuid4().hex}"
        async with self._lock:
            self._jobs[job_id] = JobState(
                job_id=job_id,
                pack_id=pack_id,
                frame_index=frame_index,
                repeat_index=repeat_index,
            )

        await queue_manager.enqueue_task(
            QUEUE_NAME,
            self._run_job,
            task_args=(job_id, description, duration, frame_data_uri),
            task_id=job_id,
            metadata={
                "pack_id": pack_id,
                "frame_index": frame_index,
                "repeat_index": repeat_index,
            },
        )
        return job_id

    async def _run_job(
        self,
        job_id: str,
        description: str,
        duration: int,
        frame_data_uri: str,
    ) -> None:
        """Worker coroutine — runs inside QueueManager's semaphore slot."""
        cfg = settings.storyboard.video_generation
        job = await self._get_mutable(job_id)
        if job is None:
            logger.warning(f"Storyboard video job {job_id} missing from jobs table at worker start")
            return

        job.status = "generating"
        job.started_at = datetime.utcnow()

        try:
            await asyncio.wait_for(
                self._submit_and_poll(job, description, duration, frame_data_uri, cfg),
                timeout=cfg.timeout_seconds,
            )
        except asyncio.TimeoutError:
            job.status = "timeout"
            job.error = f"Video generation exceeded timeout of {cfg.timeout_seconds}s"
            job.finished_at = datetime.utcnow()
            logger.warning(
                f"Storyboard video job {job_id} (frame {job.frame_index} repeat {job.repeat_index}) "
                f"timed out after {cfg.timeout_seconds}s"
            )
        except asyncio.CancelledError:
            # Propagate after marking terminal so cleanup TTL can evict
            # the job and the UI doesn't see a permanent "generating".
            job.status = "failed"
            job.error = "Job cancelled (server shutdown or explicit cancel)"
            job.finished_at = datetime.utcnow()
            logger.info(f"Storyboard video job {job_id} cancelled")
            raise
        except Exception as exc:  # noqa: BLE001
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = datetime.utcnow()
            logger.error(
                f"Storyboard video job {job_id} failed: {exc}", exc_info=True
            )

    async def _submit_and_poll(
        self,
        job: JobState,
        description: str,
        duration: int,
        frame_data_uri: str,
        cfg,
    ) -> None:
        """Submit the ARK task then poll until terminal."""
        ark_request = ArkVideoGenerateRequest(
            prompt=description,
            mode="description",
            image_urls=[frame_data_uri],
            duration=duration,
        )
        ark_task_id = await ark_video_service.create_task(ark_request)
        job.ark_task_id = ark_task_id
        logger.info(
            f"Storyboard video job {job.job_id}: ARK task created {ark_task_id} "
            f"(frame {job.frame_index} repeat {job.repeat_index})"
        )

        while True:
            status = await ark_video_service.get_status(ark_task_id)
            st = (status.status or "").lower()
            if st == "succeeded":
                job.status = "success"
                job.video_url = status.video_url
                job.thumbnail_url = status.thumbnail_url
                job.duration = status.duration
                job.finished_at = datetime.utcnow()
                return
            if st == "failed":
                job.status = "failed"
                job.error = status.error or status.message or "ARK reported failure"
                job.finished_at = datetime.utcnow()
                return
            # Still running — wait before next poll.
            await asyncio.sleep(cfg.poll_interval_seconds)

    # ---- read-only accessors -----------------------------------------

    async def _get_mutable(self, job_id: str) -> Optional[JobState]:
        async with self._lock:
            return self._jobs.get(job_id)

    async def get_job(self, job_id: str) -> Optional[JobState]:
        return await self._get_mutable(job_id)

    async def list_jobs(self, job_ids: List[str]) -> List[Optional[JobState]]:
        async with self._lock:
            return [self._jobs.get(jid) for jid in job_ids]

    async def position_in_queue(self, job_id: str) -> Optional[int]:
        """Return 1-based queue position if still queued, else None."""
        task = await queue_manager.get_task_status(job_id)
        if task is None:
            return None
        # TaskStatus is a string enum — use value check.
        status_val = getattr(task.status, "value", task.status)
        if status_val == "queued":
            return task.position_in_queue
        return None

    def jobs_snapshot(self) -> Dict[str, JobState]:
        """Non-locking snapshot for observability (tests / diagnostics)."""
        return dict(self._jobs)


# Module-level singleton
storyboard_video_queue = _StoryboardVideoQueue()
