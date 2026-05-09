"""Tests for the frame_pack_service used behind /api/frame-pack/*.

Exercises the service-layer surface end-to-end against an in-memory SQLite
DB and a per-test storage root. The HTTP layer (``frame_pack_router``) is
auth-gated and project-write gated; the service tests below cover the
non-auth pieces (manifest validation, ownership row, on-disk layout,
cross-project access, deletion sweep).
"""
from __future__ import annotations

import asyncio
import io
import json
import os

import pytest
from fastapi import HTTPException
from PIL import Image

from app.services import frame_pack_service, pack_ownership_service


PROJECT_A = "00000000-0000-0000-0000-00000000aaaa"
PROJECT_B = "00000000-0000-0000-0000-00000000bbbb"
USER_1 = "11111111-1111-1111-1111-111111111111"
USER_2 = "22222222-2222-2222-2222-222222222222"


def _jpeg_bytes(seed: int = 0) -> bytes:
    img = Image.new("RGB", (8, 8), color=(seed & 0xFF, 100, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def _frame_dict(index: int, ts: float) -> dict:
    return {
        "index": index,
        "timestamp_sec": ts,
        "width": 8,
        "height": 8,
        "data": _jpeg_bytes(seed=index),
    }


def _patch_storage_root(monkeypatch, storage_root) -> None:
    monkeypatch.setattr(
        frame_pack_service.settings.storage,
        "root",
        str(storage_root),
        raising=False,
    )


@pytest.mark.asyncio
async def test_create_pack_writes_disk_and_ownership(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)

    pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="mat-1",
        source_material_name="clip.mp4",
        source_duration_sec=10.0,
        frames=[_frame_dict(1, 1.0), _frame_dict(2, 2.0), _frame_dict(3, 3.0)],
    )
    assert pack["pack_type"] == "frame"
    assert pack["frame_count"] == 3
    assert pack["source_material_id"] == "mat-1"

    # Ownership row written
    row = await pack_ownership_service.get(db_session, pack["pack_id"])
    assert row is not None
    assert row.project_id == PROJECT_A
    assert row.user_id == USER_1
    assert row.pack_type == "frame"

    # On-disk dir exists with metadata.json + frame files
    pack_dir = frame_pack_service._pack_dir(pack["pack_id"])
    assert pack_dir is not None
    assert os.path.isfile(os.path.join(pack_dir, "metadata.json"))
    assert os.path.isfile(os.path.join(pack_dir, "frame_001.jpg"))
    assert os.path.isfile(os.path.join(pack_dir, "frame_003.jpg"))
    # original.jpg copy exists for the card thumbnail
    assert os.path.isfile(os.path.join(pack_dir, "original.jpg"))


@pytest.mark.asyncio
async def test_create_pack_rejects_over_cap(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)
    # Force a tiny cap so the test stays fast.
    monkeypatch.setitem(frame_pack_service._config(), "max_frames_per_pack", 2)
    # _config_cache is now seeded; clear semaphore so the next run uses the new cap.
    frame_pack_service._create_semaphore = None

    with pytest.raises(ValueError) as excinfo:
        await frame_pack_service.create_pack(
            db=db_session,
            user_id=USER_1,
            project_id=PROJECT_A,
            source_material_id="m",
            source_material_name="m",
            source_duration_sec=1.0,
            frames=[_frame_dict(i, float(i)) for i in range(1, 4)],
        )
    assert "frame_count_exceeds_limit" in str(excinfo.value)


@pytest.mark.asyncio
async def test_list_packs_filters_by_project(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)

    a_pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m1",
        source_material_name="m1",
        source_duration_sec=1.0,
        frames=[_frame_dict(1, 1.0)],
    )
    b_pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_B,
        source_material_id="m2",
        source_material_name="m2",
        source_duration_sec=1.0,
        frames=[_frame_dict(1, 1.0)],
    )

    a_listed = await frame_pack_service.list_packs_for_project(
        db=db_session, project_id=PROJECT_A, user_id=USER_1
    )
    assert {p["pack_id"] for p in a_listed} == {a_pack["pack_id"]}

    b_listed = await frame_pack_service.list_packs_for_project(
        db=db_session, project_id=PROJECT_B, user_id=USER_1
    )
    assert {p["pack_id"] for p in b_listed} == {b_pack["pack_id"]}


