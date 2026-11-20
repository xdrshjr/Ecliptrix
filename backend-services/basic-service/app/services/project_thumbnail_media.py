"""项目缩略图的只读本地来源解析与有界 FFmpeg 抽帧。"""
import asyncio
from dataclasses import dataclass
import io
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from typing import Awaitable, TypeVar
from urllib.parse import unquote, urlsplit

from PIL import Image, UnidentifiedImageError

from app.services.local_media_resolver import LocalMediaResolveError, resolve_media_reference
from app.services.material_download_service import get_material_download_service
from app.services.project_thumbnail_source import ProjectThumbnailSelection
from app.services.video_cover_asset_service import run_blocking

MAX_JPEG_BYTES = 512 * 1024
MAX_STDERR_BYTES = 8 * 1024
DECODE_TIMEOUT = 8.0
SLOT_TIMEOUT = 2.0
WIDTH, HEIGHT = 640, 360
SCALE_FILTER = "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1"
_decode_slots = asyncio.Semaphore(2)
_T = TypeVar("_T")

_STATUSES = {
    "PROJECT_NOT_FOUND": 404, "EMPTY": 404, "SOURCE_UNAVAILABLE": 409,
    "STALE": 409, "BUSY": 503, "DECODER_UNAVAILABLE": 503, "TIMEOUT": 504,
    "DECODE_FAILED": 422, "STORAGE_UNAVAILABLE": 503,
}


class ProjectThumbnailError(Exception):
    """仅公开固定文本，诊断信息不得进入 HTTP 响应。"""

    def __init__(self, code: str) -> None:
        self.status = _STATUSES[code]
        self.code = code if code == "PROJECT_NOT_FOUND" else "PROJECT_THUMBNAIL_" + code
        super().__init__("无法读取项目视频缩略图")


@dataclass(frozen=True)
class ResolvedThumbnailSource:
    selection: ProjectThumbnailSelection
    path: Path
    input_reference: str
    size_bytes: int
    mtime_ns: int


async def within_budget(
    operation: Awaitable[_T], deadline: float, limit: float | None = None,
    limit_error: str = "TIMEOUT",
) -> _T:
    remaining = deadline - time.monotonic()
    timeout = max(0, min(remaining, limit) if limit is not None else remaining)
    task = asyncio.ensure_future(operation)
    code = "TIMEOUT" if remaining <= 0 or limit is None or remaining <= limit else limit_error
    try:
        if remaining <= 0:
            task.cancel()
            await _await_settlement(task)
            raise ProjectThumbnailError("TIMEOUT")
        # Python 3.10/3.11 的 wait_for 可能在完成与取消同拍时吞取消。
        # wait 不隐式取消子任务，下面统一负责取消与不可抢占清理。
        done, _ = await asyncio.wait({task}, timeout=timeout)
        if not done or time.monotonic() >= deadline:
            task.cancel()
            await _await_settlement(task)
            raise ProjectThumbnailError(code)
        return task.result()
    except asyncio.CancelledError:
        task.cancel()
        await settle_tasks(task)
        raise


async def settle_tasks(*tasks: asyncio.Task) -> None:
    """重复取消也必须等待不可抢占的资源清理真正结束。"""
    settled = asyncio.gather(*tasks, return_exceptions=True)
    while not settled.done():
        try:
            await asyncio.shield(settled)
        except asyncio.CancelledError:
            continue


async def _await_settlement(*tasks: asyncio.Task) -> None:
    cleanup = asyncio.create_task(settle_tasks(*tasks))
    try:
        await asyncio.shield(cleanup)
    except asyncio.CancelledError:
        await settle_tasks(cleanup)
        raise


def _resolve_local(selection: ProjectThumbnailSelection, reference: str) -> ResolvedThumbnailSource | None:
    try:
        parsed = urlsplit(reference)
        path = unquote(parsed.path).lower()
        excluded = ("/api/media/proxy", "/api/media/preview-proxy",
                    "/api/storage/files/preview-proxies/")
        if (parsed.scheme.lower() in {"blob", "data", "file"}
                or any(path.startswith(prefix) for prefix in excluded)
                or re.fullmatch(r"/api/video-projects/[^/]+/thumbnail/?", path)):
            return None
        resolved = resolve_media_reference(reference, allow_remote=False).path.resolve()
        info = resolved.stat()
        if not resolved.is_file():
            return None
        return ResolvedThumbnailSource(selection, resolved, reference, info.st_size, info.st_mtime_ns)
    except (LocalMediaResolveError, OSError, ValueError):
        return None


