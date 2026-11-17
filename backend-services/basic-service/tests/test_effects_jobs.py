"""Real SQLite admission, CAS, immutable snapshots and replay semantics."""

import asyncio
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.db_models import VideoProject
from app.models.effects_db_models import EffectRenderJob
from app.models.effects_models import (
    EffectError, SaveDraftRequest, SubmitJobRequest, UpdateDraftRequest,
)
from app.services.effects import asset_service, draft_service
from app.services.effects.catalog import CATALOG_HASH, create_document
from app.services.effects.job_service import EffectRenderService


class ControlledRuntime:
    resource_root = Path(__file__).resolve().parents[3] / "desktop/build/effects"

    def load_manifest(self):
        return {"runtimeFingerprint": "a" * 64, "catalogHash": CATALOG_HASH,
                "engineVersion": "4.0.544", "fontHash": "b" * 64,
                "bundleHash": "c" * 64}

    async def health(self):
        return {**self.load_manifest(), "ready": True,
                "runtimeInstanceId": "controlled"}

    async def reset(self):
        return {"reset": True, "runtimeInstanceId": "controlled"}

    async def close(self):
        return None


async def create_project(db, monkeypatch, tmp_path):
    from app.services.local_media_resolver import settings
    monkeypatch.setattr(asset_service.storage_service, "root", tmp_path)
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))
    row = VideoProject(name="effects", project_data={})
    db.add(row)
    await db.commit()
    return str(row.id)


async def prepare_draft(db, project_id, **changes):
    document = create_document()
    document["content"]["title"] = "新的开始"
    document.update(changes)
    return await draft_service.create_draft(db, project_id,
        SaveDraftRequest(name="作品", document=document))


def job_request(draft, **changes):
    return SubmitJobRequest.model_validate({"request_id": str(uuid4()),
        "draft_id": draft["draft_id"], "expected_version": draft["version"],
        **changes})


async def dormant_service(db):
    service = EffectRenderService(async_sessionmaker(db.bind,
        expire_on_commit=False), runtime=ControlledRuntime())
    service.wake = lambda: None
    await service.start()
    return service


@pytest.mark.asyncio
async def test_cancel_between_select_and_claim_does_not_strand_next_job(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    draft = await prepare_draft(db_session, project_id)
    service = await dormant_service(db_session)
    first, _ = await service.submit(db_session, project_id, job_request(draft))
    second, _ = await service.submit(db_session, project_id, job_request(draft))
    from datetime import datetime
    from uuid import UUID
    from sqlalchemy import update
    for order, submitted in enumerate([first, second]):
        await db_session.execute(update(EffectRenderJob).where(
            EffectRenderJob.id == UUID(submitted["job_id"])).values(
            created_at=datetime(2020 + order, 1, 1)))
    await db_session.commit()
    original_claim = service._claim_row
    dispatched = []

    async def claim_after_cancel(db, row):
        if str(row.id) == first["job_id"]:
            from sqlalchemy import update
            async with service.session_factory() as cancel_db:
                await cancel_db.execute(update(EffectRenderJob).where(
                    EffectRenderJob.id == row.id).values(
                    status="cancelled", phase="cancelled"))
                await cancel_db.commit()
        return await original_claim(db, row)

    async def record_dispatch(identifier):
        dispatched.append(identifier)

    service._claim_row = claim_after_cancel
    service._run_job = record_dispatch
    service._requested = True
    try:
        await service._drain_dispatches()
        assert dispatched == [second["job_id"]]
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_replay_survives_draft_change_soft_delete_and_runtime_loss(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    draft = await prepare_draft(db_session, project_id)
    service = await dormant_service(db_session)
    request = job_request(draft)
    try:
        first, replay = await service.submit(db_session, project_id, request)
        assert not replay and first["status"] == "queued"
        changed = await draft_service.update_draft(db_session, project_id,
            draft["draft_id"], UpdateDraftRequest(name="changed",
                expected_version=1, document=draft["document"]))
        await draft_service.delete_draft(db_session, project_id,
            draft["draft_id"], changed["version"])
        service._ready = False
        again, replay = await service.submit(db_session, project_id, request)
        assert replay and again["job_id"] == first["job_id"]
        altered = request.model_copy(update={"expected_version": 2})
        with pytest.raises(EffectError, match="EFFECT_IDEMPOTENCY_CONFLICT"):
            await service.submit(db_session, project_id, altered)
        assert await db_session.scalar(select(func.count()).select_from(
            EffectRenderJob)) == 1
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_incomplete_draft_never_creates_job(db_session, monkeypatch,
                                                tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    draft = await prepare_draft(db_session, project_id, content={"title": ""})
    service = await dormant_service(db_session)
    try:
        with pytest.raises(EffectError) as error:
            await service.submit(db_session, project_id, job_request(draft))
        assert error.value.code == "EFFECT_DRAFT_INCOMPLETE"
        assert await db_session.scalar(select(func.count()).select_from(
            EffectRenderJob)) == 0
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_project_quota_and_replay_order(db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    draft = await prepare_draft(db_session, project_id)
    service = await dormant_service(db_session)
    requests = [job_request(draft) for _ in range(6)]
    try:
        for request in requests[:5]:
            await service.submit(db_session, project_id, request)
        with pytest.raises(EffectError) as error:
            await service.submit(db_session, project_id, requests[5])
        assert error.value.code == "EFFECT_QUEUE_FULL"
        assert (await service.submit(db_session, project_id, requests[0]))[1]
        row = await service.by_request(db_session, project_id,
                                      requests[0].request_id)
        assert row.request_json["render_snapshot"]["document"]["content"] \
            ["title"] == "新的开始"
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_concurrent_duplicate_and_cross_project_global_quota(
        db_session, monkeypatch, tmp_path):
    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)
    projects = []
    for _ in range(5):
        project_id = await create_project(db_session, monkeypatch, tmp_path)
        projects.append((project_id, await prepare_draft(db_session, project_id)))
    service = await dormant_service(db_session)

    async def submit(project_id, request):
        async with factory() as db:
            return await service.submit(db, project_id, request)

    try:
        project_id, draft = projects[0]
        request = job_request(draft)
        duplicate = await asyncio.gather(submit(project_id, request),
                                         submit(project_id, request))
        assert duplicate[0][0]["job_id"] == duplicate[1][0]["job_id"]
        pending = [submit(project, job_request(item)) for project, item
                   in projects[:4] for _ in range(4 if project == project_id else 5)]
        await asyncio.gather(*pending)
        assert await db_session.scalar(select(func.count()).select_from(
            EffectRenderJob)) == 20
        with pytest.raises(EffectError) as error:
            await submit(projects[4][0], job_request(projects[4][1]))
        assert error.value.code == "EFFECT_QUEUE_FULL"
    finally:
        await service.close()
