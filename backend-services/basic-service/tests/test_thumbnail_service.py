"""Tests for the local thumbnail (poster + filmstrip) service.

Covers TODO 03 of the local-video-editing-refactor:
  * poster landing-point relocation to
    ``static/video/thumbnails/{material_id}/poster.jpg``
  * filmstrip frame write / path scheme / same-origin URL
  * ``list_material`` enumeration (poster + frames)
  * ``delete_by_material`` cleanup hook (consumed by spec 06)
  * ``list_material_dirs`` orphan-scan helper (consumed by spec 06)
  * per-material capacity cap with LRU eviction of oldest zoom tiers

运行测试：
pytest tests/test_thumbnail_service.py -v
"""

import pytest
from unittest.mock import patch, MagicMock

from app.services.storage_service import StorageService
from app.services.thumbnail_service import ThumbnailService


@pytest.fixture
def storage_svc(storage_root):
    """Create a StorageService bound to a temporary root."""
    with patch("app.services.storage_service.settings") as mock_settings:
        mock_settings.storage = MagicMock()
        mock_settings.storage.root = str(storage_root)
        mock_settings.storage.max_file_size = 524288000
        mock_settings.storage.allowed_video_types = ["video/mp4"]
        mock_settings.storage.allowed_audio_types = ["audio/mpeg"]
        mock_settings.storage.allowed_image_types = ["image/png", "image/jpeg"]
        svc = StorageService()
    return svc


@pytest.fixture
def thumb_svc(storage_svc):
    """Create a ThumbnailService with filmstrip config and a temp storage."""
    config = MagicMock()
    config.filmstrip_slot_px = 80
    config.filmstrip_max_frames = 24
    config.filmstrip_quality = 0.7
    config.filmstrip_max_frames_per_material = 4
    return ThumbnailService(storage=storage_svc, config=config)


# A tiny but valid-enough JPEG byte blob for write/read round-trips. The
# service never decodes it, so a marker payload is sufficient.
_JPEG = b"\xff\xd8\xff\xe0" + b"jpeg-bytes" + b"\xff\xd9"


# ---------------------------------------------------------------------------
# Path scheme
# ---------------------------------------------------------------------------

def test_poster_relative_path_is_under_thumbnails_dir(thumb_svc):
    """Poster lands at static/video/thumbnails/{material_id}/poster.jpg."""
    rel = thumb_svc.poster_relative_path("mat-123")
    assert rel == "static/video/thumbnails/mat-123/poster.jpg"


def test_poster_url_is_same_origin_storage_files(thumb_svc):
    """Poster URL is served via the existing /api/storage/files mount."""
    url = thumb_svc.poster_url("mat-123")
    assert url == "/api/storage/files/static/video/thumbnails/mat-123/poster.jpg"


def test_frame_relative_path_encodes_zoom_tier_and_time(thumb_svc):
    """Filmstrip frame path encodes zoom tier and millisecond timestamp."""
    rel = thumb_svc.frame_relative_path("mat-123", "1x", 4500)
    assert rel == "static/video/thumbnails/mat-123/strip_1x_4500.jpg"


def test_material_id_is_sanitized_in_paths(thumb_svc):
    """A traversal-laced material id cannot escape the thumbnails dir."""
    rel = thumb_svc.frame_relative_path("../../etc", "1x", 0)
    assert ".." not in rel
    assert rel.startswith("static/video/thumbnails/")


# ---------------------------------------------------------------------------
# Frame write + list + same-origin URL
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_save_frame_writes_to_canonical_path(thumb_svc, storage_root):
    """Saving a frame writes the bytes to the canonical path and returns
    a same-origin URL that resolves to that file."""
    result = await thumb_svc.save_frame(
        material_id="mat-9",
        zoom_tier="2x",
        t_ms=1000,
        data=_JPEG,
        content_type="image/jpeg",
    )
    assert result["success"] is True
    assert result["url"] == (
        "/api/storage/files/static/video/thumbnails/mat-9/strip_2x_1000.jpg"
    )
    on_disk = (
        storage_root / "static" / "video" / "thumbnails" / "mat-9"
        / "strip_2x_1000.jpg"
    )
    assert on_disk.exists()
    assert on_disk.read_bytes() == _JPEG


