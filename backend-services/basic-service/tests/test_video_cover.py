"""
Service-layer tests for the per-project Video Cover feature.

Run against the in-memory SQLite fixture from ``conftest.py``. The same upsert
code path runs under PostgreSQL in production — the portable two-step
implementation in ``video_cover_service.upsert`` is what makes a single test
suite enough to exercise both branches (P1-1).
"""

from __future__ import annotations

from pathlib import Path
from typing import AsyncGenerator
from unittest.mock import patch

import pytest
import pytest_asyncio

from app.models.video_cover_models import (
    CoverConfig,
    CoverStateIn,
    CoverTextLayer,
)
from app.models.video_project_models import CreateVideoProjectRequest
from app.services.video_cover_service import video_cover_service
from app.services.video_project_service import video_project_service


USER_A = "11111111-1111-1111-1111-111111111111"
USER_B = "22222222-2222-2222-2222-222222222222"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project_a(db_session) -> AsyncGenerator[str, None]:
    record = await video_project_service.create_project(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectRequest(name="Cover Project"),
    )
    yield record.id


@pytest_asyncio.fixture
async def project_b(db_session) -> AsyncGenerator[str, None]:
    record = await video_project_service.create_project(
        db=db_session,
        user_id=USER_B,
        payload=CreateVideoProjectRequest(name="Other User's Project"),
    )
    yield record.id


