"""Stable draft IDs and narrowly scoped replay use real SQLite writes."""

import asyncio
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.db_models import Base, VideoProject
from app.models.effects_db_models import EffectDraft
from app.models.effects_models import (
    EffectError, SaveDraftRequest, UpdateDraftRequest,
)
from app.services.effects import draft_service
from app.services.effects.catalog import create_document


async def make_project(db):
    project = VideoProject(name="重放测试", project_data={})
    db.add(project)
    await db.commit()
    return str(project.id)


def create_request(identifier, **changes):
    return SaveDraftRequest.model_validate({
        "draft_id": identifier, "name": "作品",
        "document": create_document(), **changes,
    })


@pytest.mark.asyncio
async def test_create_replay_preserves_one_row_and_version(db_session):
    project_id = await make_project(db_session)
    request = create_request(str(uuid4()))
    first = await draft_service.create_draft(db_session, project_id, request)
    second = await draft_service.create_draft(db_session, project_id, request)
    assert first == second
    assert first["draft_id"] == request.draft_id
    assert second["version"] == 1
    assert await db_session.scalar(select(func.count()).select_from(
        EffectDraft)) == 1


@pytest.mark.asyncio
async def test_create_rejects_other_body_project_soft_delete_and_new_version(
        db_session):
    project_id = await make_project(db_session)
    other_project = await make_project(db_session)
    request = create_request(str(uuid4()))
    first = await draft_service.create_draft(db_session, project_id, request)
    for owner, replay in [
        (project_id, create_request(request.draft_id, name="异名")),
        (other_project, request),
    ]:
        with pytest.raises(EffectError) as caught:
            await draft_service.create_draft(db_session, owner, replay)
        assert caught.value.code == "EFFECT_IDEMPOTENCY_CONFLICT"
    await draft_service.update_draft(db_session, project_id, first["draft_id"],
        UpdateDraftRequest(name=request.name, document=request.document,
                           expected_version=1))
    with pytest.raises(EffectError, match="EFFECT_IDEMPOTENCY_CONFLICT"):
        await draft_service.create_draft(db_session, project_id, request)
    await draft_service.delete_draft(db_session, project_id,
                                    first["draft_id"], 2)
    with pytest.raises(EffectError, match="EFFECT_IDEMPOTENCY_CONFLICT"):
        await draft_service.create_draft(db_session, project_id, request)


@pytest.mark.asyncio
async def test_put_only_replays_exact_expected_plus_one(db_session):
    project_id = await make_project(db_session)
    first = await draft_service.create_draft(db_session, project_id,
                                            create_request(str(uuid4())))
    request = UpdateDraftRequest(name="新名称", document=first["document"],
                                 expected_version=1)
    updated = await draft_service.update_draft(db_session, project_id,
                                               first["draft_id"], request)
    replay = await draft_service.update_draft(db_session, project_id,
                                              first["draft_id"], request)
    assert replay == updated
    assert replay["version"] == 2
    with pytest.raises(EffectError, match="EFFECT_VERSION_CONFLICT"):
        await draft_service.update_draft(db_session, project_id,
            first["draft_id"], request.model_copy(update={"name": "另一个"}))
    await draft_service.update_draft(db_session, project_id, first["draft_id"],
        request.model_copy(update={"expected_version": 2}))
    with pytest.raises(EffectError, match="EFFECT_VERSION_CONFLICT"):
        await draft_service.update_draft(db_session, project_id,
                                         first["draft_id"], request)


@pytest.mark.asyncio
async def test_concurrent_create_merges_primary_key_race(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/replay.db")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        project_id = await make_project(db)
    request = create_request(str(uuid4()))
    reached = 0
    both = asyncio.Event()
    original_validate = draft_service.validate_assets

    @asynccontextmanager
    async def no_process_lock(_):
        yield

    async def synchronized_validate(*args):
        nonlocal reached
        await original_validate(*args)
        reached += 1
        if reached == 2:
            both.set()
        await asyncio.wait_for(both.wait(), timeout=3)

    monkeypatch.setattr(draft_service, "project_lock", no_process_lock)
    monkeypatch.setattr(draft_service, "validate_assets", synchronized_validate)

    async def create():
        async with sessions() as db:
            return await draft_service.create_draft(db, project_id, request)

    try:
        results = await asyncio.gather(create(), create())
        assert results[0] == results[1]
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(
                EffectDraft)) == 1
            row = await db.get(EffectDraft, UUID(request.draft_id))
            assert row.version == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_put_rejects_different_body_and_deleted_draft(db_session):
    project_id = await make_project(db_session)
    first = await draft_service.create_draft(db_session, project_id,
                                            create_request(str(uuid4())))
    request = UpdateDraftRequest(name="已发送", expected_version=1,
                                 document=first["document"])
    await draft_service.update_draft(db_session, project_id,
                                     first["draft_id"], request)
    changed_document = create_document()
    changed_document["content"]["title"] = "第三方内容"
    with pytest.raises(EffectError, match="EFFECT_VERSION_CONFLICT"):
        await draft_service.update_draft(db_session, project_id,
            first["draft_id"], request.model_copy(update={
                "document": changed_document,
            }))
    await draft_service.delete_draft(db_session, project_id,
                                     first["draft_id"], 2)
    with pytest.raises(EffectError, match="EFFECT_VERSION_CONFLICT"):
        await draft_service.update_draft(db_session, project_id,
                                         first["draft_id"], request)


@pytest.mark.asyncio
async def test_concurrent_identical_put_advances_once(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/put.db")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        project_id = await make_project(db)
        draft = await draft_service.create_draft(db, project_id,
                                                 create_request(str(uuid4())))
    request = UpdateDraftRequest(name="并发保存", document=draft["document"],
                                 expected_version=1)
    reached = 0
    both = asyncio.Event()

    @asynccontextmanager
    async def no_process_lock(_):
        yield

    async def synchronized_validate(*_):
        nonlocal reached
        reached += 1
        if reached == 2:
            both.set()
        await asyncio.wait_for(both.wait(), timeout=3)
        return []

    monkeypatch.setattr(draft_service, "project_lock", no_process_lock)
    monkeypatch.setattr(draft_service, "validate_assets", synchronized_validate)

    async def update():
        async with sessions() as db:
            return await draft_service.update_draft(db, project_id,
                                                     draft["draft_id"], request)

    try:
        results = await asyncio.gather(update(), update())
        assert results[0] == results[1]
        assert results[0]["version"] == 2
    finally:
        await engine.dispose()
