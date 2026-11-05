"""取消不得删除已提交的研究素材文件。"""

import asyncio
import hashlib
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine,
)

from app.models.db_models import CachedMaterial
from app.services.material_download_service import MaterialDownloadService


@pytest.mark.asyncio
@pytest.mark.parametrize('source_kind', ['web', 'workspace'])
@pytest.mark.parametrize('pause_before_commit', [False, True])
async def test_cancellation_after_commit_keeps_ready_cache_file(tmp_path, source_kind, pause_before_commit):
    committed = asyncio.Event()
    release = asyncio.Event()

    class PausedCommitSession(AsyncSession):
        async def commit(self):
            if not pause_before_commit:
                await super().commit()
            committed.set()
            await release.wait()
            if pause_before_commit:
                await super().commit()

    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'cache.db'))
    try:
        async with engine.begin() as connection:
            await connection.run_sync(CachedMaterial.__table__.create)
        service = MaterialDownloadService.__new__(MaterialDownloadService)
        service.cache_dir = tmp_path / 'cache'
        service._research_locks = {}
        service._session_factory = async_sessionmaker(
            engine, class_=PausedCommitSession, expire_on_commit=False)
        source = tmp_path / 'image.png'
        source.write_bytes(b'validated-image-content')
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        call = (service._store_workspace_file(source, digest, 'png')
                if source_kind == 'workspace' else service._store_research(
                    source, digest, 'png', 'https://source.example/image'))
        task = asyncio.create_task(call)
        await asyncio.wait_for(committed.wait(), 2)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

        async with async_sessionmaker(engine)() as session:
            row = (await session.execute(select(CachedMaterial))).scalar_one()
            assert row.status == 'ready'
            assert Path(row.local_path).read_bytes() == source.read_bytes()
        assert service._research_locks == {}
        assert not list(service.cache_dir.rglob('*.part'))
    finally:
        release.set()
        await engine.dispose()


@pytest.mark.asyncio
async def test_workspace_aliases_keep_one_real_sqlite_record(tmp_path):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    try:
        async with engine.begin() as connection:
            await connection.run_sync(CachedMaterial.__table__.create)
        service = MaterialDownloadService.__new__(MaterialDownloadService)
        service.cache_dir = tmp_path / 'cache'
        service._research_locks = {}
        service._session_factory = async_sessionmaker(engine, expire_on_commit=False)
        source = tmp_path / 'image.jpg'
        from PIL import Image
        Image.new('RGB', (2, 2)).save(source)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        first, second = await asyncio.gather(
            service._store_workspace_file(source, digest, 'jpg'),
            service._store_workspace_file(source, digest, 'jpeg'))
        assert first['record_id'] == second['record_id']
        assert first['local_url'] == second['local_url']
        assert [first['reused'], second['reused']] == [False, True]
        async with service._session_factory() as session:
            row = (await session.execute(select(CachedMaterial))).scalar_one()
            assert row.source_url == first['local_url']
            cached = Path(row.local_path)
            assert row.source_url.endswith('/' + cached.name)
            assert cached.read_bytes() == source.read_bytes()
        assert len(list((service.cache_dir / 'workspace').iterdir())) == 1
        # A different media format must not reuse this ID with a new type or
        # a URL whose suffix contradicts the import response.
        from app.models.web_research_models import WebResearchError
        with pytest.raises(WebResearchError, match='unsupported_media_type'):
            await service._store_workspace_file(source, digest, 'png')
        assert cached.read_bytes() == source.read_bytes()
        async with service._session_factory() as session:
            row = (await session.execute(select(CachedMaterial))).scalar_one()
            row.source_url = '/api/storage/files/cached_materials/workspace/obsolete.jpg'
            await session.commit()
        await service._store_workspace_file(source, digest, 'jpeg')
        async with service._session_factory() as session:
            row = (await session.execute(select(CachedMaterial))).scalar_one()
            assert row.source_url == first['local_url']
        cached.unlink()
        repaired = await service._store_workspace_file(source, digest, 'jpeg')
        assert repaired['local_url'] == first['local_url']
        assert repaired['record_id'] == first['record_id']
        assert cached.is_file()
        assert service._research_locks == {}
    finally:
        await engine.dispose()
