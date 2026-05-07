"""
Frame pack service — packages a list of in-browser-captured JPEG frames
plus a manifest into the on-disk pack layout already used by storyboard /
character / scene packs (see :mod:`grid_pack_service`).

A frame pack is a curated set of single-frame snapshots taken from one
source video material. The browser captures each snapshot via the canvas
API and posts a multipart payload (one JPEG per frame plus a JSON
manifest) to ``POST /api/frame-pack/create``; this service is responsible
for materialising the pack on disk and binding it to the owning project
through :mod:`pack_ownership_service` inside the same async DB session
(see spec §2.4 P0-3).
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import aiofiles
import yaml
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.logger import get_logger
from app.services import grid_pack_service
from app.services.grid_pack_service import (
    FRAME_STORAGE_DIR,
    PACK_TYPE_FRAME,
    validate_pack_id,
)
from app.services.oss_client import get_oss_client

logger = get_logger(__name__)

FRAME_FILE_EXT = "jpg"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_DEFAULT_CONFIG: Dict[str, Any] = {
    "max_frames_per_pack": 200,
    "max_concurrent_creates": 4,
    "jpeg_quality": 92,
    "max_request_mb": 256,
}

_config_cache: Optional[Dict[str, Any]] = None


def _config() -> Dict[str, Any]:
    """Lazily load ``config/frame-pack-config.yaml`` once per process."""
    global _config_cache
    if _config_cache is not None:
        return _config_cache

    cfg = dict(_DEFAULT_CONFIG)
    config_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "config",
    )
    yaml_path = os.path.join(config_dir, "frame-pack-config.yaml")
    if os.path.isfile(yaml_path):
        try:
            with open(yaml_path, "r", encoding="utf-8") as f:
                loaded = yaml.safe_load(f) or {}
            for key in _DEFAULT_CONFIG:
                if key in loaded:
                    cfg[key] = loaded[key]
        except Exception as exc:
            logger.warning(f"Failed to read frame-pack-config.yaml: {exc}")
    _config_cache = cfg
    return cfg


def max_frames_per_pack() -> int:
    return int(_config()["max_frames_per_pack"])


def max_request_bytes() -> int:
    return int(_config()["max_request_mb"]) * 1024 * 1024


# ---------------------------------------------------------------------------
# Concurrency control
# ---------------------------------------------------------------------------

_create_semaphore: Optional[asyncio.Semaphore] = None


def _get_create_semaphore() -> asyncio.Semaphore:
    global _create_semaphore
    if _create_semaphore is None:
        _create_semaphore = asyncio.Semaphore(int(_config()["max_concurrent_creates"]))
    return _create_semaphore


# ---------------------------------------------------------------------------
# Layout helpers
# ---------------------------------------------------------------------------

def _frame_pack_base_dir() -> str:
    return os.path.join(settings.storage.root, FRAME_STORAGE_DIR)


def _pack_dir(pack_id: str) -> Optional[str]:
    """Locate the on-disk pack directory by scanning date dirs."""
    validate_pack_id(pack_id)
    base = _frame_pack_base_dir()
    if not os.path.isdir(base):
        return None
    for date_dir in sorted(os.listdir(base), reverse=True):
        candidate = os.path.join(base, date_dir, pack_id)
        if os.path.isdir(candidate):
            return candidate
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def create_pack(
    *,
    db: AsyncSession,
    user_id: str,
    project_id: str,
    source_material_id: str,
    source_material_name: str,
    source_duration_sec: float,
    frames: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Create a frame pack on disk and persist the ownership row.

    Each entry in ``frames`` must be a dict with keys::

        {
            "index": int,           # 1-based ordinal, must match file ordering
            "filename": str,        # frame_NNN.jpg
            "timestamp_sec": float,
            "width": int,
            "height": int,
            "data": bytes,          # raw JPEG bytes for this frame
        }

    The router is responsible for parsing the multipart body, validating the
    manifest/file ordinal pairing, and assembling this list. We do the disk
    write + ownership upsert inside the same async DB session (P0-3) so a
    failure in either half rolls back the other.
    """
    if not frames:
        raise ValueError("frames must not be empty")

    cap = max_frames_per_pack()
    if len(frames) > cap:
        raise ValueError(
            f"frame_count_exceeds_limit: {len(frames)} > {cap}"
        )

    semaphore = _get_create_semaphore()
    async with semaphore:
        return await _create_pack_inner(
            db=db,
            user_id=user_id,
            project_id=project_id,
            source_material_id=source_material_id,
            source_material_name=source_material_name,
            source_duration_sec=source_duration_sec,
            frames=frames,
        )


