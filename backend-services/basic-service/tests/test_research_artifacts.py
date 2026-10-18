import pytest


@pytest.mark.asyncio
async def test_v2_report_round_trip_and_legacy_paging_preserve_quality(tmp_path):
    import json
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.research_db_models import ResearchArtifact
    from app.models.web_research_models import WebResearchError
    from app.services.web_research.artifact_store import ArtifactStore
    from app.services.web_research.provenance import source_record
    from app.services.web_research.research_report import (
        normalize_source, finalize_report, serialize_report,
    )
    from app.services.web_research.web_research_service import stage_state
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(ResearchArtifact.__table__.create)
    store = ArtifactStore(tmp_path, async_sessionmaker(engine, expire_on_commit=False))
    source = source_record('https://example.com/?token=private&lang=zh', '标题')
    evidence = [normalize_source(source, snippet='搜索摘要🙂', error_code='robots_disallowed')]
    report = finalize_report({'evidence': evidence, 'report': None,
        'model_usage': {name: stage_state('disabled') for name in ('query', 'synthesis')}})
    original = serialize_report(report, evidence)
    row = await store.write('report', original,
                            {'run_id': 'r', 'project_id': 'project-a'})
    offset, chunks = 0, []
    while offset is not None:
        page = await store.read(row.id, 'project-a', offset, 67)
        chunks.append(page['content'])
        offset = page['next_offset']
    decoded = json.loads(''.join(chunks))
    assert decoded['schema_version'] == 2
    assert decoded['quality'] == 'snippets_only'
    assert decoded['evidence'][0]['text'] == '搜索摘要🙂'
    assert decoded['sources'][0]['fetch_error_code'] == 'robots_disallowed'
    assert 'private' not in original.decode()
    with pytest.raises(WebResearchError):
        await store.read(row.id, 'project-b')
    legacy = b'{"brief":"legacy","facts":[],"sources":[]}'
    old = await store.write('report', legacy, {'run_id': 'r', 'project_id': 'project-a'})
    assert json.loads((await store.read(old.id, 'project-a'))['content'])['brief'] == 'legacy'
    await engine.dispose()


def test_utf8_pages_have_no_loss_and_reject_midpoint():
    from app.services.web_research.artifact_store import byte_page
    from app.models.web_research_models import WebResearchError
    original = '中文🙂abcdef'.encode()
    offset, result = 0, ''
    while offset is not None:
        page = byte_page(original, offset, 5)
        result += page['content']
        offset = page['next_offset']
    assert result == original.decode()
    with pytest.raises(WebResearchError):
        byte_page(original, 1, 5)


@pytest.mark.asyncio
async def test_artifact_ownership_tombstone_and_hash(tmp_path):
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.research_db_models import ResearchArtifact
    from app.services.web_research.artifact_store import ArtifactStore
    from app.models.web_research_models import WebResearchError
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(ResearchArtifact.__table__.create)
    store = ArtifactStore(tmp_path, async_sessionmaker(engine, expire_on_commit=False), quota=30)
    row = await store.write('page', b'hello', {'run_id': 'r', 'project_id': 'a', 'sources': []})
    assert (await store.read(row.id, 'a'))['content'] == 'hello'
    with pytest.raises(WebResearchError):
        await store.read(row.id, 'b')
    (tmp_path / row.relative_path).write_bytes(b'other')
    with pytest.raises(WebResearchError, match='artifact_expired'):
        await store.read(row.id, 'a')
    await engine.dispose()


