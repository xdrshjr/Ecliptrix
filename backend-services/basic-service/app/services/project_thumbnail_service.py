"""项目卡片缩略图：双快照复核、独立生成锁和可重建本地缓存。"""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
from typing import AsyncIterator, Callable
from uuid import UUID, uuid4

from sqlalchemy import select

from app.database import async_session_factory
from app.logger import get_logger
from app.models.db_models import VideoProject
from app.services.project_thumbnail_media import (
    MAX_JPEG_BYTES, ProjectThumbnailError, ResolvedThumbnailSource,
    extract_thumbnail, resolve_thumbnail_source, validate_jpeg, within_budget,
)
from app.services.project_thumbnail_source import ProjectThumbnailSelection, select_project_thumbnail
from app.services.storage_service import storage_service
from app.services.video_cover_asset_service import project_locks, run_blocking

logger = get_logger(__name__)
WORK_BUDGET = 15.0
GENERATION_LOCK_TIMEOUT = 10.0
MAX_CACHE_FILES = 3
_JPEG_NAME = re.compile(r"[0-9a-f]{64}\.jpg\Z")
_PART_NAME = re.compile(r"[0-9a-f]{64}\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.part\Z")


@dataclass
class _GenerationLock:
    lock: asyncio.Lock
    users: int = 0


_generation_locks: dict[str, _GenerationLock] = {}


@asynccontextmanager
async def _generation_lock(key: str, deadline: float) -> AsyncIterator[None]:
    entry = _generation_locks.setdefault(key, _GenerationLock(asyncio.Lock()))
    entry.users += 1
    acquired = False
    async def acquire() -> None:
        nonlocal acquired
        await entry.lock.acquire()
        acquired = True
    try:
        await within_budget(acquire(), deadline, GENERATION_LOCK_TIMEOUT, "BUSY")
        yield
    finally:
        if acquired:
            entry.lock.release()
        entry.users -= 1
        if not entry.users:
            _generation_locks.pop(key, None)


@asynccontextmanager
async def _project_lock(key: str, deadline: float) -> AsyncIterator[None]:
    context = project_locks(key)
    entered = False
    async def enter() -> None:
        nonlocal entered
        await context.__aenter__()
        entered = True
    try:
        await within_budget(enter(), deadline)
        yield
    finally:
        if entered:
            await context.__aexit__(None, None, None)


def _is_link(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def thumbnail_directory(project_id: str | UUID, create: bool = False) -> Path:
    """精确检查所有归属层，连指向同根其他目录的 junction 也拒绝。"""
    root = Path(storage_service.root).resolve()
    key = str(UUID(str(project_id)))
    path = root
    for component in ("projects", key, "thumbnails"):
        path = path / component
        try:
            info = path.lstat()
        except FileNotFoundError:
            if not create:
                continue
            path.mkdir()
            info = path.lstat()
        if _is_link(info) or not stat.S_ISDIR(info.st_mode) or path.resolve() != path:
            raise OSError("缩略图目录归属无效")
    if not path.is_relative_to(root):
        raise OSError("缩略图目录越界")
    return path


def _regular_file(path: Path) -> os.stat_result | None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if _is_link(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise OSError("缩略图缓存不是本层单链接普通文件")
    return info


def cache_key(project_id: str, source: ResolvedThumbnailSource) -> str:
    payload = {"version": "project-thumbnail-v1", "project_id": project_id,
               "selection": asdict(source.selection), "reference": source.input_reference,
               "path": str(source.path), "size": source.size_bytes, "mtime_ns": source.mtime_ns,
               "width": 640, "height": 360, "quality": 3, "scale": "contain-pad-v1"}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _cache_path(project_id: str, key: str, create: bool = False) -> Path:
    if not re.fullmatch(r"[0-9a-f]{64}", key):
        raise ValueError("缓存键必须是服务端散列")
    return thumbnail_directory(project_id, create) / (key + ".jpg")


def _read_cache(project_id: str, key: str) -> bytes | None:
    path = _cache_path(project_id, key)
    before = _regular_file(path)
    if before is None:
        return None
    with path.open("rb") as handle:
        opened = os.fstat(handle.fileno())
        if opened.st_nlink != 1 or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise OSError("缩略图缓存读取期间发生替换")
        data = handle.read(MAX_JPEG_BYTES + 1)
    try:
        return validate_jpeg(data)
    except ProjectThumbnailError:
        return None


def _prune(project_id: str, keep: Path | None = None) -> None:
    directory = thumbnail_directory(project_id)
    files = []
    if not directory.exists():
        return
    for path in directory.iterdir():
        if _JPEG_NAME.fullmatch(path.name):
            try:
                info = _regular_file(path)
            except OSError:
                continue
            if info:
                files.append((path, info.st_mtime_ns))
    files.sort(key=lambda entry: (entry[0] == keep, entry[1], entry[0].name), reverse=True)
    for path, _ in files[MAX_CACHE_FILES:]:
        thumbnail_directory(project_id)
        if _regular_file(path):
            path.unlink()


def _touch_cache(project_id: str, key: str) -> None:
    path = _cache_path(project_id, key)
    before = _regular_file(path)
    if before is None:
        raise OSError("缓存文件已消失")
    with path.open("rb+") as handle:
        opened = os.fstat(handle.fileno())
        if opened.st_nlink != 1 or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise OSError("缓存时间戳更新前发生替换")
        if os.name == "nt":
            _touch_windows_handle(handle.fileno())
        else:
            os.utime(handle.fileno(), None)
    _prune(project_id, path)


def _touch_windows_handle(descriptor: int) -> None:
    # Windows 不支持 utime 的 fd/no-follow 模式；用已校验句柄更新同一文件。
    import ctypes
    from ctypes import wintypes
    import msvcrt

    timestamp = time.time_ns() // 100 + 116444736000000000
    value = wintypes.FILETIME(timestamp & 0xFFFFFFFF, timestamp >> 32)
    set_time = ctypes.WinDLL("kernel32", use_last_error=True).SetFileTime
    set_time.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.FILETIME),
                        ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME)]
    set_time.restype = wintypes.BOOL
    if not set_time(msvcrt.get_osfhandle(descriptor), None, None, ctypes.byref(value)):
        raise ctypes.WinError(ctypes.get_last_error())


