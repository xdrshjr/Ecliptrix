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
async def test_cancellation_after_commit_keeps_ready_cache_file(tmp_path):
    committed = asyncio.Event()
    release = asyncio.Event()

    class PausedCommitSession(AsyncSession):
        async def commit(self):
            await super().commit()
            committed.set()
            await release.wait()

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
        task = asyncio.create_task(service._store_research(
            source, digest, 'png', 'https://source.example/image'))
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