@pytest.mark.asyncio
async def test_save_frame_rejects_empty_payload(thumb_svc):
    """An empty frame payload is rejected, not written."""
    result = await thumb_svc.save_frame(
        material_id="mat-9", zoom_tier="1x", t_ms=0,
        data=b"", content_type="image/jpeg",
    )
    assert result["success"] is False


@pytest.mark.asyncio
async def test_list_material_returns_poster_and_frames(thumb_svc, storage_root):
    """list_material enumerates the poster and all persisted frames."""
    # Plant a poster.
    poster_dir = storage_root / "static" / "video" / "thumbnails" / "mat-7"
    poster_dir.mkdir(parents=True)
    (poster_dir / "poster.jpg").write_bytes(_JPEG)
    # Save two frames at different tiers / times.
    await thumb_svc.save_frame("mat-7", "1x", 0, _JPEG, "image/jpeg")
    await thumb_svc.save_frame("mat-7", "1x", 2000, _JPEG, "image/jpeg")

    listing = thumb_svc.list_material("mat-7")
    assert listing["poster"] == thumb_svc.poster_url("mat-7")
    tms = sorted(f["t_ms"] for f in listing["frames"])
    assert tms == [0, 2000]
    assert all(f["zoom_tier"] == "1x" for f in listing["frames"])
    assert all(f["url"].startswith("/api/storage/files/") for f in listing["frames"])


@pytest.mark.asyncio
async def test_list_material_missing_returns_empty(thumb_svc):
    """An unknown material id lists no poster and no frames."""
    listing = thumb_svc.list_material("does-not-exist")
    assert listing["poster"] is None
    assert listing["frames"] == []


# ---------------------------------------------------------------------------
# Capacity / LRU eviction (per material, per spec 03 §2.5)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_save_frame_evicts_oldest_tier_over_capacity(thumb_svc, storage_root):
    """When a material exceeds filmstrip_max_frames_per_material, the
    least-recently-written zoom tier's frames are evicted; the freshest
    frame survives."""
    mat = "mat-cap"
    # Cap is 4 frames. Write 5 frames across two tiers so eviction fires.
    for t in (0, 100, 200, 300):
        await thumb_svc.save_frame(mat, "1x", t, _JPEG, "image/jpeg")
    # A new tier write pushes the total to 5 → oldest tier ("1x") evicted.
    await thumb_svc.save_frame(mat, "2x", 0, _JPEG, "image/jpeg")

    listing = thumb_svc.list_material(mat)
    tiers = {f["zoom_tier"] for f in listing["frames"]}
    # The freshly-written 2x frame must survive.
    assert "2x" in tiers
    # Total frames never exceed the per-material cap.
    assert len(listing["frames"]) <= thumb_svc.config.filmstrip_max_frames_per_material


# ---------------------------------------------------------------------------
# delete_by_material + list_material_dirs (spec 06 hooks)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_by_material_removes_dir_and_counts(thumb_svc, storage_root):
    """delete_by_material removes the whole {material_id} dir and reports
    how many files it removed."""
    mat = "mat-del"
    poster_dir = storage_root / "static" / "video" / "thumbnails" / mat
    poster_dir.mkdir(parents=True)
    (poster_dir / "poster.jpg").write_bytes(_JPEG)
    await thumb_svc.save_frame(mat, "1x", 0, _JPEG, "image/jpeg")
    await thumb_svc.save_frame(mat, "1x", 500, _JPEG, "image/jpeg")

    result = thumb_svc.delete_by_material(mat)
    assert result["success"] is True
    assert result["removed"] == 3  # poster + 2 frames
    assert not poster_dir.exists()


