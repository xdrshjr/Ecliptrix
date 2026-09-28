"""
Service layer for the per-project video cover authoring feature.

All public methods take an explicit ``user_id`` argument that the router has
already resolved to the ``LOCAL_OWNER_ID`` constant. The service NEVER accepts
``user_id`` from a request body. A row owned by some other id reads back as
``None`` (the router maps that to a 404).

Storage paths follow the well-known-slot pattern:
  * Cover PNG (rendered):   ``STORAGE_ROOT/projects/<project_id>/cover.png``
  * Uploaded background:    ``STORAGE_ROOT/projects/<project_id>/cover-bg-<uuid>.<ext>``

The URL written into ``video_projects.cover_url`` always carries a
``?v=<updated_at_unix>`` query suffix so browsers/CDN refresh after re-renders;
the static mount ignores the query string and serves the file regardless.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.logger import get_logger
from app.models.db_models import ProjectCover, VideoProject
from app.models.video_cover_models import (
    CoverConfig,
    CoverStateIn,
    CoverStateOut,
)
from app.services.storage_service import storage_service

logger = get_logger(__name__)


def _iso(value: Optional[datetime]) -> str:
    return value.isoformat() if value else ""


def _as_uuid(value: Optional[str]) -> Optional[UUID]:
    if value is None or value == "":
        return None
    try:
        return UUID(value)
    except (ValueError, TypeError):
        return None


def _row_to_out(row: ProjectCover) -> CoverStateOut:
    return CoverStateOut(
        project_id=str(row.project_id),
        template_id=row.template_id,  # type: ignore[arg-type]
        cover_config=CoverConfig.model_validate(row.cover_config or {}),
        image_source=row.image_source,  # type: ignore[arg-type]
        frame_virtual_time_ms=row.frame_virtual_time_ms,
        uploaded_image_url=row.uploaded_image_url,
        aspect_ratio=row.aspect_ratio,  # type: ignore[arg-type]
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def _payload_dict(payload: CoverStateIn) -> dict:
    """Strip Pydantic wrappers down to ORM-assignable column dict."""
    return {
        "template_id": payload.template_id,
        "cover_config": payload.cover_config.model_dump(exclude_none=True),
        "image_source": payload.image_source,
        "frame_virtual_time_ms": payload.frame_virtual_time_ms,
        "uploaded_image_url": payload.uploaded_image_url,
        "aspect_ratio": payload.aspect_ratio,
    }


def _strip_query(url: str) -> str:
    """Drop ``?...`` suffix from a stored ``cover_url`` so we can re-stamp it."""
    return url.split("?", 1)[0] if url else url


def _project_dir(project_id: str) -> str:
    """Relative directory under STORAGE_ROOT for a project's cover artifacts."""
    return f"projects/{project_id}"


def _project_dir_abs(project_id: str) -> Path:
    """Absolute directory on disk for a project's cover artifacts.

    Resolves through the live ``storage_service.root`` rather than re-reading
    ``settings.storage.root`` so tests that ``monkeypatch`` the storage root
    on the singleton see consistent paths during cleanup.
    """
    return Path(storage_service.root) / "projects" / project_id


