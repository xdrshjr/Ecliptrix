"""持久、幂等且可取消的单进程封面生图队列。"""
import asyncio
from functools import partial
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import async_session_factory
from app.models.db_models import ProjectCoverJob
from app.models.ark_image_models import ArkImageGenerateRequest
from app.models.video_cover_v2_models import CoverError, CoverJobRequest
from app.services import video_cover_asset_service as assets
from app.services.video_cover_v2_service import (
    document_hash,
    get_document,
    raise_version_conflict,
)

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}
TEMPLATE_PROMPTS = {
    "editorial": "Editorial cover, elegant composition",
    "cinematic": "Cinematic lighting, dramatic composition",
    "knowledge": "Clear educational illustration, structured composition",
    "product": "Premium product photography, clean composition",
    "bold": "Bold graphic composition, high contrast",
}


async def job_data(db: AsyncSession, row: ProjectCoverJob) -> dict:
    result = []
    for identifier in row.result_asset_ids or []:
        try:
            result.append(
                assets.asset_data(
                    await assets.get_asset(db, row.project_id, identifier)
                )
            )
        except CoverError:
            continue
    return {
        "job_id": str(row.id),
        "status": row.status,
        "phase": row.phase,
        "base_version": row.base_version,
        "assets": result,
        "warnings": row.warnings or [],
        "error_code": row.error_code,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


class CoverJobService:
    def __init__(
        self, session_factory: async_sessionmaker | None = None
    ) -> None:
        self.session_factory = session_factory or async_session_factory
        self._active: dict[str, asyncio.Task] = {}
        self._active_projects: set[str] = set()
        self._dispatch_lock = asyncio.Lock()
        self._dispatcher = None
        self._dispatch_requested = False
        self._closed = False

    async def start(self) -> None:
        self._closed = False
        async with self.session_factory() as db:
            await db.execute(
                update(ProjectCoverJob)
                .where(ProjectCoverJob.status.in_(["queued", "running"]))
                .values(
                    status="interrupted",
                    phase="interrupted",
                    error_code="COVER_GENERATION_INTERRUPTED",
                )
            )
            await db.commit()
            await assets.recover_storage(db)

    async def close(self) -> None:
        self._closed = True
        tasks = list(self._active.values())
        if self._dispatcher:
            self._dispatcher.cancel()
            tasks.append(self._dispatcher)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def wake(self) -> None:
        if self._closed:
            return
        self._dispatch_requested = True
        if not self._dispatcher or self._dispatcher.done():
            self._dispatcher = asyncio.create_task(self._drain_dispatches())

    async def _drain_dispatches(self) -> None:
        # 扫描期间的提交/槽位释放必须再触发一轮，不能丢掉唤醒信号。
        while self._dispatch_requested and not self._closed:
            self._dispatch_requested = False
            await self._dispatch()

    async def submit(
        self, db: AsyncSession, project_id: str, payload: CoverJobRequest
    ) -> dict:
        async with assets.project_locks(project_id):
            await assets.require_project(db, project_id)
            canonical = payload.model_dump(mode="json")
            fingerprint = document_hash(canonical)
            existing = await self._by_request(
                db, project_id, payload.request_id
            )
            if existing:
                return await self._replay(db, existing, payload)
            await self._validate_input(db, project_id, payload)
            queued = (
                (
                    await db.execute(
                        select(ProjectCoverJob.id).where(
                            ProjectCoverJob.project_id == UUID(str(project_id)),
                            ProjectCoverJob.status == "queued",
                        )
                    )
                )
                .scalars()
                .all()
            )
            if len(queued) >= 2:
                raise CoverError("COVER_QUEUE_FULL", "此项目已有两个排队任务", 429)
            row = ProjectCoverJob(
                project_id=UUID(str(project_id)),
                request_id=payload.request_id,
                input_hash=fingerprint,
                base_version=payload.base_version,
                request_json=canonical,
                status="queued",
                phase="queued",
                result_asset_ids=[],
                warnings=[],
            )
            db.add(row)
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
                existing = await self._by_request(
                    db, project_id, payload.request_id
                )
                if existing is None:
                    raise
                return await self._replay(db, existing, payload)
            await db.refresh(row)
            result = await job_data(db, row)
        self.wake()
        return result

    async def _replay(self, db, existing, payload) -> dict:
        canonical = payload.model_dump(mode="json")
        fingerprint = document_hash(canonical)
        if existing.input_hash and existing.input_hash != fingerprint:
            raise CoverError("COVER_REQUEST_CONFLICT", "请求键内容不一致", 409)
        if existing.input_hash is None:
            existing.input_hash = fingerprint
            existing.request_json = canonical
            existing.base_version = payload.base_version
            await db.commit()
        return await job_data(db, existing)

    async def _validate_input(self, db, project_id, payload) -> None:
        draft = await get_document(db, project_id)
        if not draft or draft.version != payload.base_version:
            await raise_version_conflict(db, project_id)
        doc = draft.document
        matches = (
            doc["mode"] == payload.mode
            and doc["template_id"] == payload.template_id
            and doc["aspect_ratio"] == payload.aspect_ratio
            and doc["generation"]["prompt"] == payload.prompt
            and doc["generation"]["count"] == payload.count
        )
        if not matches:
            raise CoverError("COVER_VERSION_CONFLICT", "生图参数与草稿快照不符", 409)
        for identifier in payload.reference_asset_ids:
            row = await assets.get_asset(db, project_id, identifier)
            if row.kind != "background":
                raise CoverError("COVER_INVALID_ASSET", "参考图必须为背景资产", 422)

    async def _by_request(self, db, project_id, request_id):
        return (
            await db.execute(
                select(ProjectCoverJob)
                .where(
                    ProjectCoverJob.project_id == UUID(str(project_id)),
                    ProjectCoverJob.request_id == request_id,
                )
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()

    async def get(
        self, db: AsyncSession, project_id: str, job_id: str | UUID
    ) -> ProjectCoverJob:
        await assets.require_project(db, project_id)
        row = await db.get(
            ProjectCoverJob, UUID(str(job_id)), populate_existing=True
        )
        if row is None or str(row.project_id) != str(project_id):
            raise CoverError("COVER_ASSET_MISSING", "任务不存在", 404)
        return row

    async def cancel(
        self,
        db: AsyncSession,
        project_id: str,
        *,
        request_id: str | None = None,
        job_id: str | UUID | None = None,
    ) -> dict:
        async with assets.project_locks(project_id):
            await assets.require_project(db, project_id)
            row = (
                await self.get(db, project_id, job_id)
                if job_id
                else await self._by_request(db, project_id, request_id)
            )
            should_cancel = row is not None and row.status not in TERMINAL
            if row is None:
                row = ProjectCoverJob(
                    project_id=UUID(str(project_id)),
                    request_id=request_id,
                    status="cancelled",
                    phase="cancelled",
                    result_asset_ids=[],
                    warnings=[],
                )
                db.add(row)
            elif row.status not in TERMINAL:
                await db.execute(
                    update(ProjectCoverJob)
                    .where(
                        ProjectCoverJob.id == row.id,
                        ProjectCoverJob.status.in_(["queued", "running"]),
                    )
                    .values(status="cancelled", phase="cancelled")
                )
            await db.commit()
            await db.refresh(row)
            result = await job_data(db, row)
            task = self._active.get(str(row.id))
            if task and should_cancel and row.status == "cancelled":
                task.cancel()
            return result

    async def _dispatch(self) -> None:
        async with self._dispatch_lock:
            async with self.session_factory() as db:
                rows = (
                    (
                        await db.execute(
                            select(ProjectCoverJob)
                            .where(ProjectCoverJob.status == "queued")
                            .order_by(ProjectCoverJob.created_at)
                        )
                    )
                    .scalars()
                    .all()
                )
                for row in rows:
                    if self._closed or len(self._active) >= 2:
                        break
                    project = str(row.project_id)
                    if project in self._active_projects:
                        continue
                    async with assets.project_locks(project):
                        result = await db.execute(
                            update(ProjectCoverJob)
                            .where(
                                ProjectCoverJob.id == row.id,
                                ProjectCoverJob.status == "queued",
                            )
                            .values(status="running", phase="generating")
                        )
                        await db.commit()
                        if result.rowcount != 1:
                            continue
                        identifier = str(row.id)
                        self._active_projects.add(project)
                        task = asyncio.create_task(
                            self._run(identifier, project)
                        )
                        self._active[identifier] = task
                        task.add_done_callback(
                            partial(self._release_slot, identifier, project)
                        )

    def _release_slot(
        self, identifier: str, project: str, _task: asyncio.Task | None = None
    ) -> None:
        # done callback 也覆盖协程首次运行前被取消的情况。
        self._active.pop(identifier, None)
        self._active_projects.discard(project)
        self.wake()

    async def _run(self, identifier: str, project: str) -> None:
        try:
            async with asyncio.timeout(240):
                await self._generate(identifier, project)
        except asyncio.CancelledError:
            await self._finish(
                identifier, "interrupted", "COVER_GENERATION_INTERRUPTED"
            )
        except TimeoutError:
            await self._finish(identifier, "failed", "COVER_GENERATION_TIMEOUT")
        except Exception as exc:
            from app.logger import get_logger

            get_logger(__name__).warning("封面生成失败: %s", type(exc).__name__)
            await self._finish(identifier, "failed", "COVER_GENERATION_FAILED")

    # 超过 60 行：一次供应商调用及其逐图落盘共用同一任务执行范围。
    async def _generate(self, identifier: str, project: str) -> None:
        from app.services.ark_image_service import generate_images_with_pack

        async with self.session_factory() as db:
            row = await db.get(ProjectCoverJob, UUID(identifier))
            if row is None or row.status != "running":
                return
            payload = CoverJobRequest.model_validate(row.request_json)
            references = [
                assets.asset_data(await assets.get_asset(db, project, value))[
                    "url"
                ]
                for value in payload.reference_asset_ids
            ]
        ratio = payload.aspect_ratio
        size = (
            "720x1280"
            if ratio == "9:16"
            else ("2048x2048" if ratio == "1:1" else "1280x720")
        )
        prompt = "\n".join(
            [
                TEMPLATE_PROMPTS[payload.template_id],
                payload.prompt,
                f"Composition aspect ratio {ratio}",
            ]
        )
        if payload.mode == "mixed":
            prompt += "\n无文字，标题区域留白"
        request = ArkImageGenerateRequest(
            prompt=prompt,
            count=payload.count,
            size=size,
            mode="basic",
            grid_mode=False,
            aspect_ratio="16:9" if ratio == "21:9" else ratio,
            reference_images=references or None,
        )
        images, _ = await generate_images_with_pack(
            request, defer_download=True
        )
        await self._set_phase(identifier, "downloading")
        for image in images:
            try:
                data = (
                    await assets.run_blocking(
                        assets.read_limited,
                        assets.local_source_path(image.local_url),
                    )
                    if image.local_url
                    else await assets.download_image(image.image_url)
                )
                decoded = await assets.decode_image(data)
                await self._store_result(identifier, project, decoded)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await self._warning(
                    identifier, getattr(exc, "code", "COVER_INVALID_ASSET")
                )
        await self._finish(identifier, "succeeded", None)

    async def _set_phase(self, identifier, phase) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(ProjectCoverJob)
                .where(
                    ProjectCoverJob.id == UUID(identifier),
                    ProjectCoverJob.status == "running",
                )
                .values(phase=phase)
            )
            await db.commit()

    async def _store_result(self, identifier, project, image) -> None:
        async with assets.project_locks(project):
            async with self.session_factory() as db:
                row = await db.get(ProjectCoverJob, UUID(identifier))
                if row is None or row.status != "running":
                    return
                asset = await assets.store_decoded(db, project, image)
                if str(asset.id) not in row.result_asset_ids:
                    row.result_asset_ids = [
                        *row.result_asset_ids,
                        str(asset.id),
                    ]
                await db.commit()

    async def _warning(self, identifier, code) -> None:
        async with self.session_factory() as db:
            row = await db.get(ProjectCoverJob, UUID(identifier))
            if row is not None and row.status == "running":
                row.warnings = [*row.warnings, code]
                await db.commit()

    async def _finish(self, identifier, status, error) -> None:
        async with self.session_factory() as db:
            row = await db.get(ProjectCoverJob, UUID(identifier))
            if row is None or row.status != "running":
                return
            if row.result_asset_ids and status != "interrupted":
                status = "succeeded"
                if error:
                    row.warnings = [*row.warnings, error]
                error = None
            elif status == "succeeded":
                status, error = "failed", "COVER_GENERATION_FAILED"
            await db.execute(
                update(ProjectCoverJob)
                .where(
                    ProjectCoverJob.id == row.id,
                    ProjectCoverJob.status == "running",
                )
                .values(
                    status=status,
                    phase=status,
                    error_code=error,
                    warnings=row.warnings,
                )
            )
            await db.commit()


cover_job_service = CoverJobService()