def test_delete_by_material_missing_is_noop(thumb_svc):
    """Deleting an absent material is a no-op (success, removed=0)."""
    result = thumb_svc.delete_by_material("ghost")
    assert result["success"] is True
    assert result["removed"] == 0


@pytest.mark.asyncio
async def test_list_material_dirs_enumerates_material_ids(thumb_svc, storage_root):
    """list_material_dirs returns every material id with a thumbnail dir,
    so spec 06 can diff against live material ids for orphan reclaim."""
    await thumb_svc.save_frame("mat-a", "1x", 0, _JPEG, "image/jpeg")
    await thumb_svc.save_frame("mat-b", "1x", 0, _JPEG, "image/jpeg")
    poster_dir = storage_root / "static" / "video" / "thumbnails" / "mat-c"
    poster_dir.mkdir(parents=True)
    (poster_dir / "poster.jpg").write_bytes(_JPEG)

    dirs = thumb_svc.list_material_dirs()
    assert set(dirs) == {"mat-a", "mat-b", "mat-c"}


def test_list_material_dirs_empty_when_no_thumbnails(thumb_svc):
    """No thumbnails directory at all → empty list (no crash)."""
    assert thumb_svc.list_material_dirs() == []


# ---------------------------------------------------------------------------
# Router contract: POST /storage/thumbnail-frame + GET /storage/thumbnails/{id}
# ---------------------------------------------------------------------------

@pytest.fixture
def thumb_client(thumb_svc):
    """Mount only the storage_router with the thumbnail service stubbed to the
    temp-rooted ThumbnailService so we exercise the real endpoint. The routes
    carry no auth dependency any more (single local owner), so nothing needs
    to be overridden."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routers import storage_router

    app = FastAPI()
    app.include_router(storage_router.router, prefix="/api")

    with patch.object(storage_router, "thumbnail_service", thumb_svc):
        yield TestClient(app)


def test_post_thumbnail_frame_persists_and_returns_url(thumb_client, storage_root):
    """POST /storage/thumbnail-frame writes the frame and returns its URL."""
    resp = thumb_client.post(
        "/api/storage/thumbnail-frame",
        data={"material_id": "mat-ep", "zoom_tier": "1x", "t_ms": "1500"},
        files={"frame": ("f.jpg", _JPEG, "image/jpeg")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["url"] == (
        "/api/storage/files/static/video/thumbnails/mat-ep/strip_1x_1500.jpg"
    )
    on_disk = (
        storage_root / "static" / "video" / "thumbnails" / "mat-ep"
        / "strip_1x_1500.jpg"
    )
    assert on_disk.exists()


def test_post_thumbnail_frame_rejects_non_image(thumb_client):
    """A non-image content-type is rejected with success=False."""
    resp = thumb_client.post(
        "/api/storage/thumbnail-frame",
        data={"material_id": "mat-ep", "zoom_tier": "1x", "t_ms": "0"},
        files={"frame": ("f.bin", b"not-an-image", "application/octet-stream")},
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is False


def test_get_material_thumbnails_lists_poster_and_frames(thumb_client, storage_root):
    """GET /storage/thumbnails/{id} returns poster + frames after persistence."""
    poster_dir = storage_root / "static" / "video" / "thumbnails" / "mat-list"
    poster_dir.mkdir(parents=True)
    (poster_dir / "poster.jpg").write_bytes(_JPEG)
    thumb_client.post(
        "/api/storage/thumbnail-frame",
        data={"material_id": "mat-list", "zoom_tier": "2x", "t_ms": "250"},
        files={"frame": ("f.jpg", _JPEG, "image/jpeg")},
    )

    resp = thumb_client.get("/api/storage/thumbnails/mat-list")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["poster"].endswith("/mat-list/poster.jpg")
    assert len(body["frames"]) == 1
    assert body["frames"][0]["zoom_tier"] == "2x"
    assert body["frames"][0]["t_ms"] == 250