class VideoCoverService:
    """Business logic for ``project_covers`` rows + on-disk PNG / background."""

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    async def get_by_project(
        self,
        db: AsyncSession,
        user_id: str,
        project_id: str,
    ) -> Optional[CoverStateOut]:
        """Return the cover state for ``project_id`` if it exists *and* the
        caller owns the underlying project. Otherwise ``None``.

        The 404-vs-null distinction is decided at the router; here we collapse
        both "no row" and "wrong owner" to ``None`` so the router can render a
        clean ``data: null`` for an existing-but-unconfigured project.
        """
        proj_uuid = _as_uuid(project_id)
        if proj_uuid is None:
            return None

        # First confirm project ownership (existence-leak prevention)
        own_stmt = select(VideoProject.id).where(
            VideoProject.id == proj_uuid,
            VideoProject.user_id == user_id,
        )
        if (await db.execute(own_stmt)).scalar_one_or_none() is None:
            return None

        cover_stmt = select(ProjectCover).where(ProjectCover.project_id == proj_uuid)
        row = (await db.execute(cover_stmt)).scalar_one_or_none()
        if row is None:
            return None
        return _row_to_out(row)

    # ------------------------------------------------------------------
    # Upsert (portable two-step, P1-1)
    # ------------------------------------------------------------------

    async def upsert(
        self,
        db: AsyncSession,
        user_id: str,
        project_id: str,
        payload: CoverStateIn,
    ) -> Optional[CoverStateOut]:
        """Insert-or-update the project's cover row. Returns ``None`` if the
        caller does not own ``project_id`` (router maps that to 404)."""
        proj_uuid = _as_uuid(project_id)
        if proj_uuid is None:
            return None

        # Confirm ownership
        own_stmt = select(VideoProject.id).where(
            VideoProject.id == proj_uuid,
            VideoProject.user_id == user_id,
        )
        if (await db.execute(own_stmt)).scalar_one_or_none() is None:
            return None

        values = _payload_dict(payload)

        select_stmt = select(ProjectCover).where(ProjectCover.project_id == proj_uuid)
        row = (await db.execute(select_stmt)).scalar_one_or_none()

        if row is None:
            row = ProjectCover(
                project_id=proj_uuid,
                user_id=user_id,
                **values,
            )
            db.add(row)
        else:
            for k, v in values.items():
                setattr(row, k, v)

        try:
            await db.flush()
        except IntegrityError:
            # Rare cross-tx race on the unique(project_id) constraint
            await db.rollback()
            row = (await db.execute(select_stmt)).scalar_one()
            for k, v in values.items():
                setattr(row, k, v)
            await db.flush()

        await db.refresh(row)
        return _row_to_out(row)

    # ------------------------------------------------------------------
    # PNG cache + cover_url cache-busting
    # ------------------------------------------------------------------

    async def store_png_and_update_project(
        self,
        db: AsyncSession,
        user_id: str,
        project_id: str,
        png_bytes: bytes,
    ) -> Optional[Tuple[str, str]]:
        """Persist the rendered PNG for ``project_id`` and stamp
        ``video_projects.cover_url`` with a cache-busted URL.

        Returns ``(url, updated_at_iso)`` on success, ``None`` if the caller
        does not own the project. ``ValueError`` is raised for invalid PNG /
        oversized payloads — the router maps that to 400/413.
        """
        proj_uuid = _as_uuid(project_id)
        if proj_uuid is None:
            return None

        # Confirm ownership AND fetch the row so we can update cover_url
        proj_stmt = select(VideoProject).where(
            VideoProject.id == proj_uuid,
            VideoProject.user_id == user_id,
        )
        project_row = (await db.execute(proj_stmt)).scalar_one_or_none()
        if project_row is None:
            return None

        # PNG signature (8-byte magic) — defence in depth on top of MIME check
        if len(png_bytes) < 8 or png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("Not a valid PNG file")

        rel_path = f"{_project_dir(project_id)}/cover.png"
        result = await storage_service.write_to_well_known_slot(
            rel_path=rel_path,
            content=png_bytes,
            content_type="image/png",
        )
        if not result.get("success"):
            raise RuntimeError(result.get("message") or "Failed to write PNG")

        now = datetime.now(timezone.utc)
        unix = int(now.timestamp())
        # Build the cache-busted URL. `file_url` already starts at /api/storage/files/...
        url = f"{result['file_url']}?v={unix}"

        project_row.cover_url = url
        await db.flush()
        await db.refresh(project_row)

        return url, _iso(project_row.updated_at) or now.isoformat()

    # ------------------------------------------------------------------
    # Cascade delete (P0-2)
    # ------------------------------------------------------------------

    async def delete_for_project(
        self,
        db: AsyncSession,
        project_id: str,
    ) -> bool:
        """只删除数据库行；调用者提交事务后调用 cleanup_files。"""
        proj_uuid = _as_uuid(project_id)
        if proj_uuid is None:
            return False

        # Delete the DB row (in-tx)
        stmt = select(ProjectCover).where(ProjectCover.project_id == proj_uuid)
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is not None:
            await db.delete(row)
            await db.flush()

        return row is not None

    def cleanup_files(self, project_id: str) -> None:
        """只在删除事务提交后清理旧 PNG，回滚不能丢失原文件。"""
        # Filesystem cleanup (best-effort)
        try:
            project_dir = _project_dir_abs(project_id)
            if project_dir.exists() and project_dir.is_dir():
                # Cover PNG
                cover_png = project_dir / "cover.png"
                if cover_png.exists() and cover_png.is_file():
                    try:
                        cover_png.unlink()
                    except FileNotFoundError:
                        pass
                # Uploaded backgrounds (cover-bg-*.{ext})
                for bg in project_dir.glob("cover-bg-*.*"):
                    try:
                        bg.unlink()
                    except FileNotFoundError:
                        pass
                # Remove the directory if it ends up empty
                try:
                    next(project_dir.iterdir())
                except StopIteration:
                    project_dir.rmdir()
                except OSError:
                    pass
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "Cover artifact cleanup failed",
                {"project_id": project_id, "error": str(exc)},
            )

    # ------------------------------------------------------------------
    # Uploaded background helper
    # ------------------------------------------------------------------

    async def store_uploaded_background(
        self,
        user_id: str,
        project_id: str,
        file_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> Optional[str]:
        """Persist a user-uploaded image to the well-known per-project slot
        and return its same-origin URL. Returns ``None`` on failure (caller
        decides the HTTP status — 400 for invalid / 500 for write failure).
        """
        # Light extension extraction; sanitisation happens inside the helper
        ext = Path(filename).suffix.lstrip(".").lower() or "png"
        ext = re.sub(r"[^a-z0-9]", "", ext)[:6] or "png"

        # ``uuid4`` would be ideal but we do not need cryptographic randomness
        # here — a millisecond-precision timestamp is sufficient and avoids a
        # second import. Collisions are not a problem because the well-known
        # parent directory is per-project.
        unique = int(datetime.now(timezone.utc).timestamp() * 1000)
        rel_path = f"{_project_dir(project_id)}/cover-bg-{unique}.{ext}"

        result = await storage_service.write_to_well_known_slot(
            rel_path=rel_path,
            content=file_bytes,
            content_type=content_type,
        )
        if not result.get("success"):
            return None
        return result["file_url"]


# Module-level singleton
video_cover_service = VideoCoverService()
