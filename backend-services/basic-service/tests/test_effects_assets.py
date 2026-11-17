"""Real file snapshots, ownership, GC retention and delayed-import deletion."""

import asyncio
import struct
import threading
import zlib
from uuid import UUID

import pytest
from PIL import Image
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.db_models import VideoProject
from app.models.effects_db_models import EffectAsset
from app.models.effects_models import AttachInputRequest, EffectError
from app.services.effects import asset_service as assets
from app.services.derived_gc_service import DerivedGcService
from tests.test_effects_jobs import create_project


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(8000, 6000), (20000, 20000)])
async def test_oversized_image_header_returns_limit_error_without_publishing(
        db_session, monkeypatch, tmp_path, size):
    project_id = await create_project(db_session, monkeypatch, tmp_path)

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data)))

    # Only a header is needed: reject dimensions before decoding any pixels.
    header = struct.pack(">IIBBBBB", *size, 8, 2, 0, 0, 0)
    (tmp_path / "oversized.png").write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
        + chunk(b"IDAT", b"") + chunk(b"IEND", b""))
    with pytest.raises(EffectError) as error:
        await assets.attach_input(db_session, project_id,
            AttachInputRequest(source_ref="/api/storage/files/oversized.png"))
    assert error.value.code == "EFFECT_INPUT_TOO_LARGE"
    assert error.value.status == 413
    assert await db_session.scalar(select(func.count()).select_from(
        EffectAsset)) == 0
    assert not list((tmp_path / "effects/.staging").glob("*"))


@pytest.mark.asyncio
async def test_real_image_snapshot_deduplicates_and_survives_source_deletion(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    source = tmp_path / "original.jpg"
    Image.new("RGB", (96, 64), "orange").save(source)
    payload = AttachInputRequest(source_ref="/api/storage/files/original.jpg")
    first, replay = await assets.attach_input(db_session, project_id, payload)
    assert not replay and first["width"] == 96 and first["mime"] == "image/jpeg"
    second, replay = await assets.attach_input(db_session, project_id, payload)
    assert replay and second["asset_id"] == first["asset_id"]
    source.unlink()
    row = await assets.get_asset(db_session, project_id, first["asset_id"])
    assert assets.asset_path(row).is_file()
    result = await DerivedGcService(root=str(tmp_path)).delete_material(
        "effect-material:" + first["asset_id"], source_path=row.storage_key)
    assert result["retained"] == "effects_project_owned"
    assert assets.asset_path(row).is_file()


@pytest.mark.asyncio
async def test_missing_kind_cross_project_and_remote_boundaries(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    for reference in ("https://example.com/a.png", "file:///a.png",
                      "/api/storage/files/../escape.png", "C:/a.png"):
        with pytest.raises(EffectError) as error:
            await assets.attach_input(db_session, project_id,
                AttachInputRequest(source_ref=reference))
        assert error.value.code == "EFFECT_INPUT_NOT_LOCAL"
    source = tmp_path / "valid.png"
    Image.new("RGB", (80, 80)).save(source)
    created, _ = await assets.attach_input(db_session, project_id,
        AttachInputRequest(source_ref="/api/storage/files/valid.png"))
    other = await create_project(db_session, monkeypatch, tmp_path)
    with pytest.raises(EffectError) as error:
        await assets.get_asset(db_session, other, created["asset_id"])
    assert error.value.status == 404


@pytest.mark.asyncio
async def test_project_deleted_during_staging_never_creates_formal_assets(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    Image.new("RGB", (80, 80)).save(tmp_path / "valid.png")
    copied, release = threading.Event(), threading.Event()
    original = assets._copy_staging

    def delayed_copy(*arguments):
        result = original(*arguments)
        copied.set()
        assert release.wait(5)
        return result

    monkeypatch.setattr(assets, "_copy_staging", delayed_copy)
    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def attach():
        async with factory() as db:
            return await assets.attach_input(db, project_id,
                AttachInputRequest(source_ref="/api/storage/files/valid.png"))

    task = asyncio.create_task(attach())
    try:
        assert await asyncio.to_thread(copied.wait, 5)
        await db_session.execute(delete(VideoProject).where(
            VideoProject.id == UUID(project_id)))
        await db_session.commit()
        release.set()
        with pytest.raises(EffectError) as error:
            await task
        assert error.value.status == 404
        assert not assets.project_directory(project_id).exists()
        assert await db_session.scalar(select(func.count()).select_from(
            EffectAsset)) == 0
        assert not list((tmp_path / "effects/.staging").glob("*"))
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
