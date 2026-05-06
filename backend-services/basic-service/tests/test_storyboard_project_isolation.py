"""Project-isolation tests for storyboard packs.

These exercise the service-layer surface introduced by
docs/plans/storyboard-pack-project-isolation/spec.md (v2):

  - ``list_packs`` only returns packs owned by the (project, user) pair.
  - Cross-project ``_assert_pack_owned`` raises 404.
  - ``cleanup_pack_storage`` removes pack directories.
  - Legacy packs (no ownership row) are invisible to the per-project list
    but remain readable via ``get_pack`` (direct path access is preserved).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.models.storyboard_models import (
    StoryboardCreateFromShotsRequest,
    StoryboardShotInput,
)
from app.services import pack_ownership_service, storyboard_service


PROJECT_A = "00000000-0000-0000-0000-00000000aaaa"
PROJECT_B = "00000000-0000-0000-0000-00000000bbbb"
USER_1 = "11111111-1111-1111-1111-111111111111"
USER_2 = "22222222-2222-2222-2222-222222222222"


def _png_data_uri() -> str:
    import base64
    import io

    from PIL import Image

    img = Image.new("RGB", (4, 4), color=(120, 200, 50))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


async def _make_pack(*, project_id: str, user_id: str, db, storage_root) -> str:
    """Helper: create a script-bound pack via the service and return pack_id."""
    req = StoryboardCreateFromShotsRequest(
        project_id=project_id,
        title="iso pack",
        aspect_ratio="1:1",
        shots=[
            StoryboardShotInput(
                shot_id="s1",
                script="x",
                generated_image_url=_png_data_uri(),
            )
        ],
    )
    pack = await storyboard_service.create_pack_from_shots(
        req, db=db, user_id=user_id
    )
    return pack.pack_id


@pytest.mark.asyncio
async def test_list_packs_filters_by_project(db_session, storage_root, monkeypatch):
    monkeypatch.setattr(
        storyboard_service.settings.storage,
        "root",
        str(storage_root),
        raising=False,
    )

    a_id = await _make_pack(
        project_id=PROJECT_A, user_id=USER_1, db=db_session, storage_root=storage_root
    )
    b_id = await _make_pack(
        project_id=PROJECT_B, user_id=USER_1, db=db_session, storage_root=storage_root
    )

    a_packs = await storyboard_service.list_packs(
        db=db_session, project_id=PROJECT_A, user_id=USER_1
    )
    assert {p.pack_id for p in a_packs} == {a_id}
    b_packs = await storyboard_service.list_packs(
        db=db_session, project_id=PROJECT_B, user_id=USER_1
    )
    assert {p.pack_id for p in b_packs} == {b_id}


@pytest.mark.asyncio
async def test_list_packs_filters_by_user(db_session, storage_root, monkeypatch):
    monkeypatch.setattr(
        storyboard_service.settings.storage,
        "root",
        str(storage_root),
        raising=False,
    )

    pack_id = await _make_pack(
        project_id=PROJECT_A, user_id=USER_1, db=db_session, storage_root=storage_root
    )
    # Different user looking at the same project sees nothing — auth filter.
    other = await storyboard_service.list_packs(
        db=db_session, project_id=PROJECT_A, user_id=USER_2
    )
    assert other == []
    # Owner still sees the pack
    own = await storyboard_service.list_packs(
        db=db_session, project_id=PROJECT_A, user_id=USER_1
    )
    assert {p.pack_id for p in own} == {pack_id}


@pytest.mark.asyncio
async def test_assert_pack_owned_raises_404_for_other_user(
    db_session, storage_root, monkeypatch
):
    monkeypatch.setattr(
        storyboard_service.settings.storage,
        "root",
        str(storage_root),
        raising=False,
    )
    pack_id = await _make_pack(
        project_id=PROJECT_A, user_id=USER_1, db=db_session, storage_root=storage_root
    )

    bound = await storyboard_service._assert_pack_owned(
        db=db_session, pack_id=pack_id, user_id=USER_1
    )
    assert bound == PROJECT_A

    with pytest.raises(HTTPException) as excinfo:
        await storyboard_service._assert_pack_owned(
            db=db_session, pack_id=pack_id, user_id=USER_2
        )
    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "STORYBOARD_PACK_NOT_FOUND"


@pytest.mark.asyncio
async def test_assert_pack_owned_404_for_unknown_pack(db_session):
    with pytest.raises(HTTPException) as excinfo:
        await storyboard_service._assert_pack_owned(
            db=db_session, pack_id="missing-pack-id", user_id=USER_1
        )
    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_cleanup_pack_storage_removes_directory(
    db_session, storage_root, monkeypatch
):
    monkeypatch.setattr(
        storyboard_service.settings.storage,
        "root",
        str(storage_root),
        raising=False,
    )
    pack_id = await _make_pack(
        project_id=PROJECT_A, user_id=USER_1, db=db_session, storage_root=storage_root
    )
    pack_dir = storyboard_service._pack_dir(pack_id)
    assert pack_dir is not None
    assert os.path.isdir(pack_dir)

    await storyboard_service.cleanup_pack_storage([pack_id])
    assert not os.path.isdir(pack_dir)


@pytest.mark.asyncio
async def test_legacy_pack_without_ownership_row_is_hidden(
    db_session, storage_root, monkeypatch
):
    """Pack with metadata.json but no ``storyboard_packs`` row stays invisible."""
    monkeypatch.setattr(
        storyboard_service.settings.storage,
        "root",
        str(storage_root),
        raising=False,
    )
    # Simulate a pre-feature pack on disk with no ownership row.
    base = storyboard_service._storyboard_base_dir()
    legacy_dir = Path(base) / "20240101" / "legacy_pack_id_xx"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    (legacy_dir / "metadata.json").write_text(
        json.dumps(
            {
                "pack_id": "legacy_pack_id_xx",
                "prompt": "legacy",
                "grid_size": "2x2",
                "aspect_ratio": "1:1",
                "frame_count": 0,
                "created_at": "2024-01-01T00:00:00Z",
                "frames": [],
            }
        ),
        encoding="utf-8",
    )

    own = await storyboard_service.list_packs(
        db=db_session, project_id=PROJECT_A, user_id=USER_1
    )
    assert all(p.pack_id != "legacy_pack_id_xx" for p in own)


@pytest.mark.asyncio
async def test_pack_ownership_service_upsert_and_delete(db_session):
    row = await pack_ownership_service.upsert(
        db=db_session,
        pack_id="pk-xyz",
        project_id=PROJECT_A,
        user_id=USER_1,
    )
    assert row.project_id == PROJECT_A
    fetched = await pack_ownership_service.get(db_session, "pk-xyz")
    assert fetched is not None
    assert fetched.user_id == USER_1

    # Re-upsert is idempotent and refreshes the binding.
    await pack_ownership_service.upsert(
        db=db_session,
        pack_id="pk-xyz",
        project_id=PROJECT_B,
        user_id=USER_1,
    )
    refetched = await pack_ownership_service.get(db_session, "pk-xyz")
    assert refetched is not None
    assert refetched.project_id == PROJECT_B

    deleted = await pack_ownership_service.delete_by_pack(db_session, "pk-xyz")
    assert deleted is True
    assert await pack_ownership_service.get(db_session, "pk-xyz") is None


@pytest.mark.asyncio
async def test_pack_ownership_collect_and_delete_by_project(db_session):
    await pack_ownership_service.upsert(
        db=db_session, pack_id="p1", project_id=PROJECT_A, user_id=USER_1
    )
    await pack_ownership_service.upsert(
        db=db_session, pack_id="p2", project_id=PROJECT_A, user_id=USER_1
    )
    await pack_ownership_service.upsert(
        db=db_session, pack_id="p3", project_id=PROJECT_B, user_id=USER_1
    )

    pack_ids = await pack_ownership_service.collect_pack_ids_for_project(
        db_session, PROJECT_A
    )
    assert sorted(pack_ids) == ["p1", "p2"]

    n = await pack_ownership_service.delete_rows_by_project(db_session, PROJECT_A)
    assert n == 2
    # Only the unrelated project_b row remains.
    remaining_b = await pack_ownership_service.collect_pack_ids_for_project(
        db_session, PROJECT_B
    )
    assert remaining_b == ["p3"]
