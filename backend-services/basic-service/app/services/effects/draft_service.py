"""Project-bound, incomplete-friendly drafts with compare-and-swap saves."""

import base64
import json
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.effects_db_models import EffectAsset, EffectDraft
from app.models.effects_models import EffectError
from .catalog import document_hash, normalize_document, renderability
from .project_locks import project_lock, require_project


async def validate_assets(db: AsyncSession, project_id: str,
                          document: dict) -> list[EffectAsset]:
    """Require exact project ownership and explicit binding kind."""
    rows = []
    seen = set()
    for binding in document["inputs"]:
        row = await db.get(EffectAsset, UUID(binding["asset_id"]),
                           populate_existing=True)
        if row is None or str(row.project_id) != str(project_id):
            raise EffectError("EFFECT_NOT_FOUND", "输入资产不存在", 404)
        if row.kind != f"input-{binding['kind']}":
            raise EffectError("EFFECT_INVALID_ARGUMENT", "inputs.kind")
        if row.id not in seen:
            rows.append(row)
            seen.add(row.id)
    if sum(row.bytes for row in rows) > 1024 * 1024 * 1024:
        raise EffectError("EFFECT_INPUT_TOO_LARGE", status=413)
    return rows


def draft_data(row: EffectDraft) -> dict:
    """Read-only old/deleted versions remain distinct from a render grant."""
    document = normalize_document(row.document_json)
    return {"draft_id": str(row.id), "project_id": str(row.project_id),
            "name": row.name, "version": row.version,
            "schema_version": row.schema_version, "document": document,
            "document_hash": row.document_hash,
            "renderability": renderability(document),
            "read_only": row.deleted_at is not None,
            "deleted_at": row.deleted_at.isoformat()
            if row.deleted_at else None,
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat()}


async def get_draft(db: AsyncSession, project_id: str,
                    draft_id: str, *, writable: bool = False) -> EffectDraft:
    await require_project(db, project_id, writable=writable)
    row = await db.get(EffectDraft, UUID(str(draft_id)),
                       populate_existing=True)
    if row is None or str(row.project_id) != str(project_id):
        raise EffectError("EFFECT_NOT_FOUND", status=404)
    if writable and row.deleted_at:
        raise EffectError("EFFECT_NOT_FOUND", "草稿已删除", 404)
    if row.schema_version != 1:
        raise EffectError("EFFECT_TEMPLATE_INCOMPATIBLE", status=409)
    return row


async def create_draft(db: AsyncSession, project_id: str,
                       payload) -> dict:
    document = normalize_document(payload.document)
    async with project_lock(project_id):
        await require_project(db, project_id)
        await validate_assets(db, project_id, document)
        row = EffectDraft(project_id=UUID(project_id), name=payload.name,
                          document_json=document,
                          document_hash=document_hash(document))
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return draft_data(row)


async def update_draft(db: AsyncSession, project_id: str,
                       draft_id: str, payload) -> dict:
    document = normalize_document(payload.document)
    async with project_lock(project_id):
        await get_draft(db, project_id, draft_id, writable=True)
        await validate_assets(db, project_id, document)
        await require_project(db, project_id)
        result = await db.execute(update(EffectDraft).where(
            EffectDraft.id == UUID(draft_id),
            EffectDraft.version == payload.expected_version,
            EffectDraft.deleted_at.is_(None),
        ).values(name=payload.name, document_json=document,
                 document_hash=document_hash(document),
                 version=payload.expected_version + 1,
                 updated_at=datetime.now(timezone.utc)))
        if result.rowcount != 1:
            await db.rollback()
            raise EffectError("EFFECT_VERSION_CONFLICT", status=409)
        await db.commit()
        return draft_data(await get_draft(db, project_id, draft_id))


async def delete_draft(db: AsyncSession, project_id: str,
                       draft_id: str, expected_version: int) -> dict:
    async with project_lock(project_id):
        row = await get_draft(db, project_id, draft_id, writable=True)
        if row.version != expected_version:
            raise EffectError("EFFECT_VERSION_CONFLICT", status=409)
        row.deleted_at = datetime.now(timezone.utc)
        row.updated_at = datetime.now(timezone.utc)
        await db.commit()
        return draft_data(row)


async def list_records(db: AsyncSession, model, project_id: str,
                       options: dict) -> tuple[list, str | None]:
    """Keyset pagination stays stable when new records arrive."""
    await require_project(db, project_id, writable=False)
    limit = options.get("page_size", 12)
    if not 1 <= limit <= 50:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "page_size")
    query = select(model).where(model.project_id == UUID(project_id))
    if model is EffectDraft:
        query = query.where(model.deleted_at.is_(None))
    if options.get("statuses"):
        query = query.where(model.status.in_(options["statuses"]))
    if options.get("cursor"):
        query = _after_cursor(query, model, options["cursor"])
    rows = list((await db.execute(query.order_by(model.created_at.desc(), model.id.desc())
                                 .limit(limit + 1))).scalars())
    cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        raw = json.dumps([last.created_at.isoformat(), str(last.id)])
        cursor = base64.urlsafe_b64encode(raw.encode()).decode()
    return rows[:limit], cursor


def _after_cursor(query, model, cursor: str):
    try:
        timestamp, identifier = json.loads(
            base64.urlsafe_b64decode(cursor).decode())
        created = datetime.fromisoformat(timestamp)
        row_id = UUID(identifier)
    except (ValueError, TypeError, UnicodeError) as exc:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "cursor") from exc
    return query.where(or_(model.created_at < created,
                           and_(model.created_at == created,
                                model.id < row_id)))