@pytest.mark.asyncio
async def test_database_init_twice_adds_artifacts_without_mutating_project(tmp_path, monkeypatch):
    import uuid
    from sqlalchemy import select, inspect
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.db_models import VideoProject
    from app.constants import LOCAL_OWNER_ID
    import app.database as database
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'existing.db'))
    async with engine.begin() as connection:
        await connection.run_sync(VideoProject.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    identifier = uuid.uuid4()
    original = {'title': '原项目', 'tracks': [{'id': 'keep', 'clips': []}]}
    async with factory() as session:
        session.add(VideoProject(id=identifier, user_id=LOCAL_OWNER_ID,
                                 name='原项目', project_data=original))
        await session.commit()
    monkeypatch.setattr(database, 'engine', engine)
    await database.init_db()
    await database.init_db()
    async with factory() as session:
        rows = (await session.execute(select(VideoProject))).scalars().all()
        assert len(rows) == 1 and rows[0].project_data == original
    async with engine.begin() as connection:
        tables = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
        assert 'research_artifacts' in tables
    await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_quota_with_pinned_reader_does_not_overcommit(tmp_path):
    import asyncio
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.research_db_models import ResearchArtifact
    from app.services.web_research.artifact_store import ArtifactStore
    from app.models.web_research_models import WebResearchError
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'artifacts.db'))
    async with engine.begin() as connection:
        await connection.run_sync(ResearchArtifact.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    store = ArtifactStore(tmp_path / 'private', factory, quota=12)
    pinned = await store.write('page', b'123456', {'run_id': 'r'})
    async with store.pinned(pinned.id, None):
        results = await asyncio.gather(*[
            store.write('page', b'abcdef', {'run_id': 'r'}) for _ in range(2)],
            return_exceptions=True)
        assert all(not isinstance(r, Exception) or isinstance(r, WebResearchError)
                   for r in results)
        assert (store.root / pinned.relative_path).is_file()
    async with factory() as session:
        rows = (await session.execute(select(ResearchArtifact).where(ResearchArtifact.state == 'ready'))).scalars()
        assert sum(r.byte_length for r in rows) <= 12
    assert store.reserved == 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_expiration_defers_unlink_until_last_reader_releases(tmp_path):
    from datetime import timedelta
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.research_db_models import ResearchArtifact
    from app.services.web_research.artifact_store import ArtifactStore, utcnow
    from app.models.web_research_models import WebResearchError
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(ResearchArtifact.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    store = ArtifactStore(tmp_path, factory)
    row = await store.write('page', b'hello', {'run_id': 'r', 'project_id': None})
    async with store.pinned(row.id, None):
        async with factory() as session:
            record = await session.get(ResearchArtifact, row.id)
            record.expires_at = utcnow() - timedelta(seconds=1)
            await session.commit()
        with pytest.raises(WebResearchError, match='artifact_expired'):
            await store.read(row.id, None)
        assert (tmp_path / row.relative_path).is_file()
    assert not (tmp_path / row.relative_path).exists()
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('cancel_count', [1, 2])
async def test_cancel_after_durable_commit_preserves_file_and_releases_quota(
        tmp_path, cancel_count):
    import asyncio
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.research_db_models import ResearchArtifact
    from app.services.web_research.artifact_store import ArtifactStore

    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(ResearchArtifact.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    committed, release = asyncio.Event(), asyncio.Event()

    class DelayedCommit:
        async def __aenter__(self):
            self.session = factory()
            await self.session.__aenter__()
            original = self.session.commit

            async def commit():
                await original()
                committed.set()
                await release.wait()

            self.session.commit = commit
            return self.session

        async def __aexit__(self, *args):
            return await self.session.__aexit__(*args)

    store = ArtifactStore(tmp_path, DelayedCommit)
    write = asyncio.create_task(store.write('page', b'confirmed', {'run_id': 'r'}))
    try:
        await asyncio.wait_for(committed.wait(), 2)
        for _ in range(cancel_count):
            write.cancel()
            await asyncio.sleep(0)
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await write
        async with factory() as session:
            row = (await session.execute(select(ResearchArtifact))).scalar_one()
        assert row.state == 'ready'
        assert (tmp_path / row.relative_path).read_bytes() == b'confirmed'
        assert store.reserved == 0
    finally:
        release.set()
        await engine.dispose()


@pytest.mark.asyncio
async def test_storage_write_failure_maps_to_507_and_leaves_no_part_file(
        tmp_path, monkeypatch):
    """D-16：磁盘/权限失败显式映射 507，且不留下半成品文件。"""
    import pathlib
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.research_db_models import ResearchArtifact
    from app.models.web_research_models import WebResearchError
    from app.services.web_research.artifact_store import ArtifactStore
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(ResearchArtifact.__table__.create)
    store = ArtifactStore(tmp_path, async_sessionmaker(engine, expire_on_commit=False))
    def denied(self, data):
        raise OSError(28, 'No space left on device')
    monkeypatch.setattr(pathlib.Path, 'write_bytes', denied)
    with pytest.raises(WebResearchError) as error:
        await store.write('page', b'body', {'run_id': 'r', 'project_id': None})
    assert error.value.error_code == 'cache_commit_failed'
    assert error.value.status_code == 507
    assert error.value.failure_class == 'internal'
    assert [path.name for path in tmp_path.iterdir()] == []
    assert store.reserved == 0
    await engine.dispose()
