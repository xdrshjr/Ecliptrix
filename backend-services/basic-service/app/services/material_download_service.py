"""
Material download service: pre-downloads remote video assets (Pexels, etc.)
and persists them in the CachedMaterial table for cross-session reuse.

Triggered from /api/video/search (covers manual modal + Agent search) and from
/api/material/ingest (explicit frontend hook). The video composition pipeline
queries CachedMaterial by URL at export time so already-cached assets skip the
slow download path entirely.
"""

import asyncio
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Dict, Optional, Tuple
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.logger import get_logger
from app.models.db_models import CachedMaterial

logger = get_logger(__name__)


def _parse_concurrency_limit() -> int:
    raw = os.getenv("MATERIAL_DOWNLOAD_MAX_CONCURRENT", "")
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return 4


class MaterialDownloadService:
    """
    Singleton-style background downloader. enqueue() returns immediately with a
    material_id; the download runs on a dedicated background event loop so it
    never blocks the calling FastAPI request.
    """

    def __init__(self) -> None:
        storage_root = (
            settings.storage.root if hasattr(settings, "storage") else "static/uploads"
        )
        self.cache_dir = Path(storage_root) / "cached_materials"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self._max_concurrent = _parse_concurrency_limit()
        # Background loop, engine, semaphore are lazily initialised on first use.
        # The engine MUST live on this background loop alone — sharing the global
        # engine with FastAPI's loop pollutes asyncpg's pool with connections
        # bound to multiple loops, surfacing as random "Future attached to a
        # different loop" failures on unrelated requests (e.g. auth middleware).
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._engine = None
        self._session_factory: Optional[async_sessionmaker[AsyncSession]] = None
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._loop_thread: Optional[threading.Thread] = None
        self._loop_lock = threading.Lock()
        # Tracks active material_ids to avoid duplicate concurrent enqueues.
        self._inflight: Dict[str, asyncio.Future] = {}

        logger.info(
            f"MaterialDownloadService initialised "
            f"(cache_dir={self.cache_dir}, max_concurrent={self._max_concurrent})"
        )

    # ------------------------------------------------------------------ loop

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._loop_lock:
            if self._loop and self._loop.is_running():
                return self._loop

            loop = asyncio.new_event_loop()

            def _runner() -> None:
                asyncio.set_event_loop(loop)
                loop.run_forever()

            t = threading.Thread(
                target=_runner, daemon=True, name="material-download-loop"
            )
            t.start()
            self._loop = loop
            self._loop_thread = t

            # Engine + session factory + semaphore must all be created from
            # inside the target loop so asyncpg pools to *this* loop only.
            fut = asyncio.run_coroutine_threadsafe(self._init_runtime(), loop)
            fut.result(timeout=10)
            return loop

    async def _init_runtime(self) -> None:
        self._engine = create_async_engine(
            settings.database.url,
            pool_size=2,
            max_overflow=4,
            pool_timeout=settings.database.pool_timeout,
            pool_recycle=settings.database.pool_recycle,
            echo=False,
        )
        self._session_factory = async_sessionmaker(
            self._engine, class_=AsyncSession, expire_on_commit=False
        )
        self._semaphore = asyncio.Semaphore(self._max_concurrent)

    async def _dispatch(self, coro: Awaitable[Any]) -> Any:
        """Run *coro* on the background loop, awaitable from any caller loop.

        Sync wrappers below already schedule via ``run_coroutine_threadsafe``,
        so on the bg loop ``get_running_loop()`` is the bg loop and we just
        await directly. From the FastAPI loop we bridge across loops via
        ``asyncio.wrap_future``.
        """
        loop = self._ensure_loop()
        try:
            current = asyncio.get_running_loop()
        except RuntimeError:
            current = None
        if current is loop:
            return await coro
        fut = asyncio.run_coroutine_threadsafe(coro, loop)
        return await asyncio.wrap_future(fut)

    # ------------------------------------------------------------------ ingest

    async def enqueue(
        self,
        source: str,
        source_id: str,
        url: str,
    ) -> Dict[str, str]:
        return await self._dispatch(self._enqueue_impl(source, source_id, url))

    async def _enqueue_impl(
        self,
        source: str,
        source_id: str,
        url: str,
    ) -> Dict[str, str]:
        """
        Upsert a CachedMaterial row, schedule a background download if needed,
        and return its current state.

        Safe to call repeatedly with the same (source, source_id) — duplicate
        calls just bump ref_count and return the existing row.
        """
        if not url or not source or not source_id:
            return {"material_id": "", "status": "invalid"}

        assert self._session_factory is not None
        async with self._session_factory() as session:
            stmt = select(CachedMaterial).where(
                CachedMaterial.source == source,
                CachedMaterial.source_id == str(source_id),
            )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()

            if row is None:
                row = CachedMaterial(
                    source=source,
                    source_id=str(source_id),
                    source_url=url,
                    status="pending",
                    ref_count=1,
                )
                session.add(row)
                await session.commit()
                await session.refresh(row)
                schedule_download = True
            else:
                row.ref_count = (row.ref_count or 0) + 1
                if row.status == "failed":
                    row.status = "pending"
                    row.error_message = None
                    schedule_download = True
                elif row.status in ("pending",) and not row.local_path:
                    schedule_download = True
                else:
                    schedule_download = False
                # Keep latest URL in case Pexels rotates the CDN link
                if url and row.source_url != url:
                    row.source_url = url
                await session.commit()
                await session.refresh(row)

            material_id = str(row.id)
            current_status = row.status
            local_path = row.local_path

        if schedule_download:
            self._submit(material_id)

        return {
            "material_id": material_id,
            "status": current_status,
            "local_path": local_path or "",
        }

    def enqueue_threadsafe(self, source: str, source_id: str, url: str) -> None:
        """Fire-and-forget enqueue from sync code (e.g. video search router)."""
        loop = self._ensure_loop()
        asyncio.run_coroutine_threadsafe(
            self.enqueue(source, source_id, url), loop
        )

    def _submit(self, material_id: str) -> None:
        loop = self._ensure_loop()
        if material_id in self._inflight:
            return
        future = asyncio.run_coroutine_threadsafe(
            self._download_material(material_id), loop
        )
        self._inflight[material_id] = future

        def _cleanup(_f) -> None:
            self._inflight.pop(material_id, None)

        future.add_done_callback(_cleanup)

    # ------------------------------------------------------------------ lookup

    async def lookup_by_url_async(self, url: str) -> Optional[str]:
        return await self._dispatch(self._lookup_by_url_impl(url))

    async def _lookup_by_url_impl(self, url: str) -> Optional[str]:
        if not url:
            return None
        assert self._session_factory is not None
        async with self._session_factory() as session:
            stmt = select(CachedMaterial).where(
                CachedMaterial.source_url == url,
                CachedMaterial.status == "ready",
            )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row and row.local_path and os.path.exists(row.local_path):
                return row.local_path
        return None

    def lookup_by_url(self, url: str) -> Optional[str]:
        """Sync helper for use inside ThreadPoolExecutor download workers.

        Always dispatches to the dedicated background loop instead of
        asyncio.run(). Reason: SQLAlchemy's AsyncAdaptedQueuePool binds asyncpg
        connections to the loop they were created on, and asyncpg refuses to
        reuse a connection across loops — so creating a fresh loop per worker
        thread crashes intermittently when the pool happens to hand back a
        connection from another loop.
        """
        if not url:
            return None
        try:
            loop = self._ensure_loop()
            fut = asyncio.run_coroutine_threadsafe(
                self.lookup_by_url_async(url), loop
            )
            return fut.result(timeout=5)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(f"lookup_by_url failed for {url}: {exc}")
            return None

    async def store_external_download_async(
        self,
        url: str,
        local_path: str,
        source: str = "url",
        source_id: Optional[str] = None,
    ) -> None:
        await self._dispatch(
            self._store_external_download_impl(url, local_path, source, source_id)
        )

    async def _store_external_download_impl(
        self,
        url: str,
        local_path: str,
        source: str = "url",
        source_id: Optional[str] = None,
    ) -> None:
        """
        Persist an externally-downloaded file into the cache table so subsequent
        exports of the same URL can reuse it. Used as a write-through fallback
        from the composition service when no cache row pre-existed.
        """
        if not url or not local_path or not os.path.exists(local_path):
            return

        # Copy file into the cache dir so its lifetime is decoupled from the
        # caller's temp_dir cleanup.
        cached_path = self._target_path(source, source_id or self._fallback_id(url), url)
        try:
            if os.path.abspath(cached_path) != os.path.abspath(local_path):
                shutil.copy2(local_path, cached_path)
        except Exception as exc:
            logger.warning(f"Failed to copy {local_path} into cache: {exc}")
            return

        file_size = os.path.getsize(cached_path) if os.path.exists(cached_path) else None

        assert self._session_factory is not None
        async with self._session_factory() as session:
            stmt = select(CachedMaterial).where(
                CachedMaterial.source == source,
                CachedMaterial.source_id == str(source_id or self._fallback_id(url)),
            )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                row = CachedMaterial(
                    source=source,
                    source_id=str(source_id or self._fallback_id(url)),
                    source_url=url,
                    status="ready",
                    local_path=cached_path,
                    file_size=file_size,
                    ref_count=1,
                )
                session.add(row)
            else:
                row.source_url = url
                row.local_path = cached_path
                row.file_size = file_size
                row.status = "ready"
                row.error_message = None
            await session.commit()

    def store_external_download(
        self,
        url: str,
        local_path: str,
        source: str = "url",
        source_id: Optional[str] = None,
    ) -> None:
        """Fire-and-forget write-through from sync code (composition workers).

        See lookup_by_url for why we always route via the background loop.
        """
        try:
            loop = self._ensure_loop()
            asyncio.run_coroutine_threadsafe(
                self.store_external_download_async(url, local_path, source, source_id),
                loop,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(f"store_external_download failed: {exc}")

    # ------------------------------------------------------------------ worker

    async def _download_material(self, material_id: str) -> None:
        # Runtime is guaranteed initialised because _submit goes through
        # _ensure_loop, which blocks on _init_runtime.
        assert self._semaphore is not None
        async with self._semaphore:
            await self._do_download(material_id)

    async def _do_download(self, material_id: str) -> None:
        assert self._session_factory is not None
        async with self._session_factory() as session:
            row = await session.get(CachedMaterial, uuid.UUID(material_id))
            if row is None:
                logger.warning(f"CachedMaterial {material_id} disappeared before download")
                return
            url = row.source_url
            source = row.source
            source_id = row.source_id
            row.status = "downloading"
            await session.commit()

        target_path = self._target_path(source, source_id, url)

        ok, err = await asyncio.to_thread(self._download_to_path, url, target_path)

        async with self._session_factory() as session:
            row = await session.get(CachedMaterial, uuid.UUID(material_id))
            if row is None:
                return
            if ok and os.path.exists(target_path):
                row.status = "ready"
                row.local_path = target_path
                row.file_size = os.path.getsize(target_path)
                row.error_message = None
                logger.info(
                    f"Cached material ready: source={source} id={source_id} "
                    f"size={row.file_size} path={target_path}"
                )
            else:
                row.status = "failed"
                row.error_message = (err or "unknown error")[:500]
                logger.warning(
                    f"Cached material download failed: source={source} id={source_id} "
                    f"err={row.error_message}"
                )
            await session.commit()

    # ------------------------------------------------------------------ utils

    def _fallback_id(self, url: str) -> str:
        # Stable-enough identifier for arbitrary URLs.
        import hashlib

        return hashlib.sha1(url.encode("utf-8")).hexdigest()[:24]

    def _target_path(self, source: str, source_id: str, url: str) -> str:
        ext = self._guess_extension(url)
        sub_dir = self.cache_dir / source
        sub_dir.mkdir(parents=True, exist_ok=True)
        safe_id = "".join(c for c in source_id if c.isalnum() or c in ("-", "_"))[:64] or "asset"
        return str(sub_dir / f"{safe_id}{ext}")

    def _guess_extension(self, url: str) -> str:
        try:
            path = urlparse(url).path
        except Exception:
            path = ""
        ext = os.path.splitext(path)[1].lower()
        if ext and len(ext) <= 5:
            return ext
        return ".mp4"

    def _download_to_path(self, url: str, target_path: str) -> Tuple[bool, Optional[str]]:
        # We re-use the same FFmpeg copy approach as the composition service,
        # which works for both Pexels (CDN HTTP) and arbitrary direct URLs.
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        max_retries = 3
        last_err: Optional[str] = None

        for attempt in range(max_retries):
            try:
                if os.path.exists(target_path):
                    try:
                        os.remove(target_path)
                    except OSError:
                        pass
                cmd = [ffmpeg, "-y", "-i", url, "-c", "copy", target_path]
                proc = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=180
                )
                if proc.returncode != 0:
                    last_err = (proc.stderr or "ffmpeg returned nonzero")[-300:]
                elif not os.path.exists(target_path) or os.path.getsize(target_path) < 1024:
                    last_err = "Downloaded file missing or too small"
                else:
                    return True, None
            except subprocess.TimeoutExpired:
                last_err = "ffmpeg download timed out"
            except Exception as exc:  # pragma: no cover - defensive
                last_err = str(exc)

            time.sleep(min(2 ** attempt, 8))

        return False, last_err


_service_singleton: Optional[MaterialDownloadService] = None


def get_material_download_service() -> MaterialDownloadService:
    global _service_singleton
    if _service_singleton is None:
        _service_singleton = MaterialDownloadService()
    return _service_singleton
