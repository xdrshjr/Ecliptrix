"""Storyboard-pack ownership persistence.

This module is the single point of access to the ``storyboard_packs`` table.
The codebase has no top-level ``repositories/`` layer — by convention DB
queries live inside service modules (see ``video_project_service``), so the
ownership-row plumbing lives here as a small, focused service.

Public surface:
  - upsert(...): record / refresh an ownership row when a pack is created.
  - get(...): look up the row for a given pack_id (or None).
  - list_pack_ids_for_project(...): return ordered pack_ids for the
    (project, user) pair — used by ``storyboard_service.list_packs`` to
    decide visibility.
  - delete_by_pack(...): drop one row when a single pack is deleted.
  - collect_pack_ids_for_project(...) /
    delete_rows_by_project(...): used by ``video_project_service.delete_project``
    to cascade ownership rows inside the project-delete transaction; the
    actual filesystem + OSS cleanup is deferred until after commit.
"""

from __future__ import annotations

from typing import List, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.logger import get_logger
from app.models.db_models import StoryboardPackOwnership

logger = get_logger(__name__)


async def upsert(
    db: AsyncSession,
    pack_id: str,
    project_id: str,
    user_id: str,
    pack_type: str = "storyboard",
) -> StoryboardPackOwnership:
    """Insert or update the ownership row for ``pack_id``.

    Idempotent on retries: ``generate_storyboard`` accepts a stable
    ``pack_id`` for retried requests, so the second call just refreshes the
    project/user binding instead of failing the unique-key insert.
    """
    stmt = select(StoryboardPackOwnership).where(
        StoryboardPackOwnership.pack_id == pack_id
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        row = StoryboardPackOwnership(
            pack_id=pack_id,
            project_id=project_id,
            user_id=user_id,
            pack_type=pack_type,
        )
        db.add(row)
    else:
        row.project_id = project_id
        row.user_id = user_id
        row.pack_type = pack_type
    await db.flush()
    return row


async def get(
    db: AsyncSession, pack_id: str
) -> Optional[StoryboardPackOwnership]:
    stmt = select(StoryboardPackOwnership).where(
        StoryboardPackOwnership.pack_id == pack_id
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def list_pack_ids_for_project(
    db: AsyncSession,
    project_id: str,
    user_id: str,
) -> List[str]:
    """Return pack_ids belonging to ``(project_id, user_id)``, newest first.

    The router/service layer is responsible for materialising each pack's
    metadata.json afterwards.
    """
    stmt = (
        select(StoryboardPackOwnership.pack_id)
        .where(
            StoryboardPackOwnership.project_id == project_id,
            StoryboardPackOwnership.user_id == user_id,
        )
        .order_by(StoryboardPackOwnership.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()
    return [r[0] for r in rows]


async def delete_by_pack(db: AsyncSession, pack_id: str) -> bool:
    stmt = delete(StoryboardPackOwnership).where(
        StoryboardPackOwnership.pack_id == pack_id
    )
    result = await db.execute(stmt)
    await db.flush()
    return (result.rowcount or 0) > 0


async def collect_pack_ids_for_project(
    db: AsyncSession, project_id: str
) -> List[str]:
    """Snapshot the pack_ids owned by ``project_id`` BEFORE the cascade.

    Called from ``video_project_service.delete_project`` inside the
    project-delete transaction so the post-commit storage cleanup has a
    stable list to work with.
    """
    stmt = select(StoryboardPackOwnership.pack_id).where(
        StoryboardPackOwnership.project_id == project_id
    )
    rows = (await db.execute(stmt)).all()
    return [r[0] for r in rows]


async def delete_rows_by_project(
    db: AsyncSession, project_id: str
) -> int:
    stmt = delete(StoryboardPackOwnership).where(
        StoryboardPackOwnership.project_id == project_id
    )
    result = await db.execute(stmt)
    await db.flush()
    return int(result.rowcount or 0)