@pytest.mark.asyncio
async def test_assert_pack_owned_other_user_404s(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)

    pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=1.0,
        frames=[_frame_dict(1, 1.0)],
    )
    # Other user can't see it
    with pytest.raises(HTTPException) as excinfo:
        await frame_pack_service.assert_pack_owned(
            db=db_session, pack_id=pack["pack_id"], user_id=USER_2
        )
    assert excinfo.value.status_code == 404
    # Owner can
    bound = await frame_pack_service.assert_pack_owned(
        db=db_session, pack_id=pack["pack_id"], user_id=USER_1
    )
    assert bound == PROJECT_A


@pytest.mark.asyncio
async def test_delete_pack_removes_disk_and_row(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)

    pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=1.0,
        frames=[_frame_dict(1, 1.0), _frame_dict(2, 2.0)],
    )
    pack_id = pack["pack_id"]
    pack_dir = frame_pack_service._pack_dir(pack_id)
    assert pack_dir and os.path.isdir(pack_dir)

    await frame_pack_service.delete_pack(pack_id, db=db_session)

    assert frame_pack_service._pack_dir(pack_id) is None
    row = await pack_ownership_service.get(db_session, pack_id)
    assert row is None

    listed = await frame_pack_service.list_packs_for_project(
        db=db_session, project_id=PROJECT_A, user_id=USER_1
    )
    assert listed == []


@pytest.mark.asyncio
async def test_append_success(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)
    frame_pack_service._pack_locks.clear()

    base = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=10.0,
        frames=[_frame_dict(1, 1.0), _frame_dict(2, 2.0), _frame_dict(3, 3.0)],
    )
    pack_id = base["pack_id"]

    appended = await frame_pack_service.append_frames(
        db=db_session,
        user_id=USER_1,
        pack_id=pack_id,
        frames=[_frame_dict(1, 4.0), _frame_dict(2, 5.0)],
    )
    assert appended["frame_count"] == 5
    timestamps = [f["timestamp_sec"] for f in appended["frames"]]
    assert timestamps == sorted(timestamps)

    pack_dir = frame_pack_service._pack_dir(pack_id)
    assert pack_dir is not None
    assert os.path.isfile(os.path.join(pack_dir, "frame_004.jpg"))
    assert os.path.isfile(os.path.join(pack_dir, "frame_005.jpg"))


@pytest.mark.asyncio
async def test_append_cap_exceeded(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)
    frame_pack_service._pack_locks.clear()
    monkeypatch.setitem(frame_pack_service._config(), "max_frames_per_pack", 4)
    frame_pack_service._create_semaphore = None

    base = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=10.0,
        frames=[_frame_dict(i, float(i)) for i in range(1, 4)],
    )
    pack_id = base["pack_id"]
    pack_dir = frame_pack_service._pack_dir(pack_id)
    files_before = set(os.listdir(pack_dir))

    with pytest.raises(ValueError) as excinfo:
        await frame_pack_service.append_frames(
            db=db_session,
            user_id=USER_1,
            pack_id=pack_id,
            frames=[_frame_dict(1, 5.0), _frame_dict(2, 6.0)],
        )
    assert "frame_count_exceeds_limit" in str(excinfo.value)
    # No leftover frame files from the failed attempt.
    assert set(os.listdir(pack_dir)) == files_before


@pytest.mark.asyncio
async def test_append_partial_failure_rollback(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)
    frame_pack_service._pack_locks.clear()

    base = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=10.0,
        frames=[_frame_dict(1, 1.0)],
    )
    pack_id = base["pack_id"]
    pack_dir = frame_pack_service._pack_dir(pack_id)
    metadata_path = os.path.join(pack_dir, "metadata.json")
    with open(metadata_path, "r", encoding="utf-8") as f:
        metadata_before = f.read()
    files_before = set(os.listdir(pack_dir))

    # Patch aiofiles.open so writing the SECOND frame raises.
    real_open = frame_pack_service.aiofiles.open
    call = {"n": 0}

    def patched_open(*args, **kwargs):
        # Only intercept binary writes (frame files), not metadata reads/writes.
        mode = kwargs.get("mode") or (args[1] if len(args) > 1 else "r")
        if "wb" in str(mode):
            call["n"] += 1
            if call["n"] == 2:
                raise IOError("simulated disk failure")
        return real_open(*args, **kwargs)

    monkeypatch.setattr(frame_pack_service.aiofiles, "open", patched_open)

    with pytest.raises(IOError):
        await frame_pack_service.append_frames(
            db=db_session,
            user_id=USER_1,
            pack_id=pack_id,
            frames=[_frame_dict(1, 2.0), _frame_dict(2, 3.0)],
        )

    # Rollback: metadata restored, no new frame files left over.
    with open(metadata_path, "r", encoding="utf-8") as f:
        metadata_after = f.read()
    assert metadata_after == metadata_before
    assert set(os.listdir(pack_dir)) == files_before


