"""
Regression tests for owner-agnostic material listing (spec §4.6 / D13).

The database is not the only place ownership was encoded: material lands on
disk under ``{folder}/{YYYY}/{MM}/{DD}/user_{owner}/...`` and the listing used
to scan for one exact ``user_<id>`` directory name. Switching the WRITE side to
``LOCAL_OWNER_ID`` without widening the READ side would leave everything an
upgrading user ever uploaded sitting in ``user_<their old root uuid>/``, where
nothing would ever find it — "My materials" would come up empty after the
upgrade.

So the listing enumerates every ``user_*`` directory, and the directories on
disk are never renamed or moved.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.constants import LOCAL_OWNER_ID
from app.services.storage_service import StorageService


LEGACY_OWNER_ID = "9f3d1c62-0000-4000-8000-abcdefabcdef"


def _fresh_service(root: Path) -> StorageService:
    """Return a StorageService rooted at ``root`` (test-isolated)."""
    from app.config import settings as _settings

    service = StorageService.__new__(StorageService)
    service.config = _settings.storage
    service.root = root
    root.mkdir(parents=True, exist_ok=True)
    return service


def _write(root: Path, relative: str, content: bytes = b"DATA") -> Path:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


@pytest.mark.asyncio
async def test_lists_material_from_the_legacy_and_current_owner_dirs(tmp_path):
    """Both the pre-upgrade and post-upgrade owner directories are returned."""
    service = _fresh_service(tmp_path)
    _write(tmp_path, f"video/2026/05/20/user_{LEGACY_OWNER_ID}/task1/legacy.mp4")
    _write(tmp_path, f"video/2026/09/01/user_{LOCAL_OWNER_ID}/task2/current.mp4")

    result = await service.list_user_materials(user_id=LOCAL_OWNER_ID)

    assert result["success"] is True
    names = {item["name"] for item in result["materials"]}
    assert names == {"legacy.mp4", "current.mp4"}
    assert result["total"] == 2


@pytest.mark.asyncio
async def test_files_outside_an_owner_dir_are_still_skipped(tmp_path):
    """Widening the match must not start returning non-material files."""
    service = _fresh_service(tmp_path)
    _write(tmp_path, f"video/2026/09/01/user_{LOCAL_OWNER_ID}/task1/kept.mp4")
    _write(tmp_path, "video/2026/09/01/orphan/stray.mp4")

    result = await service.list_user_materials(user_id=LOCAL_OWNER_ID)

    names = {item["name"] for item in result["materials"]}
    assert names == {"kept.mp4"}


@pytest.mark.asyncio
async def test_material_type_filter_still_applies(tmp_path):
    """Owner-agnostic listing does not weaken the type filter."""
    service = _fresh_service(tmp_path)
    _write(tmp_path, f"video/2026/05/20/user_{LEGACY_OWNER_ID}/a/clip.mp4")
    _write(tmp_path, f"audio/2026/05/20/user_{LEGACY_OWNER_ID}/a/song.mp3")

    videos = await service.list_user_materials(
        user_id=LOCAL_OWNER_ID, material_type="video"
    )

    assert [item["name"] for item in videos["materials"]] == ["clip.mp4"]


@pytest.mark.asyncio
async def test_dedupe_collapses_the_same_file_across_owner_dirs(tmp_path):
    """``dedupe`` keys on (name, size), so a re-upload still collapses."""
    service = _fresh_service(tmp_path)
    _write(tmp_path, f"video/2026/05/20/user_{LEGACY_OWNER_ID}/a/clip.mp4", b"SAME")
    _write(tmp_path, f"video/2026/09/01/user_{LOCAL_OWNER_ID}/b/clip.mp4", b"SAME")

    deduped = await service.list_user_materials(user_id=LOCAL_OWNER_ID)
    raw = await service.list_user_materials(user_id=LOCAL_OWNER_ID, dedupe=False)

    assert deduped["total"] == 1
    assert raw["total"] == 2


@pytest.mark.asyncio
async def test_pagination_is_unchanged(tmp_path):
    """Paging math is untouched by the widened directory match."""
    service = _fresh_service(tmp_path)
    for index in range(5):
        _write(
            tmp_path,
            f"video/2026/09/01/user_{LOCAL_OWNER_ID}/task/clip{index}.mp4",
            f"payload-{index}".encode(),
        )

    page = await service.list_user_materials(
        user_id=LOCAL_OWNER_ID, page=2, page_size=2
    )

    assert page["total"] == 5
    assert page["total_pages"] == 3
    assert len(page["materials"]) == 2


@pytest.mark.asyncio
async def test_owner_directories_are_never_renamed(tmp_path):
    """Listing is read-only — the legacy directory must survive verbatim."""
    service = _fresh_service(tmp_path)
    legacy_dir = tmp_path / f"video/2026/05/20/user_{LEGACY_OWNER_ID}/task1"
    _write(tmp_path, f"video/2026/05/20/user_{LEGACY_OWNER_ID}/task1/legacy.mp4")

    await service.list_user_materials(user_id=LOCAL_OWNER_ID)

    assert legacy_dir.is_dir()
    assert (legacy_dir / "legacy.mp4").exists()
