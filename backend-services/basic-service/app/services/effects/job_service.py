"""Durable FIFO rendering, conservative recovery and idempotent admission."""

import asyncio
import copy
import time
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.database import async_session_factory
from app.logger import get_logger
from app.models.effects_db_models import EffectRenderJob
from app.models.effects_models import EffectError
from . import asset_service as assets, draft_service as drafts, recovery
from .catalog import (
    ACTIVE, CATALOG_HASH, TERMINAL, document_hash, normalize_document,
    renderability, to_runtime_document,
)
from .project_locks import project_lock, require_project
from .runtime_client import EffectsRuntimeClient

logger = get_logger(__name__)


async def job_data(db, row: EffectRenderJob) -> dict:
    """Never return request_json, credentials or private filesystem paths."""
    result = {"job_id": str(row.id), "project_id": str(row.project_id),
              "draft_id": str(row.draft_id), "draft_version": row.draft_version,
              "request_id": str(row.request_id), "status": row.status,
              "phase": row.phase, "progress": row.progress,
              "retry_after_ms": 0 if row.status in TERMINAL else 1000,
              "created_at": row.created_at.isoformat(),
              "updated_at": row.updated_at.isoformat(),
              "error_code": row.error_code, "error_message": row.error_message,
              "output_asset": None, "material": None}
    if row.status == "succeeded":
        try:
            asset = await assets.get_asset(db, str(row.project_id),
                                           str(row.result_asset_id))
            result["output_asset"] = await assets.asset_data(db, asset)
            result["material"] = assets.material_data(result["output_asset"])
        except EffectError as exc:
            if exc.code != "EFFECT_OUTPUT_MISSING":
                raise
            result["error_code"] = exc.code
    return result


