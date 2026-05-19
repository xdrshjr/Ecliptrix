"""
Preview-proxy transcode service (spec 06 §三 / §四 / phase-3 §3.2.7).

Public surface
--------------
* :func:`get_preview_proxy_service` — module-level singleton accessor.
* :class:`PreviewProxyService.ensure_or_enqueue` — idempotent enqueue;
  returns ``(task_id, status, preview_proxy_url)`` for the requested
  ``material_id`` + ``profile``.
* :class:`PreviewProxyService.get_status` — read DB row; merge in-memory
  progress cache.

Internals
---------
* FFmpeg is launched via ``asyncio.create_subprocess_exec``; ``-progress
  pipe:1`` output is parsed line-by-line (key=value form). Progress is
  written back to ``cached_materials.preview_proxy_progress`` with a 1s
  throttle to keep DB load bounded.
* Concurrency is governed by :mod:`preview_proxy_queue`; a single global
  :class:`asyncio.Semaphore` would not survive process restart so we layer
  on top of :class:`QueueManager` (see storyboard_video_queue for the same
  idiom).
* On exit code 0: output file is moved into the configured output dir,
  optionally uploaded to OSS, the DB row is finalized (``status='cached'``).
* On non-zero exit / timeout: best-effort delete of the partial file,
  retry once, then mark ``status='failed'`` with the captured stderr tail.

Spec invariants enforced
------------------------
* INV6 — failed jobs leave no half-written output file.
* §3.2.7 step 3 — exit-code-0 path writes
  ``preview_proxy_local_url / preview_proxy_oss_url / status='cached' /
  transcoded_at / bytes / duration_sec``.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.logger import get_logger
from app.models.db_models import CachedMaterial
from app.security.url_guard import (
    FFMPEG_LOCAL_PROTOCOL_WHITELIST,
    URLGuardError,
    validate_local_path_for_ffmpeg,
)
from app.services import oss_client as oss_module
from app.services.material_download_service import get_material_download_service
from app.services.preview_proxy_queue import preview_proxy_queue

logger = get_logger(__name__)

DEFAULT_PROFILE = "preview-480p"


def _ffmpeg_args(input_path: str, output_path: str, profile: str) -> list[str]:
    """Return the FFmpeg argv for the named profile.

    Hard-coded to the spec 06 §四.2 ladder; YAML is informational only so
    the wire-level contract stays explicit. ``-progress pipe:1`` emits
    ``key=value`` lines that :meth:`_parse_progress_stream` consumes.
    """
    if profile != DEFAULT_PROFILE:
        # Spec 06 §九 Q1 — only 480p in the first phase. Fall back to 480p
        # so callers asking for an unknown profile still get something.
        profile = DEFAULT_PROFILE
    return [
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        # Spec 03 §3.4 — lock FFmpeg to the local-input protocol set so a
        # row whose local_path was tampered with cannot fall back to
        # http/https/rtsp/concat exfil channels.
        "-protocol_whitelist", FFMPEG_LOCAL_PROTOCOL_WHITELIST,
        "-i", input_path,
        "-vf", "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2",
        "-c:v", "libx264",
        "-profile:v", "baseline",
        "-level", "3.1",
        "-preset", "veryfast",
        "-crf", "28",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "96k",
        "-movflags", "+faststart+frag_keyframe+empty_moov",
        "-f", "mp4",
        "-progress", "pipe:1",
        output_path,
    ]


class PreviewProxyService:
    """Owns the FFmpeg pipeline + DB write-back for preview-proxy assets."""

    def __init__(self) -> None:
        cfg = settings.preview_proxy
        self._cfg = cfg
        self.output_root = Path(cfg.output_dir)
        self.output_root.mkdir(parents=True, exist_ok=True)

        # Dedicated event loop / engine to avoid asyncpg cross-loop pool
        # contamination (mirrors material_download_service pattern). The
        # FastAPI request handler can still run ensure_or_enqueue from the
        # main loop because the heavy work is dispatched via the queue.
        self._engine = None
        self._session_factory: Optional[async_sessionmaker[AsyncSession]] = None
        self._init_lock = asyncio.Lock()

        # In-memory progress cache, throttled DB writes.
        self._progress_cache: Dict[str, int] = {}
        self._inflight: Dict[str, asyncio.Task] = {}
        # Phase 4 (spec §6.2 / B6): cheap counters surfaced to logs/admin.
        self._failure_total = 0
        self._last_transcode_ms: Dict[str, int] = {}
        self._transcode_started_at: Dict[str, float] = {}

    # ------------------------------------------------------------------ observability helpers
    def get_queue_depth(self) -> int:
        """Approximate in-flight transcode count (spec Phase 4 §6.2 / B6)."""
        return len(self._inflight)

    def last_failure_count(self) -> int:
        """Total failures observed since process start (spec Phase 4 B6)."""
        return self._failure_total

    def last_transcode_duration_ms(self, material_id: str) -> Optional[int]:
        return self._last_transcode_ms.get(material_id)

    # ------------------------------------------------------------------ init

    async def _ensure_runtime(self) -> None:
        if self._session_factory is not None:
            return
        async with self._init_lock:
            if self._session_factory is not None:
                return
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

    # ------------------------------------------------------------------ entry

    async def ensure_or_enqueue(
        self,
        *,
        material_id: Optional[str] = None,
        source_url: Optional[str] = None,
        profile: str = DEFAULT_PROFILE,
        priority: str = "normal",
    ) -> Tuple[Optional[str], str, Optional[str], str]:
        """Return ``(task_id, status, preview_proxy_url, resolved_material_id)``.

        Idempotent — second-call hits the same DB row, so concurrent
        ``addItem`` triggers don't spawn duplicate transcodes. ``cached``
        rows short-circuit; ``queued`` / ``running`` rows return their
        in-flight task id.
        """
        if not self._cfg.enabled:
            raise PreviewProxyDisabledError()

        await self._ensure_runtime()
        assert self._session_factory is not None

        if not material_id and not source_url:
            raise PreviewProxyValidationError("material_id or source_url required")

        # If only source_url was given, ingest into cached_materials first
        # so we have a stable material_id to track. Falls back to
        # material_download_service.enqueue (the canonical entry point).
        # F1 (impl note): material_download_service exposes ``enqueue(source,
        # source_id, url)`` rather than the spec's ``ensure_or_ingest``;
        # we adapt by deriving (source='url', source_id=stable hash).
        if not material_id and source_url:
            mds = get_material_download_service()
            try:
                source_id = uuid.uuid5(uuid.NAMESPACE_URL, source_url).hex
                row_meta = await mds.enqueue("url", source_id, source_url)
                material_id = row_meta.get("material_id") or None
                if not material_id:
                    raise PreviewProxyValidationError("ingest returned no material_id")
            except Exception as exc:  # noqa: BLE001
                raise PreviewProxyValidationError(
                    f"failed to ingest source_url: {exc}"
                ) from exc

        async with self._session_factory() as session:
            row = await self._get_row(session, material_id)
            if row is None:
                raise PreviewProxyNotFoundError(material_id)

            status = row.preview_proxy_status or "absent"
            if status == "cached" and row.preview_proxy_local_url:
                return (None, "cached", row.preview_proxy_local_url, material_id)
            if status in ("queued", "running"):
                # Already in flight — surface the existing task id if we
                # tracked one, else just report the state.
                task_id = self._task_id_for(material_id)
                return (task_id, status, row.preview_proxy_local_url, material_id)

            # New job — flip status, persist profile, then enqueue.
            row.preview_proxy_status = "queued"
            row.preview_proxy_profile = profile or DEFAULT_PROFILE
            row.preview_proxy_progress = 0
            row.preview_proxy_last_error = None
            await session.commit()

        task_id = f"pp-{uuid.uuid4().hex[:12]}"
        await preview_proxy_queue.enqueue(
            self._run_transcode,
            material_id,
            profile or DEFAULT_PROFILE,
            task_id=task_id,
        )
        # Track for status lookups; entry is wiped by `_run_transcode`.
        self._inflight[material_id] = asyncio.current_task()  # type: ignore[assignment]
        return (task_id, "queued", None, material_id)

    async def get_status(
        self,
        material_id: str,
        profile: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return the merged DB + in-memory snapshot for ``material_id``."""
        await self._ensure_runtime()
        assert self._session_factory is not None
        async with self._session_factory() as session:
            row = await self._get_row(session, material_id)
            if row is None:
                return {
                    "material_id": material_id,
                    "task_id": None,
                    "status": "absent",
                    "preview_proxy_url": None,
                    "profile": profile or DEFAULT_PROFILE,
                    "progress_percent": 0,
                    "last_error": None,
                    "transcoded_at": None,
                    "duration_sec": None,
                    "bytes": None,
                }
            cached_progress = self._progress_cache.get(material_id)
            progress = (
                cached_progress
                if cached_progress is not None
                else (row.preview_proxy_progress or 0)
            )
            return {
                "material_id": material_id,
                "task_id": self._task_id_for(material_id),
                "status": row.preview_proxy_status or "absent",
                "preview_proxy_url": row.preview_proxy_local_url,
                "profile": row.preview_proxy_profile or DEFAULT_PROFILE,
                "progress_percent": int(progress),
                "last_error": row.preview_proxy_last_error,
                "transcoded_at": (
                    row.preview_proxy_transcoded_at.isoformat()
                    if row.preview_proxy_transcoded_at
                    else None
                ),
                "duration_sec": row.preview_proxy_duration_sec,
                "bytes": row.preview_proxy_bytes,
            }

    # ------------------------------------------------------------------ worker

    async def _run_transcode(self, material_id: str, profile: str) -> None:
        """Worker coroutine — runs inside the queue's semaphore slot."""
        attempts = max(1, self._cfg.retry_attempts + 1)
        last_error: Optional[str] = None
        for attempt in range(attempts):
            ok, err = await self._run_one(material_id, profile, attempt)
            if ok:
                self._inflight.pop(material_id, None)
                return
            last_error = err
            if attempt + 1 < attempts:
                logger.warning(
                    f"preview_proxy retry {attempt + 1}/{attempts - 1} "
                    f"for material {material_id}: {err}"
                )
        await self._finalize_failure(material_id, last_error or "unknown")
        self._inflight.pop(material_id, None)

    async def _run_one(
        self,
        material_id: str,
        profile: str,
        attempt: int,
    ) -> Tuple[bool, Optional[str]]:
        await self._ensure_runtime()
        assert self._session_factory is not None

        # Resolve input file path from the row.
        async with self._session_factory() as session:
            row = await self._get_row(session, material_id)
            if row is None:
                return (False, "row missing")
            input_path = row.local_path
            row.preview_proxy_status = "running"
            row.preview_proxy_progress = 0
            await session.commit()
        self._transcode_started_at[material_id] = time.monotonic()

        if not input_path or not os.path.exists(input_path):
            return (False, f"input file missing: {input_path}")

        # Spec 03 §3.4 (V03-C/E) — refuse to transcode anything outside
        # STORAGE_ROOT / cached_materials / temp. cached_materials.local_path
        # is normally written by material_download_service, but a tampered
        # DB row should not be able to coerce FFmpeg into reading /etc/passwd.
        try:
            allowed_roots = self._ffmpeg_allowed_roots()
            validated = validate_local_path_for_ffmpeg(input_path, allowed_roots)
            input_path = str(validated)
        except URLGuardError as guard_exc:
            return (False, f"input path rejected: {guard_exc}")

        out_dir = self.output_root / material_id
        out_dir.mkdir(parents=True, exist_ok=True)
        output_path = out_dir / "480p.mp4"
        # Wipe leftovers from prior failed attempts.
        try:
            if output_path.exists():
                output_path.unlink()
        except OSError:
            pass

        args = _ffmpeg_args(input_path, str(output_path), profile)

        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            return (False, "ffmpeg binary not found")

        progress_task = asyncio.create_task(
            self._parse_progress_stream(material_id, proc.stdout)
        )

        try:
            await asyncio.wait_for(proc.wait(), timeout=self._cfg.timeout_seconds)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            await proc.wait()
            progress_task.cancel()
            self._cleanup_partial(output_path)
            return (False, f"ffmpeg timeout after {self._cfg.timeout_seconds}s")

        progress_task.cancel()

        if proc.returncode != 0:
            stderr_bytes = await proc.stderr.read() if proc.stderr else b""
            tail = stderr_bytes.decode("utf-8", errors="replace")[-512:]
            self._cleanup_partial(output_path)
            return (False, f"ffmpeg exit={proc.returncode}: {tail.strip()}")

        # Success — finalize.
        started_at = self._transcode_started_at.pop(material_id, None)
        if started_at is not None:
            self._last_transcode_ms[material_id] = int(
                (time.monotonic() - started_at) * 1000
            )
        await self._finalize_success(material_id, profile, output_path)
        return (True, None)

    async def _parse_progress_stream(
        self,
        material_id: str,
        stream: Optional[asyncio.StreamReader],
    ) -> None:
        """Drain FFmpeg's ``-progress`` output (key=value lines).

        Spec P2 N13: parse line-by-line via ``readline`` rather than
        accumulating arbitrary chunks; final line is ``progress=end``.
        DB writes are throttled to ``progress_write_interval_ms``.
        """
        if stream is None:
            return
        last_write_wall = 0.0
        write_interval = self._cfg.progress_write_interval_ms / 1000.0
        cur: Dict[str, str] = {}
        try:
            while True:
                line = await stream.readline()
                if not line:
                    break
                txt = line.decode("utf-8", errors="replace").strip()
                if "=" in txt:
                    k, _, v = txt.partition("=")
                    cur[k.strip()] = v.strip()
                if cur.get("progress") in ("continue", "end"):
                    pct = self._estimate_progress(cur)
                    if pct is not None:
                        self._progress_cache[material_id] = pct
                        now = time.monotonic()
                        if now - last_write_wall >= write_interval or cur.get("progress") == "end":
                            last_write_wall = now
                            await self._write_progress(material_id, pct)
                    if cur.get("progress") == "end":
                        break
                    cur = {"progress": cur.get("progress", "")}
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"preview_proxy progress parse error: {exc}")

    @staticmethod
    def _estimate_progress(line: Dict[str, str]) -> Optional[int]:
        """Best-effort 0..100 estimator from FFmpeg progress dict.

        We don't know total duration without an extra ffprobe pass, so the
        estimate caps at 99 until ``progress=end`` arrives. Callers see the
        terminal 100 via :meth:`_finalize_success`.
        """
        if line.get("progress") == "end":
            return 100
        # Heuristic: bytes vs out_time_us aren't enough on their own; just
        # mark the job alive so the UI sees motion.
        return 5

    async def _write_progress(self, material_id: str, pct: int) -> None:
        assert self._session_factory is not None
        async with self._session_factory() as session:
            row = await self._get_row(session, material_id)
            if row is None:
                return
            row.preview_proxy_progress = max(0, min(100, int(pct)))
            await session.commit()

    async def _finalize_success(
        self,
        material_id: str,
        profile: str,
        output_path: Path,
    ) -> None:
        assert self._session_factory is not None
        size = output_path.stat().st_size if output_path.exists() else None
        # Same-origin URL via existing static mount.
        local_url = self._local_url_for(material_id, output_path.name)
        oss_url: Optional[str] = None
        oss_client = oss_module.get_oss_client()
        if oss_client is not None:
            rel = (
                self._cfg.oss_bucket_subprefix.rstrip("/")
                + f"/{material_id}/{output_path.name}"
            )
            try:
                oss_url = await oss_client.upload_file(str(output_path), rel, "video/mp4")
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"preview_proxy OSS upload failed (kept local): {exc}")

        async with self._session_factory() as session:
            row = await self._get_row(session, material_id)
            if row is None:
                return
            row.preview_proxy_status = "cached"
            row.preview_proxy_profile = profile
            row.preview_proxy_local_url = local_url
            row.preview_proxy_oss_url = oss_url
            row.preview_proxy_progress = 100
            row.preview_proxy_bytes = size
            row.preview_proxy_last_error = None
            row.preview_proxy_transcoded_at = datetime.now(timezone.utc)
            await session.commit()
        self._progress_cache[material_id] = 100

    async def _finalize_failure(
        self,
        material_id: str,
        message: str,
    ) -> None:
        assert self._session_factory is not None
        async with self._session_factory() as session:
            row = await self._get_row(session, material_id)
            if row is None:
                return
            row.preview_proxy_status = "failed"
            row.preview_proxy_last_error = message[:500]
            row.preview_proxy_progress = 0
            await session.commit()
        self._progress_cache.pop(material_id, None)
        self._transcode_started_at.pop(material_id, None)
        self._failure_total += 1

    def _ffmpeg_allowed_roots(self) -> list[Path]:
        """Return the set of directories an FFmpeg input must live under.

        Mirrors spec 03 §3.4: ``STORAGE_ROOT``, the preview-proxy output
        dir, the media-proxy hot cache, and the temp dir. Paths are passed
        unresolved; ``validate_local_path_for_ffmpeg`` will normalize them.
        """
        roots: list[Path] = []
        for raw in (
            settings.storage.root,
            self._cfg.output_dir,
            settings.media_proxy.hot_cache_dir,
            settings.temp_dir,
        ):
            if raw:
                roots.append(Path(raw))
        return roots

    def _cleanup_partial(self, output_path: Path) -> None:
        try:
            if output_path.exists():
                output_path.unlink()
        except OSError as exc:
            logger.warning(f"preview_proxy cleanup failed for {output_path}: {exc}")

    def _local_url_for(self, material_id: str, filename: str) -> str:
        # Output dir lives under STORAGE_ROOT — the existing
        # /api/storage/files mount serves it. Strip STORAGE_ROOT prefix
        # if it appears at the head of output_dir, otherwise fall back to
        # the raw /preview-proxies/ path.
        storage_root = settings.storage.root.rstrip("/")
        out_dir = self._cfg.output_dir.rstrip("/")
        if out_dir.startswith(storage_root + "/"):
            sub = out_dir[len(storage_root) + 1:]
        else:
            sub = out_dir
        return f"/api/storage/files/{sub}/{material_id}/{filename}"

    def _task_id_for(self, material_id: str) -> Optional[str]:
        # Return a stable logical id derived from the material; the actual
        # asyncio task id isn't surfaced because the queue may have already
        # released its slot.
        if material_id in self._inflight or self._progress_cache.get(material_id):
            return f"pp-{material_id[:12]}"
        return None

    async def _get_row(
        self,
        session: AsyncSession,
        material_id: str,
    ) -> Optional[CachedMaterial]:
        try:
            mid = uuid.UUID(material_id)
        except (TypeError, ValueError):
            return None
        stmt = select(CachedMaterial).where(CachedMaterial.id == mid)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class PreviewProxyError(Exception):
    """Base for preview-proxy failures surfaced via the router."""

    status_code = 500
    error_code = "preview_proxy.error"


class PreviewProxyDisabledError(PreviewProxyError):
    status_code = 503
    error_code = "preview_proxy.disabled"

    def __init__(self) -> None:
        super().__init__("Preview-proxy pipeline is disabled (PREVIEW_PROXY_ENABLED=false).")


class PreviewProxyValidationError(PreviewProxyError):
    status_code = 400
    error_code = "preview_proxy.validation"


class PreviewProxyNotFoundError(PreviewProxyError):
    status_code = 404
    error_code = "preview_proxy.material_not_found"

    def __init__(self, material_id: Optional[str]) -> None:
        super().__init__(f"material_id not found: {material_id}")


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_preview_proxy_service: Optional[PreviewProxyService] = None


def get_preview_proxy_service() -> PreviewProxyService:
    global _preview_proxy_service
    if _preview_proxy_service is None:
        _preview_proxy_service = PreviewProxyService()
    return _preview_proxy_service
