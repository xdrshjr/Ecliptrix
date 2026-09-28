"""独立草稿 CAS、不可变版本与工程引用解析。"""
import asyncio
import hashlib
import json
from uuid import UUID

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import (
    ProjectCover,
    ProjectCoverDocument,
    ProjectCoverRevision,
    ProjectCoverJob,
    ProjectCoverAsset,
)
from app.models.video_cover_v2_models import (
    COVER_DIMENSIONS,
    CoverDocument,
    CoverError,
    SaveCoverRequest,
    ImportCoverRequest,
)
from app.services import video_cover_asset_service as assets


def document_hash(document: dict) -> str:
    content = json.dumps(
        document,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def draft_data(row: ProjectCoverDocument | None) -> dict:
    return {
        "version": row.version if row else 0,
        "document": row.document if row else None,
        "document_hash": document_hash(row.document) if row else None,
    }


async def validate_background(
    db: AsyncSession, project_id: str, document: CoverDocument
) -> None:
    if document.background.asset_id is not None:
        await assets.get_asset(db, project_id, document.background.asset_id)


async def validate_ready(
    db: AsyncSession, project_id: str, document: CoverDocument
) -> None:
    await validate_background(db, project_id, document)
    if document.mode != "ai" and not (
        document.fields.title.strip() or document.fields.subtitle.strip()
    ):
        raise CoverError("COVER_DRAFT_NOT_READY", "请填写标题或副标题", 409)
    if document.mode in {"ai", "mixed"} and not document.background.asset_id:
        raise CoverError("COVER_DRAFT_NOT_READY", "请先选择背景图片", 409)
    if document.background.kind == "asset" and not document.background.asset_id:
        raise CoverError("COVER_DRAFT_NOT_READY", "背景图片尚未就绪", 409)
    if document.background.asset_id:
        await assets.verify_asset(
            await assets.get_asset(db, project_id, document.background.asset_id)
        )


async def get_document(
    db: AsyncSession, project_id: str
) -> ProjectCoverDocument | None:
    return await db.get(
        ProjectCoverDocument, UUID(str(project_id)), populate_existing=True
    )


async def save_draft(
    db: AsyncSession, project_id: str, payload: SaveCoverRequest
) -> dict:
    async with assets.project_locks(project_id):
        await assets.require_project(db, project_id)
        await validate_background(db, project_id, payload.document)
        canonical = payload.document.model_dump(mode="json")
        version = payload.expected_version
        if version == 0:
            row = ProjectCoverDocument(
                project_id=UUID(str(project_id)), version=1, document=canonical
            )
            try:
                async with db.begin_nested():
                    db.add(row)
                    await db.flush()
            except IntegrityError:
                await raise_version_conflict(db, project_id)
        else:
            result = await db.execute(
                update(ProjectCoverDocument)
                .where(
                    ProjectCoverDocument.project_id == UUID(str(project_id)),
                    ProjectCoverDocument.version == version,
                )
                .values(document=canonical, version=version + 1)
            )
            if result.rowcount != 1:
                await raise_version_conflict(db, project_id)
        await db.commit()
        return {
            "version": version + 1,
            "document": canonical,
            "document_hash": document_hash(canonical),
        }


async def raise_version_conflict(db: AsyncSession, project_id: str) -> None:
    row = await get_document(db, project_id)
    raise CoverError(
        "COVER_VERSION_CONFLICT",
        "草稿已被其他操作修改",
        409,
        {"version": row.version if row else 0},
    )


async def revision_data(db: AsyncSession, row: ProjectCoverRevision) -> dict:
    asset = await assets.get_asset(db, row.project_id, row.asset_id)
    return {
        "id": str(row.id),
        "project_id": str(row.project_id),
        "document": row.document,
        "document_hash": row.document_hash,
        **assets.asset_data(asset),
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


async def get_revision(
    db: AsyncSession, project_id: str, revision_id: str | UUID
) -> ProjectCoverRevision:
    try:
        row = await db.get(ProjectCoverRevision, UUID(str(revision_id)))
    except (ValueError, TypeError):
        row = None
    if row is None or str(row.project_id) != str(project_id):
        raise CoverError("COVER_ASSET_MISSING", "本项目封面版本不存在", 404)
    return row


def cover_references(project_data: dict | None) -> list:
    ui = (project_data or {}).get("uiState")
    timeline = ui.get("currentTimelineState") if isinstance(ui, dict) else None
    tracks = timeline.get("tracks") if isinstance(timeline, dict) else None
    if not isinstance(tracks, list):
        return []
    references = []
    for track in tracks:
        items = track.get("items") if isinstance(track, dict) else None
        for item in items if isinstance(items, list) else []:
            metadata = item.get("metadata") if isinstance(item, dict) else None
            if (
                not isinstance(metadata, dict)
                or metadata.get("role") != "video-cover"
            ):
                continue
            reference = metadata.get("cover")
            references.append(reference if isinstance(reference, dict) else {})
    return references


async def applied_revision(
    db: AsyncSession, project_id: str, project_data: dict | None
) -> dict | None:
    refs = cover_references(project_data)
    if len(refs) != 1 or refs[0].get("projectId") != str(project_id):
        return None
    try:
        row = await get_revision(db, project_id, refs[0].get("revisionId"))
        return await revision_data(db, row)
    except CoverError:
        return None


# 超过 60 行：此入口集中装配同一项目快照，避免分散响应契约字段。
async def load_state(db: AsyncSession, project_id: str) -> dict:
    from app.config import settings

    project = await assets.require_project(db, project_id)
    draft = await get_document(db, project_id)
    revisions = (
        await db.execute(
            select(ProjectCoverRevision)
            .where(ProjectCoverRevision.project_id == project.id)
            .order_by(ProjectCoverRevision.created_at.desc())
            .limit(20)
        )
    ).scalars()
    readable = []
    for row in revisions:
        try:
            readable.append(await revision_data(db, row))
        except CoverError:
            continue  # 草稿仍可加载，损坏成品不可再声明为可用。
    # 活跃任务不限数量；终态配额在同一SQL内按项目独立计算。
    recent_terminal_ids = (
        select(ProjectCoverJob.id)
        .where(
            ProjectCoverJob.project_id == project.id,
            ProjectCoverJob.status.in_(
                ["succeeded", "failed", "cancelled", "interrupted"]
            ),
        )
        .order_by(ProjectCoverJob.created_at.desc(), ProjectCoverJob.id.desc())
        .limit(20)
    )
    jobs = (
        await db.execute(
            select(ProjectCoverJob)
            .where(
                ProjectCoverJob.project_id == project.id,
                or_(
                    ProjectCoverJob.status.in_(["queued", "running"]),
                    ProjectCoverJob.id.in_(recent_terminal_ids),
                ),
            )
            .order_by(ProjectCoverJob.created_at.desc(), ProjectCoverJob.id.desc())
        )
    ).scalars()
    from app.services.video_cover_job_service import job_data

    background_assets = (
        (
            await db.execute(
                select(ProjectCoverAsset).where(
                    ProjectCoverAsset.project_id == project.id,
                    ProjectCoverAsset.kind == "background",
                )
            )
        )
        .scalars()
        .all()
    )
    legacy = (
        await db.execute(
            select(ProjectCover).where(ProjectCover.project_id == project.id)
        )
    ).scalar_one_or_none()
    return {
        **draft_data(draft),
        "revisions": readable,
        "generation_configured": bool(settings.ark_api_key),
        "assets": [
            assets.asset_data(row)
            for row in background_assets
            if assets.asset_path(row).is_file()
        ],
        "jobs": [await job_data(db, job) for job in jobs],
        "applied_revision": await applied_revision(
            db, project_id, project.project_data
        ),
        "legacy_available": legacy is not None and draft is None,
        "legacy_url": project.cover_url if legacy and draft is None else None,
    }


async def upload_asset(db: AsyncSession, project_id: str, data: bytes) -> dict:
    await assets.require_project(db, project_id)
    image = await assets.decode_image(data)
    async with assets.project_locks(project_id):
        row = await assets.store_decoded(db, project_id, image)
        await db.commit()
        return assets.asset_data(row)


async def publish_revision(
    db: AsyncSession, project_id: str, data: bytes, options: dict
) -> dict:
    await assets.require_project(db, project_id)
    image = await assets.decode_image(data, png_only=True)
    async with assets.project_locks(project_id):
        await assets.require_project(db, project_id)
        existing = (
            await db.execute(
                select(ProjectCoverRevision).where(
                    ProjectCoverRevision.project_id == UUID(str(project_id)),
                    ProjectCoverRevision.request_id == options["request_id"],
                )
            )
        ).scalar_one_or_none()
        if existing:
            asset = await assets.get_asset(db, project_id, existing.asset_id)
            if (
                existing.document_hash != options["document_hash"]
                or asset.sha256 != image.sha256
                or (asset.width, asset.height) != (image.width, image.height)
            ):
                raise CoverError("COVER_REQUEST_CONFLICT", "相同请求键的内容不同", 409)
            return await revision_data(db, existing)
        draft = await get_document(db, project_id)
        if (
            not draft
            or draft.version != options["expected_version"]
            or document_hash(draft.document) != options["document_hash"]
        ):
            await raise_version_conflict(db, project_id)
        document = CoverDocument.model_validate(draft.document)
        await validate_ready(db, project_id, document)
        if (image.width, image.height) != COVER_DIMENSIONS[
            document.aspect_ratio
        ]:
            raise CoverError("COVER_ASPECT_MISMATCH", "封面像素尺寸不匹配", 422)
        asset = await assets.store_decoded(db, project_id, image, "render")
        row = ProjectCoverRevision(
            project_id=UUID(str(project_id)),
            request_id=options["request_id"],
            document=draft.document,
            document_hash=document_hash(draft.document),
            asset_id=asset.id,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return await revision_data(db, row)


async def import_revision(
    db: AsyncSession, project_id: str, payload: ImportCoverRequest
) -> dict:
    source_id = str(payload.source_project_id)
    async with assets.project_locks(project_id, source_id):
        await assets.require_project(db, project_id)
        origin = {
            "project_id": source_id,
            "revision_id": str(payload.source_revision_id),
        }
        existing = (
            await db.execute(
                select(ProjectCoverRevision).where(
                    ProjectCoverRevision.project_id == UUID(str(project_id)),
                    ProjectCoverRevision.request_id == payload.request_id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            if existing.import_source != origin:
                raise CoverError("COVER_REQUEST_CONFLICT", "导入请求键内容不同", 409)
            return await revision_data(db, existing)
        await assets.require_project(db, source_id)
        source = await get_revision(db, source_id, payload.source_revision_id)
        source_asset = await assets.get_asset(db, source_id, source.asset_id)
        image = await assets.decode_image(
            await assets.verify_asset(source_asset)
        )
        document = CoverDocument.model_validate(source.document)
        if document.background.asset_id:
            background = await assets.get_asset(
                db, source_id, document.background.asset_id
            )
            decoded = await assets.decode_image(
                await assets.verify_asset(background)
            )
            copied = await assets.store_decoded(db, project_id, decoded)
            document.background.asset_id = copied.id
        canonical = document.model_dump(mode="json")
        copied = await assets.store_decoded(db, project_id, image, "render")
        row = ProjectCoverRevision(
            project_id=UUID(str(project_id)),
            request_id=payload.request_id,
            document=canonical,
            import_source=origin,
            document_hash=document_hash(canonical),
            asset_id=copied.id,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return await revision_data(db, row)


# 超过 60 行：迁移的读取、像素回退和幂等判定共用同一项目锁与事务。
async def legacy_import(
    db: AsyncSession, project_id: str, request_id: str
) -> dict:
    async with assets.project_locks(project_id):
        project = await assets.require_project(db, project_id)
        draft = await get_document(db, project_id)
        if draft:
            if draft.legacy_import:
                return draft_data(draft)
            raise CoverError("COVER_REQUEST_CONFLICT", "已有新版草稿，不能覆盖", 409)
        old = (
            await db.execute(
                select(ProjectCover).where(
                    ProjectCover.project_id == project.id
                )
            )
        ).scalar_one_or_none()
        if not old:
            raise CoverError("COVER_ASSET_MISSING", "没有旧封面可导入", 404)
        document = CoverDocument(aspect_ratio=old.aspect_ratio)
        try:
            data = await asyncio.to_thread(
                assets.read_limited,
                assets.local_source_path(project.cover_url or ""),
            )
            image = await assets.decode_image(data)
            asset = await assets.store_decoded(db, project_id, image)
            document.mode = "ai"
            document.background.kind = "asset"
            document.background.asset_id = asset.id
        except (CoverError, OSError):
            layers = old.cover_config.get("textLayers", [])
            title = next(
                (
                    item.get("text", "")
                    for item in layers
                    if item.get("key") == "title"
                ),
                "",
            )
            subtitle = " ".join(
                item.get("text", "")
                for item in layers
                if item.get("key") != "title"
            )
            document.fields.title = title[:80]
            document.fields.subtitle = subtitle[:160]
        row = ProjectCoverDocument(
            project_id=project.id,
            version=1,
            document=document.model_dump(mode="json"),
            legacy_import={
                "request_id": request_id,
                "cover_config": old.cover_config,
                "url": project.cover_url,
                "updated_at": old.updated_at.isoformat()
                if old.updated_at
                else None,
            },
        )
        db.add(row)
        await db.commit()
        return draft_data(row)


async def assert_legacy_writable(db: AsyncSession, project_id: str) -> None:
    project = await assets.require_project(db, project_id)
    if (
        await get_document(db, project_id)
        or (project.project_data or {}).get("coverSchemaVersion") == 2
    ):
        raise CoverError("COVER_V2_ACTIVE", "项目已使用新版封面工作室", 409)