@pytest.mark.asyncio
async def test_delete_frame_success(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)
    frame_pack_service._pack_locks.clear()

    pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=10.0,
        frames=[_frame_dict(i, float(i)) for i in range(1, 6)],
    )
    pack_id = pack["pack_id"]
    updated = await frame_pack_service.delete_frame(
        db=db_session, pack_id=pack_id, frame_index=3
    )
    assert updated is not None
    assert updated["frame_count"] == 4
    indices = [f["index"] for f in updated["frames"]]
    assert 3 not in indices
    assert sorted(indices) == [1, 2, 4, 5]

    pack_dir = frame_pack_service._pack_dir(pack_id)
    assert pack_dir is not None
    assert not os.path.isfile(os.path.join(pack_dir, "frame_003.jpg"))
    assert os.path.isfile(os.path.join(pack_dir, "frame_001.jpg"))
    assert os.path.isfile(os.path.join(pack_dir, "frame_005.jpg"))


@pytest.mark.asyncio
async def test_delete_frame_not_found(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)
    frame_pack_service._pack_locks.clear()

    pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=10.0,
        frames=[_frame_dict(1, 1.0), _frame_dict(2, 2.0)],
    )
    with pytest.raises(HTTPException) as excinfo:
        await frame_pack_service.delete_frame(
            db=db_session, pack_id=pack["pack_id"], frame_index=99
        )
    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_last_frame_drops_pack(db_session, storage_root, monkeypatch):
    _patch_storage_root(monkeypatch, storage_root)
    frame_pack_service._pack_locks.clear()

    pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=10.0,
        frames=[_frame_dict(1, 1.0)],
    )
    pack_id = pack["pack_id"]

    result = await frame_pack_service.delete_frame(
        db=db_session, pack_id=pack_id, frame_index=1
    )
    assert result is None
    assert frame_pack_service._pack_dir(pack_id) is None
    row = await pack_ownership_service.get(db_session, pack_id)
    assert row is None


@pytest.mark.asyncio
async def test_append_concurrent_same_pack(db_session, storage_root, monkeypatch):
    """Concurrent appends to the same pack must not lose frames or
    produce duplicate filenames — guarded by ``_pack_locks``."""
    _patch_storage_root(monkeypatch, storage_root)
    frame_pack_service._pack_locks.clear()

    base = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=10.0,
        frames=[_frame_dict(1, 1.0)],
    )
    pack_id = base["pack_id"]
    base_count = base["frame_count"]
    delta = 2

    async def one_append(seed: float):
        return await frame_pack_service.append_frames(
            db=db_session,
            user_id=USER_1,
            pack_id=pack_id,
            frames=[_frame_dict(1, seed + 0.1), _frame_dict(2, seed + 0.2)],
        )

    results = await asyncio.gather(one_append(10.0), one_append(20.0))
    final_count = max(r["frame_count"] for r in results)
    assert final_count == base_count + 2 * delta

    pack_dir = frame_pack_service._pack_dir(pack_id)
    metadata_path = os.path.join(pack_dir, "metadata.json")
    with open(metadata_path, "r", encoding="utf-8") as f:
        metadata = json.loads(f.read())
    filenames = [fr["filename"] for fr in metadata["frames"]]
    assert len(filenames) == len(set(filenames)), f"duplicate filenames: {filenames}"
    assert metadata["frame_count"] == base_count + 2 * delta


@pytest.mark.asyncio
async def test_get_pack_uses_jpg_url_via_file_ext(db_session, storage_root, monkeypatch):
    """grid_pack_service._pack_dict_from_metadata must honour ``file_ext``
    so frame-pack URLs resolve to .jpg, not the legacy .png fallback."""
    _patch_storage_root(monkeypatch, storage_root)

    pack = await frame_pack_service.create_pack(
        db=db_session,
        user_id=USER_1,
        project_id=PROJECT_A,
        source_material_id="m",
        source_material_name="m",
        source_duration_sec=1.0,
        frames=[_frame_dict(1, 1.0)],
    )
    fetched = await frame_pack_service.get_pack(pack["pack_id"])
    # original.jpg, not original.png
    assert fetched["original_image_url"].endswith("/original.jpg")
    assert all(f["url"].endswith(".jpg") for f in fetched["frames"])
