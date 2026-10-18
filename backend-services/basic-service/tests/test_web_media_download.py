import pytest


def test_audio_only_mp4_is_audio_and_invalid_duration_rejected():
    from app.services.web_research.media_worker import probe_metadata
    from app.models.web_research_models import WebResearchError
    assert probe_metadata({'format': {'duration': '4', 'format_name': 'mov,mp4,m4a'}, 'streams': [{'codec_type': 'audio'}]})['type'] == 'audio'
    with pytest.raises(WebResearchError):
        probe_metadata({'format': {'duration': 'NaN'}, 'streams': [{'codec_type': 'video'}]})


@pytest.mark.asyncio
async def test_identical_downloads_commit_one_record_and_final_file(tmp_path):
    import asyncio
    import hashlib
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models.db_models import CachedMaterial
    from app.services.material_download_service import MaterialDownloadService
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'cache.db'))
    async with engine.begin() as connection:
        await connection.run_sync(CachedMaterial.__table__.create)
    service = MaterialDownloadService.__new__(MaterialDownloadService)
    service.cache_dir = tmp_path / 'cache'
    service._session_factory = async_sessionmaker(engine, expire_on_commit=False)
    service._research_locks = {}
    source = tmp_path / 'decoded.png'
    source.write_bytes(b'validated-test-pixels')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    first, second = await asyncio.gather(
        service._store_research(source, digest, 'png', 'https://one.example/'),
        service._store_research(source, digest, 'png', 'https://two.example/'))
    assert first['local_url'] == second['local_url']
    assert sorted([first['reused'], second['reused']]) == [False, True]
    async with service._session_factory() as session:
        rows = (await session.execute(select(CachedMaterial))).scalars().all()
        assert len(rows) == 1 and rows[0].status == 'ready'
    assert len(list((service.cache_dir / 'web').iterdir())) == 1
    assert service._research_locks == {}
    await engine.dispose()


@pytest.mark.asyncio
async def test_database_failure_removes_only_uncommitted_new_file(tmp_path):
    import hashlib
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.models.db_models import CachedMaterial
    from app.models.web_research_models import WebResearchError
    from app.services.material_download_service import MaterialDownloadService
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'cache.db'))
    async with engine.begin() as connection:
        await connection.run_sync(CachedMaterial.__table__.create)
    class FailingSession(AsyncSession):
        async def commit(self):
            raise RuntimeError('database is unavailable')
    service = MaterialDownloadService.__new__(MaterialDownloadService)
    service.cache_dir = tmp_path / 'cache'
    service._session_factory = async_sessionmaker(engine, class_=FailingSession, expire_on_commit=False)
    service._research_locks = {}
    source = tmp_path / 'decoded.png'
    source.write_bytes(b'validated-test-pixels')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    with pytest.raises(WebResearchError, match='cache_commit_failed'):
        await service._store_research(source, digest, 'png', 'https://one.example/')
    assert list((service.cache_dir / 'web').iterdir()) == []
    assert source.is_file()
    await engine.dispose()


@pytest.mark.asyncio
async def test_cancelling_media_worker_reaps_child_process():
    import asyncio
    import sys
    from app.services.web_research.media_worker import run_process
    task = asyncio.create_task(run_process([sys.executable, '-c', 'import time; time.sleep(30)'], 30))
    await asyncio.sleep(.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 2)
