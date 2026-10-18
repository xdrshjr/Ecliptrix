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
from urllib.parse import unquote, urlparse

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


def _parse_reuse_wait_timeout() -> float:
    """Max seconds the export resolver waits for an in-flight background
    download to reach `ready` before falling back to its own download (F4)."""
    raw = os.getenv("MATERIAL_REUSE_WAIT_TIMEOUT_SECONDS", "")
    try:
        v = float(raw)
        if v >= 0:
            return v
    except (TypeError, ValueError):
        pass
    return 120.0


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
        self._reuse_wait_timeout = _parse_reuse_wait_timeout()
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
        self._research_locks = {}

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
        from app.database import _resolve_database_url
        self._engine = create_async_engine(
            _resolve_database_url(),
            pool_size=2,
            max_overflow=4,
            echo=False, hide_parameters=True,
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
            stmt = (
                select(CachedMaterial)
                .where(
                    CachedMaterial.source_url == url,
                    CachedMaterial.status == "ready",
                )
                .order_by(CachedMaterial.created_at.desc())
            )
            result = await session.execute(stmt)
            for row in result.scalars():
                if row.local_path and os.path.exists(row.local_path):
                    return row.local_path
        return None

    async def lookup_async(
        self,
        url: Optional[str] = None,
        source: Optional[str] = None,
        source_id: Optional[str] = None,
    ) -> Optional[CachedMaterial]:
        """Composite-key first, URL fallback. Returns the CachedMaterial row.

        Pexels (and many CDNs) rotate query params on the source URL between
        sessions, so searching by URL alone misses the cache. Whenever the
        caller has the source identifier triple, prefer that.
        """
        return await self._dispatch(
            self._lookup_impl(url=url, source=source, source_id=source_id)
        )

    async def _lookup_impl(
        self,
        url: Optional[str] = None,
        source: Optional[str] = None,
        source_id: Optional[str] = None,
    ) -> Optional[CachedMaterial]:
        if not (url or (source and source_id)):
            return None
        assert self._session_factory is not None
        async with self._session_factory() as session:
            row = None
            if source and source_id:
                stmt = select(CachedMaterial).where(
                    CachedMaterial.source == source,
                    CachedMaterial.source_id == str(source_id),
                )
                result = await session.execute(stmt)
                row = result.scalar_one_or_none()
            if row is None and url:
                stmt = (
                    select(CachedMaterial)
                    .where(CachedMaterial.source_url == url)
                    .order_by(CachedMaterial.created_at.desc())
                )
                result = await session.execute(stmt)
                row = result.scalars().first()
            return row

    def local_url_for(self, row: Optional[CachedMaterial]) -> Optional[str]:
        """Derive the same-origin static URL for a ready row.

        Returns ``None`` unless the row is `ready` AND its local_path file
        exists on disk. Front-end <video> consumes this directly via the
        existing `/api/storage/files` mount — no new static mount is needed
        because cached_materials lives under STORAGE_ROOT.
        """
        if row is None:
            return None
        if (row.status or "") != "ready":
            return None
        local_path = row.local_path or ""
        if not local_path or not os.path.exists(local_path):
            return None
        file_name = os.path.basename(local_path)
        # Defensive fallback: a row written with an empty source still resolves
        # to /cached_materials/url/<file>, matching how `_target_path` would
        # have routed an unsourced enqueue.
        source = (row.source or "url").strip() or "url"
        return f"/api/storage/files/cached_materials/{source}/{file_name}"

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

    def resolve_cached_path(
        self,
        url: str,
        source: Optional[str] = None,
        source_id: Optional[str] = None,
        cache_url: Optional[str] = None,
        wait_timeout: Optional[float] = None,
    ) -> Optional[str]:
        """Resolve an already-downloaded file for the export pipeline to reuse.

        Sync helper for the composition worker thread. Resolution order — each
        tier returns a real on-disk path on hit, else falls through:

          F2  same-origin ``cache_url`` hint mapped to a file under the cache
              dir (zero DB, zero network). The hint is NEVER used as a download
              URL — only as a disk path — so INV3 holds.
          F1  composite-key ``(source, source_id)`` lookup (URL fallback),
              aligned with how the editor judged the asset "downloaded";
              resilient to CDN URL rotation that the exact-URL lookup misses.
          F4  if the matching row is still ``downloading`` / ``pending``, wait
              (bounded by ``wait_timeout``) for it to turn ``ready`` and reuse
              it, instead of starting a duplicate concurrent download.

        Returns ``None`` when nothing is reusable (caller downloads as before),
        so a miss never changes correctness — only the happy path gets faster.
        """
        # F2 — pure path math + stat; no event loop needed.
        direct = self._resolve_cache_url_to_disk(cache_url)
        if direct:
            return direct

        if not (url or (source and source_id)):
            return None

        timeout = self._reuse_wait_timeout if wait_timeout is None else max(0.0, wait_timeout)
        try:
            loop = self._ensure_loop()
            fut = asyncio.run_coroutine_threadsafe(
                self._resolve_cached_path_impl(url, source, source_id, timeout),
                loop,
            )
            # Give the bridge a little slack over the in-loop wait budget.
            return fut.result(timeout=timeout + 15)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(f"resolve_cached_path failed for {url}: {exc}")
            return None

    def _resolve_cache_url_to_disk(self, cache_url: Optional[str]) -> Optional[str]:
        """F2: map a same-origin ``/api/storage/files/cached_materials/<source>/<file>``
        reference back to a real file under the cache dir, with strict
        path-traversal containment.

        Returns the disk path iff the resolved file stays inside the cache
        subtree (rejecting ``..`` and symlink escapes via ``resolve()`` +
        ``relative_to``) and exists. Otherwise ``None``.
        """
        if not cache_url:
            return None
        try:
            parsed_path = urlparse(cache_url).path or cache_url
        except Exception:
            return None
        marker = "/api/storage/files/cached_materials/"
        idx = parsed_path.find(marker)
        if idx == -1:
            return None
        rel = unquote(parsed_path[idx + len(marker):]).strip().lstrip("/")
        if not rel or ".." in rel.replace("\\", "/").split("/"):
            return None
        try:
            cache_root = self.cache_dir.resolve()
            candidate = (self.cache_dir / rel).resolve()
            candidate.relative_to(cache_root)  # raises ValueError if it escaped
        except (ValueError, OSError):
            return None
        if candidate.is_file():
            return str(candidate)
        return None

    async def _resolve_cached_path_impl(
        self,
        url: Optional[str],
        source: Optional[str],
        source_id: Optional[str],
        wait_timeout: float,
    ) -> Optional[str]:
        """F1 + F4 on the background loop. Looks up the row by composite key
        (URL fallback); reuses it when ``ready``; waits (bounded) when an
        in-flight download is still running; gives up (→ caller downloads)
        on ``failed`` / timeout / missing file."""
        deadline = time.monotonic() + max(0.0, wait_timeout)
        poll_interval = 1.0
        while True:
            row = await self._lookup_impl(url=url, source=source, source_id=source_id)
            if row is None:
                return None
            status = (row.status or "").lower()
            if status == "ready":
                local_path = row.local_path or ""
                if local_path and os.path.exists(local_path):
                    return local_path
                # Row claims ready but the file is gone — let the caller refetch.
                return None
            if status in ("downloading", "pending"):
                if time.monotonic() >= deadline:
                    return None  # F4 timeout → fall back to the download path
                await asyncio.sleep(poll_interval)
                continue
            # failed / missing / unknown → no reuse
            return None

    async def store_research_download_async(self, path, digest, extension, url):
        """返回实际提交的缓存记录；锁和事务始终在下载专属循环。"""
        return await self._dispatch(self._store_research(
            Path(path), digest, extension, url))

    async def recover_research_cache_async(self):
        """仅启动时回收本服务私有 web 缓存的未提交文件。"""
        if (self.cache_dir / "web").is_dir():
            await self._dispatch(self._recover_research_cache())

    async def _recover_research_cache(self):
        import re
        root = (self.cache_dir / "web").resolve()
        async with self._session_factory() as session:
            rows = (await session.execute(select(CachedMaterial).where(
                CachedMaterial.source == "web"))).scalars().all()
            ready = {Path(r.local_path).resolve() for r in rows
                     if r.status == "ready" and r.local_path}
            for path in root.iterdir():
                resolved = path.resolve()
                if not resolved.is_relative_to(root) or path.is_symlink():
                    continue
                generated = re.fullmatch(
                    r"(?:web-[a-f0-9]{24}\.(?:png|jpg|mp4|webm|mp3|wav|m4a)|[a-f0-9-]{36}\.part)", path.name)
                if path.is_file() and generated and resolved not in ready:
                    path.unlink(missing_ok=True)
            for row in rows:
                if row.status == "ready" and not Path(row.local_path or "").is_file():
                    row.status = "failed"
                    row.error_message = "cached_file_missing"
            await session.commit()

    async def _store_research(self, path, digest, extension, url):
        import hashlib
        from app.models.web_research_models import WebResearchError
        if extension not in {"png", "jpg", "mp4", "webm", "mp3", "wav", "m4a"}:
            raise WebResearchError("unsupported_media_type")
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise WebResearchError("cache_integrity_error")
        entry = self._research_locks.setdefault(digest, [asyncio.Lock(), 0])
        entry[1] += 1
        try:
            async with entry[0]:
                return await self._commit_research(path, digest, extension, url)
        finally:
            entry[1] -= 1
            if entry[1] == 0:
                self._research_locks.pop(digest, None)

    @staticmethod
    async def _settle_research_commit(session):
        """取消不能中断提交结果判定，否则补偿会误删已入库文件。"""
        task = asyncio.create_task(session.commit())
        cancelled = False
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                cancelled = True
        task.result()
        return cancelled

    async def _commit_research(self, path, digest, extension, url):
        import hashlib
        import uuid
        from app.models.web_research_models import WebResearchError
        identifier = "web-" + digest[:24]
        directory = self.cache_dir / "web"
        directory.mkdir(parents=True, exist_ok=True)
        final = directory / (identifier + "." + extension)
        temporary = directory / (str(uuid.uuid4()) + ".part")
        created, committed = False, False
        try:
            async with self._session_factory() as session:
                row = (await session.execute(select(CachedMaterial).where(
                    CachedMaterial.source == "web",
                    CachedMaterial.source_id == identifier))).scalar_one_or_none()
                reused = bool(row and row.status == "ready" and final.is_file()
                              and hashlib.sha256(final.read_bytes()).hexdigest() == digest)
                if not reused:
                    shutil.copyfile(path, temporary)
                    temporary.replace(final)
                    created = True
                    if row is None:
                        row = CachedMaterial(source="web", source_id=identifier,
                                             source_url=url, ref_count=1)
                        session.add(row)
                    row.local_path, row.file_size = str(final), final.stat().st_size
                    row.status = "ready"
                    cancelled = await self._settle_research_commit(session)
                    committed = True
                    if cancelled:
                        raise asyncio.CancelledError
                    await session.refresh(row)
                return {"record_id": str(row.id), "size": row.file_size,
                        "local_url": "/api/storage/files/cached_materials/web/" + final.name,
                        "created_at": row.created_at.isoformat(), "reused": reused}
        except asyncio.CancelledError:
            raise
        except Exception:
            raise WebResearchError("cache_commit_failed",
                                   failure_class="internal") from None
        finally:
            temporary.unlink(missing_ok=True)
            if created and not committed:
                final.unlink(missing_ok=True)

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
                # Fall back to source_url lookup: another path (e.g.
                # enqueue with source="pexels") may have already registered
                # the same physical asset under a different (source, source_id).
                # Reusing that row prevents the cached_materials table from
                # accumulating duplicate entries for the same URL.
                stmt = (
                    select(CachedMaterial)
                    .where(CachedMaterial.source_url == url)
                    .order_by(CachedMaterial.created_at.desc())
                )
                result = await session.execute(stmt)
                row = result.scalars().first()
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
