"""
Preview-proxy transcode queue.

Thin wrapper around :class:`QueueManager` so the preview-proxy service can
schedule FFmpeg subprocess jobs with a single concurrency budget regardless
of which entry point triggers the work (router POST, prefetch hint, ...).

Public surface mirrors :mod:`app.services.storyboard_video_queue`:
    - ``QUEUE_NAME``: registered queue name.
    - ``initialize()``: create the underlying queue from settings.
    - ``enqueue(...)``: submit a transcode job; returns immediately.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Optional

from app.config import settings
from app.logger import get_logger
from app.services.queue_manager import queue_manager

logger = get_logger(__name__)

QUEUE_NAME = "preview_proxy_transcode"


class _PreviewProxyQueue:
    def __init__(self) -> None:
        self._initialized = False
        self._init_lock = asyncio.Lock()

    async def initialize(self) -> None:
        if self._initialized:
            return
        async with self._init_lock:
            if self._initialized:
                return
            cfg = settings.preview_proxy
            await queue_manager.create_queue(
                QUEUE_NAME, max_concurrent=cfg.max_concurrent_transcode
            )
            logger.info(
                f"Preview-proxy queue initialized: "
                f"max_concurrent={cfg.max_concurrent_transcode}, "
                f"timeout_seconds={cfg.timeout_seconds}"
            )
            self._initialized = True

    async def enqueue(
        self,
        task: Callable[..., Awaitable[Any]],
        *args: Any,
        task_id: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """Schedule a transcode coroutine on the shared semaphore."""
        await self.initialize()
        await queue_manager.enqueue_task(
            QUEUE_NAME,
            task,
            task_args=args,
            task_kwargs=kwargs,
            task_id=task_id,
        )


# Module-level singleton
preview_proxy_queue = _PreviewProxyQueue()
