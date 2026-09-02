"""
Service layer for the Video Editing project list & cards feature.

All public methods take an explicit ``user_id`` argument that the router has
already resolved to the ``LOCAL_OWNER_ID`` constant. The service NEVER accepts
``user_id`` from a request body. A row owned by some other id reads back as
``None`` (the router maps that to a 404).
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import collate, or_, select, func, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.logger import get_logger
from app.models.db_models import VideoProject, VideoProjectCategory
from app.models.video_project_models import (
    CreateVideoProjectCategoryRequest,
    CreateVideoProjectRequest,
    UpdateVideoProjectCategoryRequest,
    UpdateVideoProjectRequest,
    VideoProjectCategoryRecord,
    VideoProjectListItem,
    VideoProjectRecord,
)

logger = get_logger(__name__)


SortKey = str  # 'recent' | 'created' | 'name'


# ---------------------------------------------------------------------------
# Locale-aware collation for sort=name (iter10 Bug #5).
#
# PostgreSQL's default collation depends on the cluster locale (often
# zh_CN.UTF-8 on Chinese Linux installs), which gives the wrong intuitive
# order for English locales. We map the user's Accept-Language to a
# whitelisted PG collation, falling back to "C" (binary order) when the
# requested collation isn't available on this DB.
# ---------------------------------------------------------------------------

_LOCALE_COLLATIONS: Dict[str, str] = {
    "en": "en_US.utf8",
    "zh": "zh_CN.utf8",
}
_FALLBACK_COLLATION = "C"

# Cache populated on the first call that needs a locale-aware sort. The cache
# lives for the lifetime of the process; PG-level collation changes require a
# backend restart to take effect, which is acceptable.
_available_collations: Optional[set] = None


async def _ensure_collation_cache(db: AsyncSession) -> set:
    global _available_collations
    if _available_collations is not None:
        return _available_collations
    try:
        result = await db.execute(text("SELECT collname FROM pg_collation"))
        names = {row[0] for row in result.fetchall()}
    except DBAPIError as err:
        logger.warning(
            "Failed to enumerate pg_collation, falling back to %s only: %s",
            _FALLBACK_COLLATION,
            err,
        )
        names = {_FALLBACK_COLLATION}
    except Exception as err:  # SQLite or any other non-PG backend
        logger.info(
            "pg_collation enumeration unavailable on this backend, falling back to %s: %s",
            _FALLBACK_COLLATION,
            err,
        )
        names = {_FALLBACK_COLLATION}
    _available_collations = names | {_FALLBACK_COLLATION}
    return _available_collations


def _resolve_locale_to_prefix(locale: Optional[str]) -> Optional[str]:
    """Pick the first language tag from an Accept-Language header value and
    reduce it to its primary subtag. Examples:

      'en'                       -> 'en'
      'en-US'                    -> 'en'
      'zh-CN,zh;q=0.9'           -> 'zh'
      None / ''                  -> None
    """
    if not locale:
        return None
    prefix = (
        locale.split(",")[0]
        .split(";")[0]
        .split("-")[0]
        .split("_")[0]
        .strip()
        .lower()
    )
    return prefix or None


async def _resolve_collation(db: AsyncSession, locale: Optional[str]) -> str:
    prefix = _resolve_locale_to_prefix(locale)
    desired = _LOCALE_COLLATIONS.get(prefix or "", _FALLBACK_COLLATION)
    available = await _ensure_collation_cache(db)
    return desired if desired in available else _FALLBACK_COLLATION


def _reset_collation_cache_for_tests() -> None:
    """Test-only: clear the per-process cache between cases."""
    global _available_collations
    _available_collations = None


def _iso(value: Optional[datetime]) -> str:
    """Serialise a datetime to ISO-8601. Returns empty string when missing
    (NEVER substitutes ``datetime.now()`` — that would falsely report the
    current request time as a creation/update timestamp on a row whose
    server-default hadn't materialised yet)."""
    return value.isoformat() if value else ""


def _as_uuid(value: Optional[str]) -> Optional[UUID]:
    if value is None or value == "":
        return None
    try:
        return UUID(value)
    except (ValueError, TypeError):
        return None


def _category_to_record(row: VideoProjectCategory) -> VideoProjectCategoryRecord:
    return VideoProjectCategoryRecord(
        id=str(row.id),
        name=row.name,
        color=row.color,
        sort_order=row.sort_order or 0,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def _project_to_record(row: VideoProject) -> VideoProjectRecord:
    return VideoProjectRecord(
        id=str(row.id),
        name=row.name,
        description=row.description,
        category_id=str(row.category_id) if row.category_id else None,
        cover_url=row.cover_url,
        project_data=row.project_data,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
        last_opened_at=row.last_opened_at.isoformat() if row.last_opened_at else None,
    )


def _project_to_list_item(row: VideoProject) -> VideoProjectListItem:
    return VideoProjectListItem(
        id=str(row.id),
        name=row.name,
        description=row.description,
        category_id=str(row.category_id) if row.category_id else None,
        cover_url=row.cover_url,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
        last_opened_at=row.last_opened_at.isoformat() if row.last_opened_at else None,
    )


class VideoProjectService:
    """All business logic for video projects + their categories."""

    # ------------------------------------------------------------------
    # Categories
    # ------------------------------------------------------------------

    async def list_categories(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> List[VideoProjectCategoryRecord]:
        stmt = (
            select(VideoProjectCategory)
            .where(VideoProjectCategory.user_id == user_id)
            .order_by(
                VideoProjectCategory.sort_order.asc(),
                VideoProjectCategory.created_at.asc(),
            )
        )
        rows = (await db.execute(stmt)).scalars().all()
        return [_category_to_record(row) for row in rows]

    async def create_category(
        self,
        db: AsyncSession,
        user_id: str,
        payload: CreateVideoProjectCategoryRequest,
    ) -> VideoProjectCategoryRecord:
        category = VideoProjectCategory(
            user_id=user_id,
            name=payload.name.strip(),
            color=payload.color,
            sort_order=payload.sort_order or 0,
        )
        db.add(category)
        await db.flush()
        await db.refresh(category)
        logger.info(
            "Created video project category",
            {"user_id": user_id, "category_id": str(category.id)},
        )
        return _category_to_record(category)

    async def update_category(
        self,
        db: AsyncSession,
        user_id: str,
        category_id: str,
        payload: UpdateVideoProjectCategoryRequest,
    ) -> Optional[VideoProjectCategoryRecord]:
        cat_uuid = _as_uuid(category_id)
        if cat_uuid is None:
            return None
        stmt = (
            select(VideoProjectCategory)
            .where(
                VideoProjectCategory.id == cat_uuid,
                VideoProjectCategory.user_id == user_id,
            )
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            return None
        if payload.name is not None:
            row.name = payload.name.strip()
        if payload.color is not None:
            row.color = payload.color
        if payload.sort_order is not None:
            row.sort_order = payload.sort_order
        await db.flush()
        await db.refresh(row)
        return _category_to_record(row)

    async def delete_category(
        self,
        db: AsyncSession,
        user_id: str,
        category_id: str,
    ) -> bool:
        """Delete a category. Projects in this category have category_id set
        to NULL (they are not deleted alongside the category)."""
        cat_uuid = _as_uuid(category_id)
        if cat_uuid is None:
            return False
        stmt = (
            select(VideoProjectCategory)
            .where(
                VideoProjectCategory.id == cat_uuid,
                VideoProjectCategory.user_id == user_id,
            )
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            return False

        # Unlink any project still pointing at this category (set to NULL)
        proj_stmt = (
            select(VideoProject)
            .where(
                VideoProject.user_id == user_id,
                VideoProject.category_id == cat_uuid,
            )
        )
        projects = (await db.execute(proj_stmt)).scalars().all()
        for project in projects:
            project.category_id = None

        await db.delete(row)
        await db.flush()
        return True

    # ------------------------------------------------------------------
    # Projects
    # ------------------------------------------------------------------

    async def list_projects(
        self,
        db: AsyncSession,
        user_id: str,
        category_id: Optional[str] = None,
        search: Optional[str] = None,
        sort: SortKey = "recent",
        limit: int = 100,
        offset: int = 0,
        locale: Optional[str] = None,
    ) -> Tuple[List[VideoProjectListItem], int]:
        """Returns (items, total). ``project_data`` is intentionally excluded
        from the projection — list endpoints must stay light.
        """
        # Clamp pagination defensively
        limit = max(1, min(int(limit or 100), 200))
        offset = max(0, int(offset or 0))

        filters = [VideoProject.user_id == user_id]

        if category_id is not None and category_id != "":
            cat_uuid = _as_uuid(category_id)
            if cat_uuid is not None:
                filters.append(VideoProject.category_id == cat_uuid)
            else:
                # Special token "__uncategorized__" matches NULL category
                if category_id == "__uncategorized__":
                    filters.append(VideoProject.category_id.is_(None))
                else:
                    # Unknown token → return empty but don't error
                    return [], 0

        if search:
            term = f"%{search.strip().lower()}%"
            filters.append(
                or_(
                    func.lower(VideoProject.name).like(term),
                    func.lower(func.coalesce(VideoProject.description, "")).like(term),
                )
            )

        # Total count for pagination
        count_stmt = select(func.count(VideoProject.id)).where(*filters)
        total = int((await db.execute(count_stmt)).scalar_one() or 0)

        # Sort selection. id.asc() is appended as a stable tiebreaker so that
        # rows with equal primary keys produce a deterministic page boundary
        # across calls (otherwise PG is free to swap them between pages).
        if sort == "name":
            collation = await _resolve_collation(db, locale)
            if collation == _FALLBACK_COLLATION:
                # 'C' collation is the PG default for SQL identifiers — use
                # raw column order to avoid a no-op COLLATE that some PG
                # versions reject for utf8 string columns.
                order = (VideoProject.name.asc(), VideoProject.id.asc())
            else:
                order = (
                    collate(VideoProject.name, collation).asc(),
                    VideoProject.id.asc(),
                )
        elif sort == "created":
            order = (VideoProject.created_at.desc(), VideoProject.id.asc())
        else:  # 'recent' (default)
            # last_opened_at first, then updated_at as fallback for never-opened rows
            order = (
                VideoProject.last_opened_at.desc().nullslast()
                if hasattr(VideoProject.last_opened_at.desc(), "nullslast")
                else VideoProject.last_opened_at.desc(),
                VideoProject.updated_at.desc(),
                VideoProject.id.asc(),
            )

        stmt = (
            select(VideoProject)
            .where(*filters)
            .order_by(*order)
            .limit(limit)
            .offset(offset)
        )
        rows = (await db.execute(stmt)).scalars().all()
        items = [_project_to_list_item(row) for row in rows]
        return items, total

    async def create_project(
        self,
        db: AsyncSession,
        user_id: str,
        payload: CreateVideoProjectRequest,
    ) -> VideoProjectRecord:
        project = VideoProject(
            user_id=user_id,
            name=payload.name.strip(),
            description=payload.description,
            category_id=_as_uuid(payload.category_id),
            cover_url=payload.cover_url,
            project_data=payload.project_data or {},
        )
        db.add(project)
        await db.flush()
        await db.refresh(project)
        logger.info(
            "Created video project",
            {"user_id": user_id, "project_id": str(project.id)},
        )
        return _project_to_record(project)

    async def get_project(
        self,
        db: AsyncSession,
        user_id: str,
        project_id: str,
        touch_last_opened: bool = True,
    ) -> Optional[VideoProjectRecord]:
        proj_uuid = _as_uuid(project_id)
        if proj_uuid is None:
            return None
        stmt = (
            select(VideoProject)
            .where(
                VideoProject.id == proj_uuid,
                VideoProject.user_id == user_id,
            )
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            return None
        if touch_last_opened:
            row.last_opened_at = datetime.now(timezone.utc)
            await db.flush()
            await db.refresh(row)
        return _project_to_record(row)

    async def update_project(
        self,
        db: AsyncSession,
        user_id: str,
        project_id: str,
        payload: UpdateVideoProjectRequest,
    ) -> Optional[VideoProjectRecord]:
        proj_uuid = _as_uuid(project_id)
        if proj_uuid is None:
            return None
        stmt = (
            select(VideoProject)
            .where(
                VideoProject.id == proj_uuid,
                VideoProject.user_id == user_id,
            )
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            return None

        if payload.name is not None:
            row.name = payload.name.strip()
        if payload.description is not None:
            row.description = payload.description
        if payload.category_id is not None:
            # Empty string = unassign category
            row.category_id = _as_uuid(payload.category_id) if payload.category_id else None
        if payload.cover_url is not None:
            row.cover_url = payload.cover_url
        if payload.project_data is not None:
            row.project_data = payload.project_data

        await db.flush()
        await db.refresh(row)
        return _project_to_record(row)

    async def delete_project(
        self,
        db: AsyncSession,
        user_id: str,
        project_id: str,
    ) -> bool:
        # Avoid an import cycle (storyboard_service imports settings →
        # config → … and pack_ownership_service imports the User model
        # already imported elsewhere; defer both to the call site).
        from app.services import pack_ownership_service, storyboard_service
        from app.services.video_cover_service import video_cover_service

        proj_uuid = _as_uuid(project_id)
        if proj_uuid is None:
            return False
        stmt = (
            select(VideoProject)
            .where(
                VideoProject.id == proj_uuid,
                VideoProject.user_id == user_id,
            )
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            return False

        # 1) Snapshot owned pack ids and 2) delete ownership rows — both
        # inside the same transaction as the project-row delete so DB-level
        # consistency is unconditional. Filesystem cleanup runs after
        # commit so a flaky storage backend can't roll back the project
        # delete (mirrors the storage-cleanup philosophy elsewhere).
        pack_ids = await pack_ownership_service.collect_pack_ids_for_project(
            db, project_id
        )
        if pack_ids:
            await pack_ownership_service.delete_rows_by_project(db, project_id)

        # 3) Cover row + on-disk PNG / uploaded backgrounds (P0-2). Same
        # transaction as the project delete so DB rollback always undoes both.
        await video_cover_service.delete_for_project(db, project_id)

        await db.delete(row)
        await db.flush()
        await db.commit()

        if pack_ids:
            try:
                await storyboard_service.cleanup_pack_storage(pack_ids)
            except Exception as exc:
                logger.warning(
                    "Pack storage cleanup failed after project delete",
                    {"project_id": project_id, "error": str(exc)},
                )
            # Frame packs live in their own ``frame_pack/`` directory; the
            # storyboard sweep only walks ``storyboard/`` so we additionally
            # ask the frame_pack service to drop any matching dirs. The id
            # list is shared (the ownership row is pack-type-agnostic) so
            # passing the full snapshot is safe — non-frame ids resolve to
            # ``_pack_dir = None`` and are skipped.
            try:
                from app.services import frame_pack_service

                await frame_pack_service.cleanup_pack_storage(pack_ids)
            except Exception as exc:
                logger.warning(
                    "Frame pack storage cleanup failed after project delete",
                    {"project_id": project_id, "error": str(exc)},
                )
        return True

    async def assert_project_writable(
        self,
        db: AsyncSession,
        user_id: str,
        project_id: str,
    ) -> VideoProject:
        """Resolve a project owned by ``user_id`` or raise 404.

        Returns the ORM row so callers can read e.g. ``row.id`` if needed.
        We deliberately mask 403 as 404 to avoid project-id enumeration,
        matching the existing ``video_project_router`` style.
        """
        proj_uuid = _as_uuid(project_id)
        if proj_uuid is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="PROJECT_NOT_FOUND",
            )
        stmt = (
            select(VideoProject)
            .where(
                VideoProject.id == proj_uuid,
                VideoProject.user_id == user_id,
            )
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="PROJECT_NOT_FOUND",
            )
        return row


# Module-level singleton
video_project_service = VideoProjectService()


# Convenience alias so callers can `from app.services.video_project_service
# import assert_project_writable` without going through the singleton.
async def assert_project_writable(
    db: AsyncSession, user_id: str, project_id: str
) -> VideoProject:
    return await video_project_service.assert_project_writable(
        db=db, user_id=user_id, project_id=project_id
    )