async def resolve_thumbnail_source(
    selection: ProjectThumbnailSelection, *, deadline: float,
) -> ResolvedThumbnailSource:
    """只查所选片段的本地引用和已落地缓存，绝不触发下载。"""
    for reference in selection.references:
        result = await within_budget(run_blocking(_resolve_local, selection, reference), deadline)
        if result:
            return result
    queries = []
    if selection.source and selection.source_id:
        queries.append({"source": selection.source, "source_id": selection.source_id})
    queries.extend({"url": url} for url in selection.remote_urls)
    if queries:
        cache = get_material_download_service()
        for query in queries:
            row = await within_budget(cache.lookup_async(**query), deadline)
            if row is None or row.status != "ready":
                continue
            reference = await within_budget(run_blocking(cache.local_url_for, row), deadline)
            if reference:
                result = await within_budget(run_blocking(_resolve_local, selection, reference), deadline)
                if result:
                    return result
    raise ProjectThumbnailError("SOURCE_UNAVAILABLE")


def validate_jpeg(data: bytes) -> bytes:
    """验证有限、单帧且固定尺寸的 JPEG，不能信任已有缓存。"""
    if not data or len(data) > MAX_JPEG_BYTES:
        raise ProjectThumbnailError("DECODE_FAILED")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if (image.format != "JPEG" or image.size != (WIDTH, HEIGHT)
                    or getattr(image, "n_frames", 1) != 1):
                raise ProjectThumbnailError("DECODE_FAILED")
            image.load()
            image.verify()
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ProjectThumbnailError("DECODE_FAILED") from exc
    return data


def thumbnail_arguments(executable: str, path: Path, clip_start: float) -> list[str]:
    return [executable, "-hide_banner", "-loglevel", "error", "-nostdin",
            "-filter_threads", "1", "-threads", "1", "-ss", str(clip_start),
            "-i", path.as_posix(), "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-dn",
            "-threads", "1", "-vf", SCALE_FILTER, "-q:v", "3", "-f", "image2pipe",
            "-vcodec", "mjpeg", "pipe:1"]


async def _read_stdout(stream: asyncio.StreamReader) -> bytes:
    parts, size = [], 0
    while chunk := await stream.read(64 * 1024):
        size += len(chunk)
        if size > MAX_JPEG_BYTES:
            raise ProjectThumbnailError("DECODE_FAILED")
        parts.append(chunk)
    return b"".join(parts)


async def _drain_stderr(stream: asyncio.StreamReader) -> bytes:
    tail = b""
    while chunk := await stream.read(8 * 1024):
        tail = (tail + chunk)[-MAX_STDERR_BYTES:]
    return tail


async def _discard_stream(stream: asyncio.StreamReader) -> None:
    while await stream.read(64 * 1024):
        pass


async def _finish_process(launch: asyncio.Task, pipes: list[asyncio.Task]) -> None:
    await settle_tasks(launch)
    if not launch.cancelled() and launch.exception() is None:
        process = launch.result()
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        for task in pipes:
            if not task.done():
                task.cancel()
        await settle_tasks(*pipes)
        # 超限 reader 已退出时必须继续丢弃缓冲；否则 paused transport
        # 不关闭管道，已 kill 的进程也可能使 wait 永久挂起。
        await settle_tasks(asyncio.create_task(process.wait()),
                           asyncio.create_task(_discard_stream(process.stdout)),
                           asyncio.create_task(_discard_stream(process.stderr)))


async def _decode(source: ResolvedThumbnailSource, executable: str, deadline: float) -> bytes:
    args = thumbnail_arguments(executable, source.path, source.selection.clip_start)
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
    launch = asyncio.create_task(asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, **options))
    pipes = []
    try:
        process = await within_budget(asyncio.shield(launch), deadline)
        pipes = [asyncio.create_task(_read_stdout(process.stdout)),
                 asyncio.create_task(_drain_stderr(process.stderr)),
                 asyncio.create_task(process.wait())]
        data, _, code = await within_budget(asyncio.gather(*pipes), deadline, DECODE_TIMEOUT)
        if code:
            raise ProjectThumbnailError("DECODE_FAILED")
        return await within_budget(run_blocking(validate_jpeg, data), deadline)
    except OSError as exc:
        raise ProjectThumbnailError("DECODER_UNAVAILABLE") from exc
    finally:
        # shield only cleanup, never the business operation or the pipe readers.
        cleanup = asyncio.create_task(_finish_process(launch, pipes))
        try:
            await asyncio.shield(cleanup)
        except asyncio.CancelledError:
            await settle_tasks(cleanup)
            raise


async def extract_thumbnail(source: ResolvedThumbnailSource, *, deadline: float) -> bytes:
    """进程、管道和线程全部退出后才释放全局解码槽位。"""
    executable = shutil.which("ffmpeg")
    if not executable:
        raise ProjectThumbnailError("DECODER_UNAVAILABLE")
    acquired = False
    async def acquire() -> None:
        nonlocal acquired
        await _decode_slots.acquire()
        acquired = True
    try:
        await within_budget(acquire(), deadline, SLOT_TIMEOUT, "BUSY")
        return await _decode(source, executable, deadline)
    finally:
        if acquired:
            _decode_slots.release()