def _make_payload(template_id: str = "title", aspect_ratio: str = "16:9") -> CoverStateIn:
    return CoverStateIn(
        template_id=template_id,  # type: ignore[arg-type]
        cover_config=CoverConfig(
            version=1,
            textLayers=[
                CoverTextLayer(
                    key="title",
                    text="Hello",
                    fontSize=72,
                    color="#ffffff",
                )
            ],
            decorations=[],
        ),
        image_source="frame",
        frame_virtual_time_ms=0,
        uploaded_image_url=None,
        aspect_ratio=aspect_ratio,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# GET / PUT happy path (covers INSERT + UPDATE branches of the portable upsert)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_empty_returns_none(db_session, project_a):
    state = await video_cover_service.get_by_project(
        db=db_session, user_id=USER_A, project_id=project_a
    )
    assert state is None


@pytest.mark.asyncio
async def test_put_insert_then_get(db_session, project_a):
    payload = _make_payload()
    saved = await video_cover_service.upsert(
        db=db_session, user_id=USER_A, project_id=project_a, payload=payload
    )
    assert saved is not None
    assert saved.template_id == "title"
    assert saved.aspect_ratio == "16:9"

    fetched = await video_cover_service.get_by_project(
        db=db_session, user_id=USER_A, project_id=project_a
    )
    assert fetched is not None
    assert fetched.cover_config.textLayers[0].text == "Hello"


@pytest.mark.asyncio
async def test_put_update_branch(db_session, project_a):
    """Second PUT for the same project_id must hit the UPDATE branch and
    not violate the unique(project_id) constraint."""
    await video_cover_service.upsert(
        db=db_session,
        user_id=USER_A,
        project_id=project_a,
        payload=_make_payload(template_id="title"),
    )
    updated = await video_cover_service.upsert(
        db=db_session,
        user_id=USER_A,
        project_id=project_a,
        payload=_make_payload(template_id="tutorial", aspect_ratio="9:16"),
    )
    assert updated is not None
    assert updated.template_id == "tutorial"
    assert updated.aspect_ratio == "9:16"


# ---------------------------------------------------------------------------
# Cross-user isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_returns_none_for_foreign_project(db_session, project_b):
    saved = await video_cover_service.upsert(
        db=db_session,
        user_id=USER_A,  # not the owner of project_b
        project_id=project_b,
        payload=_make_payload(),
    )
    assert saved is None  # router maps to 404


@pytest.mark.asyncio
async def test_get_returns_none_for_foreign_project(db_session, project_b):
    state = await video_cover_service.get_by_project(
        db=db_session, user_id=USER_A, project_id=project_b
    )
    assert state is None


# ---------------------------------------------------------------------------
# PNG cache + cover_url cache-busting (P1-3)
# ---------------------------------------------------------------------------


def _png_bytes() -> bytes:
    """Minimal-but-valid 1x1 PNG (signature + IHDR + IDAT + IEND)."""
    return bytes([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR length + tag
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,  # color/etc + crc
        0x89,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54,  # IDAT length + tag
        0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05,
        0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,  # IEND
        0xAE, 0x42, 0x60, 0x82,
    ])


@pytest.mark.asyncio
async def test_png_cache_writes_file_and_stamps_cover_url(
    db_session, project_a, tmp_path, monkeypatch
):
    # Redirect the storage_service singleton's root to the tmp dir so
    # we don't pollute the project's static/uploads tree during tests.
    from app.services import storage_service as ss_mod

    monkeypatch.setattr(ss_mod.storage_service, "root", tmp_path)

    result = await video_cover_service.store_png_and_update_project(
        db=db_session,
        user_id=USER_A,
        project_id=project_a,
        png_bytes=_png_bytes(),
    )
    assert result is not None
    url, _updated_at = result

    # Cache-busting suffix
    import re as _re
    assert _re.match(
        rf"^/api/storage/files/projects/{project_a}/cover\.png\?v=\d+$",
        url,
    )

    # On-disk file written
    on_disk = tmp_path / "projects" / project_a / "cover.png"
    assert on_disk.exists()
    assert on_disk.stat().st_size > 0

    # video_projects.cover_url stamped with the same URL
    from sqlalchemy import select
    from app.models.db_models import VideoProject
    import uuid as _uuid

    proj = (await db_session.execute(
        select(VideoProject).where(VideoProject.id == _uuid.UUID(project_a))
    )).scalar_one()
    assert proj.cover_url == url


@pytest.mark.asyncio
async def test_png_cache_rejects_non_png(db_session, project_a, tmp_path, monkeypatch):
    from app.services import storage_service as ss_mod
    monkeypatch.setattr(ss_mod.storage_service, "root", tmp_path)

    with pytest.raises(ValueError):
        await video_cover_service.store_png_and_update_project(
            db=db_session,
            user_id=USER_A,
            project_id=project_a,
            png_bytes=b"not-a-png",
        )


@pytest.mark.asyncio
async def test_png_cache_returns_none_for_foreign_project(
    db_session, project_b, tmp_path, monkeypatch
):
    from app.services import storage_service as ss_mod
    monkeypatch.setattr(ss_mod.storage_service, "root", tmp_path)

    result = await video_cover_service.store_png_and_update_project(
        db=db_session,
        user_id=USER_A,  # not the owner
        project_id=project_b,
        png_bytes=_png_bytes(),
    )
    assert result is None


# ---------------------------------------------------------------------------
# Project-delete cascade (P0-2)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_project_delete_cascades_cover_row_and_png(
    db_session, project_a, tmp_path, monkeypatch
):
    from app.services import storage_service as ss_mod

    monkeypatch.setattr(ss_mod.storage_service, "root", tmp_path)

    # Create cover row + PNG
    await video_cover_service.upsert(
        db=db_session, user_id=USER_A, project_id=project_a, payload=_make_payload()
    )
    await video_cover_service.store_png_and_update_project(
        db=db_session, user_id=USER_A, project_id=project_a, png_bytes=_png_bytes()
    )

    # Sanity: row + file exist
    assert (
        await video_cover_service.get_by_project(
            db=db_session, user_id=USER_A, project_id=project_a
        )
    ) is not None
    assert (tmp_path / "projects" / project_a / "cover.png").exists()

    # Storyboard cleanup hits an FS path we don't care about here. Stub it.
    from app.services import storyboard_service as _sb

    async def _noop_cleanup(_pack_ids):
        return None

    monkeypatch.setattr(_sb, "cleanup_pack_storage", _noop_cleanup)

    deleted = await video_project_service.delete_project(
        db=db_session, user_id=USER_A, project_id=project_a
    )
    assert deleted is True

    # Cover row + PNG gone
    assert (
        await video_cover_service.get_by_project(
            db=db_session, user_id=USER_A, project_id=project_a
        )
    ) is None
    assert not (tmp_path / "projects" / project_a / "cover.png").exists()


# ---------------------------------------------------------------------------
# delete_for_project (idempotent on missing rows)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_for_project_returns_false_when_absent(db_session, project_a):
    deleted = await video_cover_service.delete_for_project(db_session, project_a)
    assert deleted is False
