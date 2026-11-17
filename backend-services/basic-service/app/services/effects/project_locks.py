"""Shared per-project lifecycle guards for all effects writers."""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import VideoProject
from app.models.effects_models import EffectError

_locks: dict[str, asyncio.Lock] = {}
_closing: set[str] = set()
_deletions: dict[str, asyncio.Lock] = {}


def project_key(project_id: str | UUID) -> str:
    """Validate the one local namespace key before path or database use."""
    try:
        return str(UUID(str(project_id)))
    except ValueError as exc:
        raise EffectError("EFFECT_NOT_FOUND", status=404) from exc


@asynccontextmanager
async def project_lock(project_id: str | UUID) -> AsyncIterator[None]:
    key = project_key(project_id)
    async with _locks.setdefault(key, asyncio.Lock()):
        yield


@asynccontextmanager
async def deletion_lock(project_id: str | UUID) -> AsyncIterator[None]:
    async with _deletions.setdefault(project_key(project_id), asyncio.Lock()):
        yield


def mark_closing(project_id: str | UUID, closing: bool) -> None:
    key = project_key(project_id)
    if closing:
        _closing.add(key)
    else:
        _closing.discard(key)


async def require_project(db: AsyncSession, project_id: str | UUID,
                          *, writable: bool = True) -> VideoProject:
    """Always query again after I/O; an old ORM row is not a live lease."""
    identifier = UUID(project_key(project_id))
    row = await db.get(VideoProject, identifier, populate_existing=True)
    if row is None:
        raise EffectError("EFFECT_NOT_FOUND", "项目不存在", 404)
    if writable and str(identifier) in _closing:
        raise EffectError("EFFECT_PROJECT_CLOSING", "项目正在删除", 409)
    return row