async def _create_pack_inner(
    *,
    db: AsyncSession,
    user_id: str,
    project_id: str,
    source_material_id: str,
    source_material_name: str,
    source_duration_sec: float,
    frames: List[Dict[str, Any]],
) -> Dict[str, Any]:
    pack_id = uuid4().hex[:16]
    today_str = date.today().strftime("%Y%m%d")
    pack_directory = os.path.join(_frame_pack_base_dir(), today_str, pack_id)

    try:
        os.makedirs(pack_directory, exist_ok=True)

        # Sort by ascending timestamp so file ordinals reflect time order.
        ordered = sorted(frames, key=lambda fr: float(fr.get("timestamp_sec", 0.0)))

        frame_meta: List[Dict[str, Any]] = []
        for i, fr in enumerate(ordered, start=1):
            filename = f"frame_{i:03d}.{FRAME_FILE_EXT}"
            file_path = os.path.join(pack_directory, filename)
            data: bytes = fr["data"]
            async with aiofiles.open(file_path, "wb") as out:
                await out.write(data)
            frame_meta.append({
                "index": i,
                "filename": filename,
                "timestamp_sec": float(fr.get("timestamp_sec", 0.0)),
                "width": int(fr.get("width", 0)) or 0,
                "height": int(fr.get("height", 0)) or 0,
                # row/col are required by the shared ImagePack response shape
                # (the unified frontend card reads them). Frame packs are not
                # a grid so we pin them at (0, i-1) — column = ordinal.
                "row": 0,
                "col": i - 1,
            })

        # Copy the first frame as ``original.jpg`` so the existing pack-card
        # thumbnail logic ("original_image_url") works without UI changes.
        original_path = os.path.join(pack_directory, f"original.{FRAME_FILE_EXT}")
        first_frame_path = os.path.join(pack_directory, frame_meta[0]["filename"])
        try:
            shutil.copyfile(first_frame_path, original_path)
        except Exception as exc:
            logger.warning(
                f"Failed to copy first frame to original.jpg for pack {pack_id}: {exc}"
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        metadata = {
            "pack_id": pack_id,
            "pack_type": PACK_TYPE_FRAME,
            "file_ext": FRAME_FILE_EXT,
            "project_id": project_id,
            "user_id": user_id,
            "source_material_id": source_material_id,
            "source_material_name": source_material_name,
            "source_duration_sec": float(source_duration_sec),
            "frame_count": len(frame_meta),
            "aspect_ratio": "preserved-from-source",
            "grid_size": f"1x{len(frame_meta)}",
            "created_at": now_iso,
            "frames": frame_meta,
        }

        metadata_path = os.path.join(pack_directory, "metadata.json")
        async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(metadata, ensure_ascii=False, indent=2))

        # Upsert ownership row in the same async session as the disk write.
        # Last step before commit so a rollback removes the row but the disk
        # dir is cleaned up in the except block below.
        from app.services import pack_ownership_service

        await pack_ownership_service.upsert(
            db=db,
            pack_id=pack_id,
            project_id=project_id,
            user_id=user_id,
            pack_type=PACK_TYPE_FRAME,
        )

        # Build the response payload identical to the shared ImagePack shape.
        return grid_pack_service._pack_dict_from_metadata(
            PACK_TYPE_FRAME, today_str, metadata
        )
    except Exception:
        # Best-effort cleanup of the on-disk dir if any step after mkdir
        # failed — matches the storyboard service's failure semantics so
        # callers never see a half-written pack with no ownership row.
        try:
            shutil.rmtree(pack_directory, ignore_errors=True)
        except Exception as cleanup_exc:
            logger.warning(
                f"Cleanup after frame-pack failure also failed for {pack_id}: {cleanup_exc}"
            )
        raise


