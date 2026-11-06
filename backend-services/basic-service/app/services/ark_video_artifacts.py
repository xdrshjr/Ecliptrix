"""验证真实 MP4 并登记可离线使用的本地缓存副本。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
from datetime import date
from pathlib import Path
from uuid import uuid4

import aiofiles

from app.config import settings
from app.services.credential_errors import VideoError
from app.services.ark_video_task_context import validate_task_id

_download_semaphore = asyncio.Semaphore(1)
MAX_VIDEO_BYTES = 128 * 1024 * 1024


async def _read_bounded(stream: asyncio.StreamReader, limit: int = 1024 * 1024) -> bytes:
    result = bytearray()
    while chunk := await stream.read(16384):
        result.extend(chunk)
        if len(result) > limit:
            raise VideoError("invalid_video_artifact", status_code=502)
    return bytes(result)


async def run_media_process(command: list[str], timeout: float) -> bytes:
    """取消、超时及输出超限都先回收子进程，不保留无限 stderr。"""
    process = None
    readers = []
    try:
        process = await asyncio.create_subprocess_exec(
            *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        readers = [asyncio.create_task(_read_bounded(process.stdout)), asyncio.create_task(_read_bounded(process.stderr))]
        async with asyncio.timeout(timeout):
            stdout, _ = await asyncio.gather(*readers)
            await process.wait()
        if process.returncode != 0:
            raise VideoError("invalid_video_artifact", status_code=502)
        return stdout
    except asyncio.CancelledError:
        raise
    except (OSError, TimeoutError):
        raise VideoError("invalid_video_artifact", status_code=502) from None
    finally:
        if process and process.returncode is None:
            process.kill()
            await process.wait()
        for reader in readers:
            if not reader.done():
                reader.cancel()
        if readers:
            await asyncio.gather(*readers, return_exceptions=True)


async def validate_video(path: Path) -> dict:
    """完整解码视频与可选音轨，至少两个输出帧，不补帧。"""
    try:
        if not path.is_file() or not 0 < path.stat().st_size <= MAX_VIDEO_BYTES:
            raise ValueError
        async with aiofiles.open(path, "rb") as file:
            header = await file.read(12)
        if header[4:8] != b"ftyp" or header[8:12] == b"qt  ":
            raise ValueError
        output = await run_media_process([
            "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams",
            "-show_format", "-of", "json", str(path),
        ], 15)
        probe = json.loads(output)
        if "mp4" not in probe.get("format", {}).get("format_name", "").split(","):
            raise ValueError
        stream = next(s for s in probe["streams"] if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic"))
        width, height = int(stream["width"]), int(stream["height"])
        duration = float(stream.get("duration") or probe["format"]["duration"])
        if width <= 0 or height <= 0 or not math.isfinite(duration) or duration <= 0:
            raise ValueError
        progress = await run_media_process([
            "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode",
            "-protocol_whitelist", "file,pipe", "-i", str(path), "-map", f"0:{stream['index']}",
            "-map", "0:a?", "-fps_mode", "passthrough", "-progress", "pipe:1", "-f", "null", "-",
        ], 120)
        frames = [int(line.split("=", 1)[1]) for line in progress.decode("ascii").splitlines() if line.startswith("frame=")]
        if not frames or max(frames) < 2:
            raise ValueError
        return {"width": width, "height": height, "duration": duration}
    except (OSError, ValueError, KeyError, TypeError, StopIteration):
        raise VideoError("invalid_video_artifact", status_code=502) from None


def file_fingerprint(path: Path) -> tuple[str, int, int]:
    stat = path.stat()
    return (str(path.resolve()), stat.st_size, stat.st_mtime_ns)


def _digest(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return path.stat().st_size, digest.hexdigest()


async def lookup_cached(task_id: str) -> Path | None:
    from app.services.material_download_service import get_material_download_service
    try:
        service = get_material_download_service()
        row = await service.lookup_async(source="ark", source_id=task_id)
        return _cache_path(row, task_id) if row else None
    except (OSError, ValueError, VideoError):
        return None


async def find_original(task_id: str) -> Path | None:
    """只查本地原件，完整校验仍在后台进行，GET 不阻塞解码。"""
    validate_task_id(task_id)
    root = Path(settings.storage.root).resolve() / "video" / "ark"
    def find() -> Path | None:
        for path in sorted(root.glob(f"*/{task_id}.mp4"), reverse=True):
            if path.resolve().is_relative_to(root) and path.is_file():
                return path
        return None
    return await asyncio.to_thread(find)


def _cache_path(row, task_id: str) -> Path:
    if row.source != "ark" or row.source_id != task_id or row.status != "ready" or not row.local_path:
        raise VideoError("video_cache_failed", status_code=502)
    path = Path(row.local_path).resolve(strict=True)
    root = Path(settings.storage.root).resolve()
    if not path.is_relative_to(root / "cached_materials" / "ark") or not path.is_file():
        raise VideoError("video_cache_failed", status_code=502)
    return path


async def _register(task_id: str, path: Path, remote_url: str | None) -> tuple[Path, str]:
    from app.services.material_download_service import get_material_download_service
    try:
        service = get_material_download_service()
        local_source = "/api/storage/files/" + path.resolve().relative_to(Path(settings.storage.root).resolve()).as_posix()
        # 本地标识稳定且无签名，避免缓存服务错误日志或行中留存短期 CDN 签名。
        await service.store_external_download_async(url=local_source, local_path=str(path), source="ark", source_id=task_id)
        row = await service.lookup_async(source="ark", source_id=task_id)
        cached = _cache_path(row, task_id)
        original_hash, cache_hash = await asyncio.gather(asyncio.to_thread(_digest, path), asyncio.to_thread(_digest, cached))
        local_url = service.local_url_for(row)
        if original_hash != cache_hash or not local_url or not local_url.startswith("/api/storage/files/cached_materials/ark/"):
            raise ValueError
        return cached, local_url
    except asyncio.CancelledError:
        raise
    except Exception:
        raise VideoError("video_cache_failed", status_code=502) from None


async def _download(url: str, target: Path) -> None:
    from app.services.web_research.safe_http_client import SafeHttpClient, FetchPolicy, RequestSpec, default_proxy_settings
    proxy = {**default_proxy_settings(), "egress_mode": "strict", "egress_allow_hosts": (), "concurrency": 1}
    client = SafeHttpClient(proxy_settings=proxy)
    async with _download_semaphore:
        for attempt in range(2):
            part = target.with_name(f"{target.name}.{uuid4().hex}.part")
            try:
                result = await client.fetch(FetchPolicy(max_bytes=MAX_VIDEO_BYTES, timeout=120, respect_robots=False, document=False), RequestSpec(url=url))
                if result.status != 200 or not result.body or len(result.body) > MAX_VIDEO_BYTES:
                    raise ValueError
                async with aiofiles.open(part, "wb") as file:
                    await file.write(result.body)
                del result
                await validate_video(part)
                part.replace(target)
                return
            except asyncio.CancelledError:
                raise
            except VideoError:
                raise
            except Exception:
                if attempt == 1:
                    raise VideoError("video_download_failed", status_code=502) from None
            finally:
                part.unlink(missing_ok=True)


async def _thumbnail(path: Path, task_id: str) -> str | None:
    target = path.with_name(f"thumb_{task_id}.jpg")
    try:
        await run_media_process([
            "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(path),
            "-frames:v", "1", "-vf", "scale=320:-1", "-y", str(target),
        ], 30)
        return "/api/storage/files/" + target.resolve().relative_to(Path(settings.storage.root).resolve()).as_posix()
    except (VideoError, ValueError, OSError):
        return None


async def collect_artifact(task_id: str, remote_url: str | None, cached_path: Path | None = None, phase=None) -> dict:
    validate_task_id(task_id)
    root = Path(settings.storage.root).resolve()
    target = cached_path or root / "video" / "ark" / date.today().strftime("%Y%m%d") / f"{task_id}.mp4"
    target.parent.mkdir(parents=True, exist_ok=True)
    metadata = None
    if target.is_file():
        try:
            if phase:
                phase("validating")
            metadata = await validate_video(target)
        except VideoError:
            if cached_path or not remote_url:
                raise
    if metadata is None:
        if not remote_url:
            raise VideoError("invalid_video_artifact", status_code=502)
        if phase:
            phase("downloading")
        await _download(remote_url, target)
        if phase:
            phase("validating")
        metadata = await validate_video(target)
    cached, local_url = await _register(task_id, target, remote_url)
    return {
        **metadata, "video_url": local_url, "thumbnail_url": await _thumbnail(cached, task_id),
        "_fingerprint": file_fingerprint(cached),
    }