def _write_cache(project_id: str, key: str, data: bytes) -> None:
    path = _cache_path(project_id, key, create=True)
    _regular_file(path)
    temporary = path.with_name(f"{key}.{uuid4()}.part")
    try:
        with temporary.open("xb") as handle:
            handle.write(data)
        thumbnail_directory(project_id)
        _regular_file(temporary)
        _regular_file(path)
        os.replace(temporary, path)
        _prune(project_id, path)
    finally:
        thumbnail_directory(project_id)
        if _regular_file(temporary):
            temporary.unlink()


def cleanup_project_thumbnails(project_id: str | UUID) -> None:
    """只清理目标项目本层合法普通缓存，绝不递归删除。"""
    directory = thumbnail_directory(project_id)
    if not directory.exists():
        return
    for path in directory.iterdir():
        if not (_JPEG_NAME.fullmatch(path.name) or _PART_NAME.fullmatch(path.name)):
            continue
        thumbnail_directory(project_id)
        try:
            if _regular_file(path):
                path.unlink()
        except OSError:
            logger.warning("跳过不可安全清理的项目缩略图", {"project_id": str(project_id)})
    if not any(directory.iterdir()):
        directory.rmdir()


def recover_project_thumbnails(project_id: str | UUID, is_live: bool) -> None:
    if not is_live:
        cleanup_project_thumbnails(project_id)
        return
    directory = thumbnail_directory(project_id)
    if not directory.exists():
        return
    for path in directory.iterdir():
        if _PART_NAME.fullmatch(path.name):
            thumbnail_directory(project_id)
            try:
                info = _regular_file(path)
            except OSError:
                continue
            if info and info.st_mtime < time.time() - 86400:
                path.unlink()
    _prune(str(project_id))


class ProjectThumbnailService:
    def __init__(self, session_factory: Callable | None = None) -> None:
        self._session_factory = session_factory or async_session_factory

    async def _selection(self, project_id: UUID, user_id: str) -> ProjectThumbnailSelection | None:
        async with self._session_factory() as db:
            row = (await db.execute(select(VideoProject).where(
                VideoProject.id == project_id, VideoProject.user_id == user_id))).scalar_one_or_none()
            if row is None:
                raise ProjectThumbnailError("PROJECT_NOT_FOUND")
            return select_project_thumbnail(row.project_data)

    async def _verify(self, project_id: UUID, user_id: str,
                      source: ResolvedThumbnailSource, deadline: float) -> None:
        selection = await within_budget(self._selection(project_id, user_id), deadline)
        if selection != source.selection:
            raise ProjectThumbnailError("STALE")
        try:
            current = await resolve_thumbnail_source(selection, deadline=deadline)
        except ProjectThumbnailError as exc:
            if exc.code == "PROJECT_THUMBNAIL_SOURCE_UNAVAILABLE":
                raise ProjectThumbnailError("STALE") from exc
            raise
        if current != source:
            raise ProjectThumbnailError("STALE")

    async def get_thumbnail(self, project_id: UUID, user_id: str) -> bytes:
        deadline = time.monotonic() + WORK_BUDGET
        project_id = UUID(str(project_id))
        key = str(project_id)
        try:
            async with _generation_lock(key, deadline):
                return await self._generate(project_id, user_id, deadline)
        except OSError as exc:
            logger.warning("项目缩略图缓存不可用", {"project_id": key})
            raise ProjectThumbnailError("STORAGE_UNAVAILABLE") from exc

    async def _generate(self, project_id: UUID, user_id: str, deadline: float) -> bytes:
        key = str(project_id)
        async with _project_lock(key, deadline):
            selection = await within_budget(self._selection(project_id, user_id), deadline)
        if selection is None:
            raise ProjectThumbnailError("EMPTY")
        source = await resolve_thumbnail_source(selection, deadline=deadline)
        fingerprint = cache_key(key, source)
        data = await within_budget(run_blocking(_read_cache, key, fingerprint), deadline)
        hit = data is not None
        if not hit:
            data = await extract_thumbnail(source, deadline=deadline)
        async with _project_lock(key, deadline):
            await self._verify(project_id, user_id, source, deadline)
            if hit:
                await within_budget(run_blocking(_touch_cache, key, fingerprint), deadline)
            else:
                await within_budget(run_blocking(_write_cache, key, fingerprint, data), deadline)
        return data


project_thumbnail_service = ProjectThumbnailService()
