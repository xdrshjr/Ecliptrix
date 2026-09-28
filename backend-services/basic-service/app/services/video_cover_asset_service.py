"""项目封面的本地不可变资产、解码限额与文件生命周期。"""
import asyncio
import hashlib
import io
import ipaddress
import os
import shutil
import socket
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
from uuid import UUID, uuid4
from typing import Any, AsyncIterator, Callable

import httpx
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import ProjectCoverAsset, VideoProject
from app.models.video_cover_v2_models import CoverError
from app.services.storage_service import storage_service

MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 32_000_000
_locks: dict[str, asyncio.Lock] = {}
_leases: dict[str, int] = {}
_pending_cleanup: set[str] = set()
_decode_slots = asyncio.Semaphore(2)


def project_key(project_id: str | UUID) -> str:
    return str(UUID(str(project_id)))


@asynccontextmanager
async def project_locks(*project_ids: str | UUID) -> AsyncIterator[None]:
    keys = sorted({project_key(value) for value in project_ids})
    held = []
    try:
        for key in keys:
            lock = _locks.setdefault(key, asyncio.Lock())
            await lock.acquire()
            held.append(lock)
        yield
    finally:
        for lock in reversed(held):
            lock.release()


async def require_project(
    db: AsyncSession, project_id: str | UUID
) -> VideoProject:
    row = await db.get(
        VideoProject, UUID(str(project_id)), populate_existing=True
    )
    if row is None:
        raise CoverError("COVER_PROJECT_CHANGED", "项目不存在", 404)
    return row


def cover_directory(project_id: str | UUID) -> Path:
    root = Path(storage_service.root).resolve()
    path = root / "projects" / project_key(project_id) / "covers"
    resolved = path.resolve()
    if not resolved.is_relative_to(root) or resolved != path:
        raise CoverError("COVER_INVALID_ASSET", "资产路径越界")
    return resolved


def asset_path(asset: ProjectCoverAsset) -> Path:
    path = (Path(storage_service.root) / asset.relative_path).resolve()
    if not path.is_relative_to(cover_directory(asset.project_id)):
        raise CoverError("COVER_INVALID_ASSET", "资产路径越界")
    return path