async def get_pack(pack_id: str) -> Dict[str, Any]:
    """Load and return a single frame pack."""
    validate_pack_id(pack_id)
    pack_directory = _pack_dir(pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Frame pack not found: {pack_id}")

    metadata_path = os.path.join(pack_directory, "metadata.json")
    if not os.path.isfile(metadata_path):
        raise FileNotFoundError(f"metadata.json missing for frame pack: {pack_id}")
    async with aiofiles.open(metadata_path, "r", encoding="utf-8") as f:
        meta = json.loads(await f.read())

    date_str = Path(pack_directory).parent.name
    return grid_pack_service._pack_dict_from_metadata(PACK_TYPE_FRAME, date_str, meta)


async def list_packs_for_project(
    *,
    db: AsyncSession,
    project_id: str,
    user_id: str,
) -> List[Dict[str, Any]]:
    """Return frame packs visible to ``(project_id, user_id)`` newest-first.

    Visibility comes from the ``storyboard_packs`` ownership index — legacy
    packs without a row stay hidden, mirroring the storyboard pattern.
    """
    from app.services import pack_ownership_service

    pack_ids = await pack_ownership_service.list_pack_ids_for_project(
        db=db, project_id=project_id, user_id=user_id
    )
    packs: List[Dict[str, Any]] = []
    for pid in pack_ids:
        try:
            pack = await get_pack(pid)
        except FileNotFoundError:
            continue
        # Ownership rows are pack-type-agnostic; filter to frame packs only.
        if pack.get("pack_type") != PACK_TYPE_FRAME:
            continue
        packs.append(pack)
    return packs


async def delete_pack(
    pack_id: str,
    *,
    db: Optional[AsyncSession] = None,
) -> None:
    """Delete a frame pack directory and (optionally) its ownership row."""
    pack_directory = _pack_dir(pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Frame pack not found: {pack_id}")

    date_str = Path(pack_directory).parent.name
    shutil.rmtree(pack_directory, ignore_errors=True)
    logger.info(f"Deleted frame pack directory: {pack_directory}")

    if db is not None:
        from app.services import pack_ownership_service

        try:
            await pack_ownership_service.delete_by_pack(db, pack_id)
        except Exception as exc:
            logger.warning(
                "Failed to delete frame pack ownership row",
                {"pack_id": pack_id, "error": str(exc)},
            )

    oss_client = get_oss_client()
    if oss_client:
        try:
            prefix = f"{FRAME_STORAGE_DIR}/{date_str}/{pack_id}/"

            def _delete_prefix() -> None:
                try:
                    import oss2

                    for obj in oss2.ObjectIterator(
                        oss_client.bucket,
                        prefix=oss_client.cfg.key_prefix + prefix,
                    ):
                        oss_client.bucket.delete_object(obj.key)
                except Exception as inner_exc:
                    logger.warning(f"OSS prefix deletion error: {inner_exc}")

            await asyncio.to_thread(_delete_prefix)
            logger.info(f"Deleted OSS objects for frame pack {pack_id}")
        except Exception as exc:
            logger.warning(f"Failed to delete OSS objects for frame pack {pack_id}: {exc}")


async def cleanup_pack_storage(pack_ids: List[str]) -> None:
    """Best-effort filesystem cleanup for the given pack ids.

    Used by ``video_project_service.delete_project`` after the project-row
    delete commits. Silently skips ids that are not actually frame packs
    (the ownership table is shared across all pack types).
    """
    if not pack_ids:
        return
    oss_client = get_oss_client()
    for pid in pack_ids:
        try:
            pack_directory = _pack_dir(pid)
        except ValueError:
            logger.warning("Skipping cleanup for invalid frame pack id", {"pack_id": pid})
            continue
        if not pack_directory:
            continue
        date_str = Path(pack_directory).parent.name
        try:
            shutil.rmtree(pack_directory, ignore_errors=True)
            logger.info(
                "Cleanup removed frame pack directory after project delete",
                {"pack_id": pid, "directory": pack_directory},
            )
        except Exception as exc:
            logger.warning(
                "Failed to remove frame pack directory during cleanup",
                {"pack_id": pid, "error": str(exc)},
            )
        if oss_client:
            try:
                prefix = f"{FRAME_STORAGE_DIR}/{date_str}/{pid}/"

                def _delete_prefix() -> None:
                    try:
                        import oss2

                        for obj in oss2.ObjectIterator(
                            oss_client.bucket,
                            prefix=oss_client.cfg.key_prefix + prefix,
                        ):
                            oss_client.bucket.delete_object(obj.key)
                    except Exception as inner_exc:
                        logger.warning(f"OSS prefix deletion error: {inner_exc}")

                await asyncio.to_thread(_delete_prefix)
            except Exception as exc:
                logger.warning(
                    "Failed to delete OSS objects during frame-pack cleanup",
                    {"pack_id": pid, "error": str(exc)},
                )


async def assert_pack_owned(
    db: AsyncSession, pack_id: str, user_id: str
) -> str:
    """Resolve the project_id bound to ``pack_id`` for ``user_id``.

    Raises 404 (deliberately masking 403 to avoid pack-id enumeration) when
    the pack has no owner row or is owned by another user.
    """
    from fastapi import HTTPException, status

    from app.services import pack_ownership_service

    row = await pack_ownership_service.get(db, pack_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="FRAME_PACK_NOT_FOUND",
        )
    return row.project_id