class EffectRenderService:
    """One process owns the queue; only durable rows represent accepted jobs."""

    def __init__(self, session_factory=None, *, runtime=None) -> None:
        self.session_factory = session_factory or async_session_factory
        self.runtime = runtime or EffectsRuntimeClient()
        self.manifest: dict = {}
        self.runtime_info: dict = {}
        self._ready = False
        self._closed = True
        self._reason = "EFFECT_RUNTIME_UNAVAILABLE"
        self._submit_lock = asyncio.Lock()
        self._refresh_lock = asyncio.Lock()
        self._dispatcher: asyncio.Task | None = None
        self._monitor: asyncio.Task | None = None
        self._requested = False
        self._active_job: str | None = None
        self._startup_pending = True

    async def start(self) -> None:
        self._closed = False
        self._startup_pending = True
        self._ready = False
        await self.refresh_runtime()
        self._monitor = asyncio.create_task(self._monitor_runtime())

    async def close(self) -> None:
        """Drain without reporting a live renderer as cancelled."""
        self._closed, self._ready = True, False
        if self._monitor:
            self._monitor.cancel()
            await asyncio.gather(self._monitor, return_exceptions=True)
        if self._active_job:
            try:
                await self.runtime.cancel(self._active_job)
            except EffectError:
                pass  # Parent drain timeout owns final tree cleanup.
        if self._dispatcher:
            try:
                await asyncio.wait_for(asyncio.shield(self._dispatcher), 8)
            except asyncio.TimeoutError:
                self._dispatcher.cancel()
                await asyncio.gather(self._dispatcher, return_exceptions=True)
        await self.runtime.close()

    async def capabilities(self) -> dict:
        if self._ready:
            try:
                health = await self.runtime.health()
                if health["runtimeInstanceId"] != self.runtime_info.get(
                        "runtimeInstanceId"):
                    self._ready = False
                    self._reason = "EFFECT_RUNTIME_UNAVAILABLE"
            except EffectError as exc:
                self._ready, self._reason = False, exc.code
        return {"ready": self._ready and not self._closed,
                "protocol_version": 1, "engine_version": "4.0.544",
                "catalog_hash": CATALOG_HASH,
                "unavailable_reason": None if self._ready else self._reason,
                "limits": {"max_duration_frames": 1800, "fps": 30,
                           "max_input_bytes": assets.MAX_BYTES,
                           "max_project_jobs": 5, "max_global_jobs": 20}}

    async def refresh_runtime(self, *, retry_payload: bool = False) -> dict:
        """A healthy instance is probed, never reset during an active job."""
        if self._closed:
            return await self.capabilities()
        async with self._refresh_lock:
            try:
                health = await self._probe_runtime(retry_payload)
                if (self._ready and health["runtimeInstanceId"]
                        == self.runtime_info.get("runtimeInstanceId")):
                    return await self.capabilities()
                self._ready = False
                reset = await self.runtime.reset()
                if not reset.get("reset"):
                    raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503)
                self.manifest = await asyncio.to_thread(
                    self.runtime.load_manifest)
                self.runtime_info = health
                await recovery.recover_jobs(self, startup=self._startup_pending)
                await recovery.cleanup_stale(self)
                self._startup_pending = False
                self._ready = True
                self._mark_available()
                self.wake()
            except EffectError as exc:
                self._ready = False
                self._mark_unavailable(exc)
        return await self.capabilities()

    async def _probe_runtime(self, retry_payload: bool) -> dict:
        """Probe the runtime, optionally re-running its payload gate first.

        Only an explicitly requested retry (「重试渲染组件」) resets, because a
        reset of a rejected payload re-hashes the whole installation; the 5s
        monitor must not do that in a loop.
        """
        try:
            return await self.runtime.health()
        except EffectError:
            if not retry_payload:
                raise
            await self.runtime.reset()
            return await self.runtime.health()

    def _mark_unavailable(self, error: EffectError) -> None:
        """Log one line per capability state change; silence hid this bug."""
        if self._reason != error.code:
            logger.warning("Effects renderer unavailable", {
                "code": error.code, "details": error.details})
        self._reason = error.code

    def _mark_available(self) -> None:
        if self._reason:
            logger.info("Effects renderer available", {"previous": self._reason})
        self._reason = ""

    async def _monitor_runtime(self) -> None:
        sweeps = 0
        while not self._closed:
            await asyncio.sleep(5)
            try:
                await self.refresh_runtime()
                sweeps += 1
                if sweeps % 720 == 0:
                    await recovery.cleanup_stale(self)
            except Exception as exc:
                self._ready = False
                logger.error("Effects monitor failed",
                             {"type": type(exc).__name__})

    async def by_request(self, db, project_id: str,
                          request_id: str) -> EffectRenderJob | None:
        return (await db.execute(select(EffectRenderJob).where(
            EffectRenderJob.project_id == UUID(project_id),
            EffectRenderJob.request_id == UUID(request_id),
        ).execution_options(populate_existing=True))).scalar_one_or_none()

    async def get(self, db, project_id: str, job_id: str) -> EffectRenderJob:
        await require_project(db, project_id, writable=False)
        row = await db.get(EffectRenderJob, UUID(job_id),
                           populate_existing=True)
        if row is None or str(row.project_id) != project_id:
            raise EffectError("EFFECT_NOT_FOUND", status=404)
        return row

    async def submit(self, db, project_id: str, payload) -> tuple[dict, bool]:
        submission = {"draft_id": payload.draft_id,
                      "expected_version": payload.expected_version,
                      "output": payload.output.model_dump()}
        fingerprint = document_hash(submission)
        async with self._submit_lock:
            async with project_lock(project_id):
                await require_project(db, project_id)
                old = await self.by_request(db, project_id, payload.request_id)
                if old:
                    return await self._replay(db, old, fingerprint), True
                await self._check_admission(db, project_id)
                snapshot = await self._create_snapshot(db, project_id, payload)
                row = EffectRenderJob(project_id=UUID(project_id),
                    draft_id=UUID(payload.draft_id),
                    request_id=UUID(payload.request_id),
                    submission_hash=fingerprint,
                    input_hash=document_hash(snapshot),
                    draft_version=payload.expected_version,
                    request_json={"submission": submission,
                                  "render_snapshot": snapshot},
                    runtime_fingerprint=self.manifest["runtimeFingerprint"])
                db.add(row)
                replay = await self._commit_submission(db, row, fingerprint)
                result = await job_data(db, replay or row)
        self.wake()
        return result, replay is not None

    async def _replay(self, db, row, fingerprint: str) -> dict:
        if row.submission_hash != fingerprint:
            raise EffectError("EFFECT_IDEMPOTENCY_CONFLICT", status=409)
        return await job_data(db, row)

    async def _check_admission(self, db, project_id: str) -> None:
        if self._closed or not self._ready or self._startup_pending:
            raise EffectError(self._reason or "EFFECT_RUNTIME_UNAVAILABLE",
                              status=503)
        try:
            health = await self.runtime.health()
            if health["runtimeInstanceId"] != self.runtime_info.get(
                    "runtimeInstanceId"):
                raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503)
        except EffectError as exc:
            self._ready, self._reason = False, exc.code
            raise
        active = select(func.count()).select_from(EffectRenderJob).where(
            EffectRenderJob.status.in_(ACTIVE))
        total = await db.scalar(active)
        project = await db.scalar(active.where(
            EffectRenderJob.project_id == UUID(project_id)))
        if total >= 20 or project >= 5:
            raise EffectError("EFFECT_QUEUE_FULL", "渲染队列已满", 429,
                              {"retry_after": 5})

    async def _create_snapshot(self, db, project_id: str, payload) -> dict:
        row = await drafts.get_draft(db, project_id, payload.draft_id,
                                     writable=True)
        if row.version != payload.expected_version:
            raise EffectError("EFFECT_VERSION_CONFLICT", status=409)
        document = normalize_document(row.document_json)
        ready = renderability(document)
        if not ready["ready"]:
            raise EffectError("EFFECT_DRAFT_INCOMPLETE", "草稿尚未完成", 409,
                              {"fields": ready["errors"]})
        inputs = await drafts.validate_assets(db, project_id, document)
        inputs = await asyncio.wait_for(asyncio.to_thread(
            recovery.validate_snapshot_inputs, document, inputs), 60)
        actual = copy.deepcopy(document)
        limit = 1280 if payload.output.profile == "mp4-720p" else 1920
        factor = min(1, limit / max(actual["canvas"]["width"],
                                    actual["canvas"]["height"]))
        for key in ("width", "height"):
            actual["canvas"][key] = int(actual["canvas"][key] * factor / 2) * 2
        if min(actual["canvas"]["width"], actual["canvas"]["height"]) < 64:
            raise EffectError("EFFECT_SOURCE_RANGE_INVALID", status=422)
        await asyncio.to_thread(recovery.validate_text_layout, actual,
                                self.runtime.resource_root)
        await require_project(db, project_id)
        return {"document": actual, "document_hash": row.document_hash,
                "inputs": inputs, "output": payload.output.model_dump(),
                "runtime": {key: self.manifest[key] for key in (
                    "runtimeFingerprint", "catalogHash", "engineVersion",
                    "fontHash", "bundleHash")}}

    async def _commit_submission(self, db, row, fingerprint: str):
        project_id, request_id = str(row.project_id), str(row.request_id)
        try:
            await db.commit()
            await db.refresh(row)
            return None
        except IntegrityError:
            await db.rollback()
            existing = await self.by_request(db, project_id, request_id)
            if existing is None:
                raise
            await self._replay(db, existing, fingerprint)
            return existing

    def wake(self) -> None:
        if self._closed or not self._ready:
            return
        self._requested = True
        if self._dispatcher is None or self._dispatcher.done():
            self._dispatcher = asyncio.create_task(self._drain_dispatches())

    async def _drain_dispatches(self) -> None:
        while self._requested and not self._closed and self._ready:
            self._requested = False
            while not self._closed and self._ready:
                try:
                    identifier = await self._claim_next()
                except EffectError as exc:
                    self._ready = False
                    self._mark_unavailable(exc)
                    break
                if identifier is None:
                    break
                self._active_job = identifier
                try:
                    await self._run_job(identifier)
                finally:
                    self._active_job = None

    async def _claim_next(self) -> str | None:
        health = await self.runtime.health()
        if health["runtimeInstanceId"] != self.runtime_info.get(
                "runtimeInstanceId"):
            self._ready = False
            return None
        async with self.session_factory() as db:
            row = (await db.execute(select(EffectRenderJob).where(
                EffectRenderJob.status == "queued").order_by(
                EffectRenderJob.created_at, EffectRenderJob.id).limit(1))) \
                .scalar_one_or_none()
            if row is None:
                return None
            if row.runtime_fingerprint != health["runtimeFingerprint"]:
                row.status, row.phase = "interrupted", "interrupted"
                row.error_code = "EFFECT_RUNTIME_MISMATCH"
                await db.commit()
                self._requested = True
                return None
            identifier = await self._claim_row(db, row)
            if identifier is None:
                # A concurrent cancel/close consumed this row, not the queue.
                self._requested = True
            return identifier

    async def _claim_row(self, db, row) -> str | None:
        async with project_lock(row.project_id):
            try:
                await require_project(db, row.project_id)
            except EffectError:
                row.status, row.phase = "cancelled", "cancelled"
                await db.commit()
                return None
            result = await db.execute(update(EffectRenderJob).where(
                EffectRenderJob.id == row.id, EffectRenderJob.status == "queued"
            ).values(status="running", phase="preparing",
                     started_at=datetime.now(timezone.utc)))
            await db.commit()
            return str(row.id) if result.rowcount == 1 else None

    async def _run_job(self, job_id: str) -> None:
        has_exited = True
        try:
            submission = await self._prepare_submission(job_id)
            if submission is None:
                return
            has_exited = False
            if not await self._submit_to_worker(job_id, submission):
                return
            result = await self._poll_worker(job_id)
            has_exited = result["state"] in TERMINAL
            if result["state"] == "succeeded":
                await self._publish_result(job_id, result)
            elif result["state"] == "cancelled":
                await self._finish_terminal(job_id, "cancelled")
            else:
                raise EffectError(result.get("errorCode")
                                  or "EFFECT_MEDIA_DECODE_FAILED")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            code = exc.code if isinstance(exc, EffectError) \
                else "EFFECT_RENDER_INTERRUPTED"
            await self._handle_failure(job_id, code, has_exited)

    async def _submit_to_worker(self, job_id: str, submission: dict) -> bool:
        async with self.session_factory() as db:
            job = await db.get(EffectRenderJob, UUID(job_id))
            if job is None:
                return False
            async with project_lock(job.project_id):
                await require_project(db, job.project_id)
                await db.refresh(job)
                if job.cancel_requested or job.status in TERMINAL:
                    job.status, job.phase = "cancelled", "cancelled"
                    await recovery.cleanup_work(job)
                    await db.commit()
                    return False
                await self.runtime.submit(submission)
                return True

    async def _prepare_submission(self, job_id: str) -> dict | None:
        async with self.session_factory() as db:
            job = await db.get(EffectRenderJob, UUID(job_id))
            async with project_lock(job.project_id):
                await require_project(db, job.project_id)
                await db.refresh(job)
                if job.cancel_requested:
                    job.status, job.phase = "cancelled", "cancelled"
                    await db.commit()
                    return None
                inputs = await self._prepare_inputs(job)
                return {"projectId": str(job.project_id), "jobId": job_id,
                        "requestHash": job.input_hash, "inputs": inputs,
                        "document": to_runtime_document(
                            job.request_json["render_snapshot"]["document"]),
                        "output": job.request_json["submission"]["output"]}

    async def _prepare_inputs(self, job) -> list[dict]:
        # A cancelled await must not leave a background writer recreating
        # files after the project lock has been released for deletion.
        preparation = asyncio.create_task(asyncio.to_thread(
            recovery.prepare_work, job, time.monotonic() + 60))
        try:
            return await asyncio.shield(preparation)
        except asyncio.CancelledError:
            await preparation
            raise

    async def _poll_worker(self, job_id: str) -> dict:
        deadline = asyncio.get_running_loop().time() + 900
        while asyncio.get_running_loop().time() < deadline:
            state = await self.runtime.get(job_id)
            if state["state"] in TERMINAL:
                return state
            await self._record_progress(job_id, state)
            async with self.session_factory() as db:
                row = await db.get(EffectRenderJob, UUID(job_id))
                if row is None:
                    raise EffectError("EFFECT_NOT_FOUND", status=404)
                should_cancel = row.cancel_requested
            if should_cancel:
                await self.runtime.cancel(job_id)
            await asyncio.sleep(1)
        raise EffectError("EFFECT_RENDER_TIMEOUT")

    async def _record_progress(self, job_id: str, state: dict) -> None:
        phase = state.get("phase", "preparing")
        progress = {"preparing": 0.02, "frames": 0.05,
                    "encoding": 0.85}.get(phase, 0.95)
        if phase == "frames":
            progress += min(0.99, max(0, state.get("progress", 0))) * 0.8
        async with self.session_factory() as db:
            row = await db.get(EffectRenderJob, UUID(job_id))
            if row is None:
                return
            async with project_lock(row.project_id):
                await require_project(db, row.project_id, writable=False)
                await db.refresh(row)
                if row.status in TERMINAL:
                    return
                row.phase = phase
                row.progress = max(row.progress, min(0.99, progress))
                await db.commit()

    async def _publish_result(self, job_id: str, result: dict) -> None:
        async with self.session_factory() as db:
            row = await db.get(EffectRenderJob, UUID(job_id))
            should_cancel = row is None or row.cancel_requested
        if should_cancel:
            await self._finish_terminal(job_id, "cancelled")
            return
        await self._record_progress(job_id, {"phase": "validating"})
        validated = await asyncio.to_thread(recovery.validate_output,
                                            row, result)
        await self._record_progress(job_id, {"phase": "publishing"})
        if not await recovery.publish_output(self, job_id, validated):
            await self._finish_terminal(job_id, "cancelled")
        else:
            await recovery.cleanup_work(row)

    async def _finish_terminal(self, job_id: str, status: str,
                                code: str | None = None) -> None:
        async with self.session_factory() as db:
            row = await db.get(EffectRenderJob, UUID(job_id))
            if row is None:
                return
            async with project_lock(row.project_id):
                await require_project(db, row.project_id, writable=False)
                await db.refresh(row)
                if row.status in TERMINAL:
                    return
                row.status = "cancelled" if row.cancel_requested else status
                row.phase = row.status
                row.error_code = None if row.status == "cancelled" else code
                row.finished_at = datetime.now(timezone.utc)
                await recovery.cleanup_work(row)
                await db.commit()

    async def _handle_failure(self, job_id: str, code: str,
                               has_exited: bool) -> None:
        if not has_exited:
            try:
                stopped = await self.runtime.cancel(job_id)
                has_exited = stopped["state"] in TERMINAL
            except EffectError:
                self._ready = False
        if has_exited and code != "EFFECT_RENDER_INTERRUPTED":
            await self._finish_terminal(job_id, "failed", code)
        else:
            self._ready = False
            self._reason = "EFFECT_RUNTIME_UNAVAILABLE"
        logger.warning("Effects job needs attention", {"job_id": job_id,
                                                       "code": code})

    async def cancel(self, db, project_id: str, job_id: str) -> dict:
        async with project_lock(project_id):
            await require_project(db, project_id)
            row = await self.get(db, project_id, job_id)
            if row.status in TERMINAL:
                return {**await job_data(db, row), "already_terminal": True}
            row.cancel_requested = True
            row.status = "cancelled" if row.status == "queued" else "cancelling"
            row.phase = row.status if row.status == "cancelled" else row.phase
            await db.commit()
        if row.status == "cancelling":
            try:
                stopped = await self.runtime.cancel(job_id)
                if stopped["state"] in TERMINAL:
                    await self._finish_terminal(job_id, "cancelled")
            except EffectError:
                self._ready = False
        return await job_data(db, await self.get(db, project_id, job_id))

    async def cancel_project(self, project_id: str) -> None:
        """Deletion releases its project lock before waiting for this drain."""
        async with self.session_factory() as db:
            rows = list((await db.execute(select(EffectRenderJob).where(
                EffectRenderJob.project_id == UUID(project_id),
                EffectRenderJob.status.in_(ACTIVE)))).scalars())
        for row in rows:
            if row.status != "queued":
                try:
                    stopped = await self.runtime.cancel(str(row.id))
                    if stopped["state"] not in TERMINAL:
                        raise EffectError("EFFECT_RUNTIME_UNAVAILABLE",
                                          status=503)
                except EffectError as exc:
                    if exc.code != "EFFECT_NOT_FOUND":
                        raise
            await self._finish_terminal(str(row.id), "cancelled")


effect_render_service = EffectRenderService()