def local_source_path(url: str) -> Path:
    parsed = urlsplit(url)
    prefix = "/api/storage/files/"
    if parsed.scheme or parsed.netloc or not parsed.path.startswith(prefix):
        raise CoverError("COVER_INVALID_ASSET", "仅接受本地素材存储引用")
    relative = unquote(parsed.path[len(prefix) :])
    if "\\" in relative or ":" in relative:
        raise CoverError("COVER_INVALID_ASSET", "无效的素材路径")
    root = Path(storage_service.root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise CoverError("COVER_ASSET_MISSING", "素材不存在或路径越界", 404)
    return path


def read_limited(path: Path) -> bytes:
    with path.open("rb") as handle:
        data = handle.read(MAX_BYTES + 1)
    check_size(len(data))
    return data


def check_size(size: int) -> None:
    if size > MAX_BYTES:
        raise CoverError("COVER_INVALID_ASSET", "图片超过 20 MiB", 413)


async def read_upload(upload) -> bytes:
    parts, size = [], 0
    while chunk := await upload.read(64 * 1024):
        size += len(chunk)
        check_size(size)
        parts.append(chunk)
    return b"".join(parts)


@dataclass(frozen=True)
class DecodedImage:
    data: bytes
    width: int
    height: int
    sha256: str


def _decode_image(data: bytes, png_only: bool) -> DecodedImage:
    check_size(len(data))
    try:
        with Image.open(io.BytesIO(data)) as original:
            allowed = {"PNG"} if png_only else {"PNG", "JPEG", "WEBP"}
            if (
                original.format not in allowed
                or getattr(original, "n_frames", 1) != 1
            ):
                raise ValueError("仅支持静态 PNG/JPEG/WebP")
            if original.width * original.height > MAX_PIXELS:
                raise ValueError("图片超过 3200 万像素")
            original.load()
            image = ImageOps.exif_transpose(original).convert("RGBA")
            image.info.clear()
            output = io.BytesIO()
            image.save(output, format="PNG")
            normalized = output.getvalue()
            check_size(len(normalized))
            return DecodedImage(
                normalized,
                image.width,
                image.height,
                hashlib.sha256(normalized).hexdigest(),
            )
    except CoverError:
        raise
    except Exception as exc:
        raise CoverError("COVER_INVALID_ASSET", "图片无法完整解码") from exc


async def decode_image(data: bytes, png_only: bool = False) -> DecodedImage:
    async with _decode_slots:
        return await run_blocking(_decode_image, data, png_only)


async def run_blocking(function: Callable[..., Any], *args: Any) -> Any:
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        # 工作线程不能被强杀；实际退出前必须占用执行额度和生命周期锁。
        # 消费线程异常但保留取消语义，防止损坏图片使已取消任务继续下一张。
        settled = asyncio.gather(task, return_exceptions=True)
        while not settled.done():
            try:
                await asyncio.shield(settled)
            except asyncio.CancelledError:
                continue
        raise


async def get_asset(
    db: AsyncSession, project_id: str | UUID, asset_id: str | UUID
) -> ProjectCoverAsset:
    try:
        row = await db.get(ProjectCoverAsset, UUID(str(asset_id)))
    except (ValueError, TypeError):
        row = None
    if row is None or str(row.project_id) != project_key(project_id):
        raise CoverError("COVER_ASSET_MISSING", "本项目资产不存在", 404)
    if not asset_path(row).is_file():
        raise CoverError("COVER_ASSET_MISSING", "资产文件已丢失", 404)
    return row


async def verify_asset(row: ProjectCoverAsset) -> bytes:
    try:
        data = await run_blocking(read_limited, asset_path(row))
        if hashlib.sha256(data).hexdigest() != row.sha256:
            raise CoverError("COVER_INVALID_ASSET", "资产文件已发生变化", 409)
        image = await decode_image(data, png_only=True)
        if (image.width, image.height) != (row.width, row.height):
            raise CoverError("COVER_INVALID_ASSET", "资产尺寸已发生变化", 409)
        return data
    except OSError as exc:
        raise CoverError("COVER_ASSET_MISSING", "资产文件不可读", 404) from exc


def asset_data(row: ProjectCoverAsset) -> dict:
    return {
        "asset_id": str(row.id),
        "url": "/api/storage/files/" + row.relative_path,
        "width": row.width,
        "height": row.height,
        "sha256": row.sha256,
    }


async def store_decoded(
    db: AsyncSession,
    project_id: str | UUID,
    image: DecodedImage,
    kind: str = "background",
) -> ProjectCoverAsset:
    """调用方持有项目锁；文件完成后才插入数据库记录。"""
    await require_project(db, project_id)
    existing = (
        (
            await db.execute(
                select(ProjectCoverAsset).where(
                    ProjectCoverAsset.project_id == UUID(str(project_id)),
                    ProjectCoverAsset.sha256 == image.sha256,
                    ProjectCoverAsset.kind == kind,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None and asset_path(existing).is_file():
        try:
            content = await run_blocking(read_limited, asset_path(existing))
            if hashlib.sha256(content).hexdigest() == image.sha256:
                return existing
        except (OSError, CoverError):
            pass  # 损坏的旧引用保持不可变；新上传另建正常资产。
    identifier = uuid4()
    relative = (
        f"projects/{project_key(project_id)}/covers/assets/{identifier}.png"
    )
    row = ProjectCoverAsset(
        id=identifier,
        project_id=UUID(str(project_id)),
        kind=kind,
        relative_path=relative,
        sha256=image.sha256,
        width=image.width,
        height=image.height,
        byte_size=len(image.data),
    )
    path = asset_path(row)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{uuid4().hex}.part")
    try:
        await run_blocking(temporary.write_bytes, image.data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    db.add(row)
    await db.flush()
    return row


async def _validate_remote(url: str) -> str:
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
    ):
        raise CoverError("COVER_INVALID_ASSET", "无效的供应商图片地址")
    addresses = await asyncio.get_running_loop().getaddrinfo(
        parsed.hostname,
        parsed.port or (443 if parsed.scheme == "https" else 80),
        type=socket.SOCK_STREAM,
    )
    if not addresses or any(
        not ipaddress.ip_address(item[4][0]).is_global for item in addresses
    ):
        raise CoverError("COVER_INVALID_ASSET", "禁止访问本地或私有网络")
    return addresses[0][4][0]


async def download_image(url: str) -> bytes:
    async with asyncio.timeout(60):
        async with httpx.AsyncClient(
            follow_redirects=False, trust_env=False
        ) as client:
            for _ in range(6):
                address = await _validate_remote(url)
                remote = httpx.URL(url)
                # 固定已验证的 IP，Host/SNI 保留原域名，防止二次 DNS 重绑定。
                target = remote.copy_with(host=address)
                headers = {
                    "Host": remote.netloc.decode("ascii"),
                    "Accept-Encoding": "identity",
                }
                async with client.stream(
                    "GET",
                    target,
                    headers=headers,
                    extensions={"sni_hostname": remote.host},
                ) as response:
                    if response.is_redirect:
                        url = urljoin(url, response.headers.get("location", ""))
                        continue
                    response.raise_for_status()
                    if (
                        response.headers.get(
                            "content-encoding", "identity"
                        ).lower()
                        != "identity"
                    ):
                        raise CoverError("COVER_INVALID_ASSET", "不支持压缩传输的图片响应")
                    pieces, size = [], 0
                    async for chunk in response.aiter_bytes(64 * 1024):
                        size += len(chunk)
                        check_size(size)
                        pieces.append(chunk)
                    return b"".join(pieces)
    raise CoverError("COVER_INVALID_ASSET", "图片重定向次数过多")


class AssetLease:
    def __init__(self, project_id: str | UUID) -> None:
        self.project_id = project_key(project_id)
        self.released = False
        _leases[self.project_id] = _leases.get(self.project_id, 0) + 1

    def release(self) -> None:
        if self.released:
            return
        self.released = True
        count = _leases[self.project_id] - 1
        if count:
            _leases[self.project_id] = count
        else:
            _leases.pop(self.project_id, None)
            if self.project_id in _pending_cleanup:
                cleanup_project_files(self.project_id)


def cleanup_project_files(project_id: str | UUID) -> None:
    key = project_key(project_id)
    if _leases.get(key, 0):
        _pending_cleanup.add(key)
        return
    directory = cover_directory(key)
    if directory.exists():
        shutil.rmtree(directory)
    from app.services.video_cover_service import video_cover_service

    video_cover_service.cleanup_files(key)
    _pending_cleanup.discard(key)


async def recover_storage(db: AsyncSession) -> None:
    root = Path(storage_service.root).resolve() / "projects"
    if not root.exists():
        return
    projects = {
        str(value)
        for value in (await db.execute(select(VideoProject.id))).scalars()
    }
    for path in root.iterdir():
        try:
            key = project_key(path.name)
        except ValueError:
            continue
        if key not in projects:
            cleanup_project_files(key)
        else:
            for part in cover_directory(key).rglob("*.part"):
                if part.stat().st_mtime < time.time() - 86400:
                    part.unlink(missing_ok=True)
