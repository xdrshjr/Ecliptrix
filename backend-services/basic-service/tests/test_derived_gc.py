"""Tests for derived-file cache governance (spec 06 — persistence + cache GC).

Covers TODO 06 of the local-video-editing-refactor:

  * ``derived_gc_service.reclaim(referenced)`` deletes thumbnail dirs and
    waveform files NOT in the referenced set, KEEPS those that are referenced,
    and — the critical safety threshold — performs NO deletion when the
    referenced set is empty / abnormal ("when unsure, keep").
  * The delete-联动 cascade removes a material's source file, its thumbnail
    directory, and its waveform JSON in one call.
  * The startup reclaim entry point is callable, rate-limited (runs at most
    once per process within the cooldown), and non-blocking.

These exercise the directory convention (method A) directly: thumbnails live
under ``static/video/thumbnails/{key}/`` and waveforms under
``static/audio/waveforms/{key}.json``. No DB migration is involved.

运行测试：
pytest tests/test_derived_gc.py -v
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.services.storage_service import StorageService
from app.services.thumbnail_service import ThumbnailService
from app.services.waveform_service import WaveformService
from app.services.derived_gc_service import DerivedGcService


# ---------------------------------------------------------------------------
# Fixtures — services bound to a temp STORAGE_ROOT
# ---------------------------------------------------------------------------


@pytest.fixture
def storage_svc(storage_root):
    """A StorageService rooted at the temp dir."""
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
    """A ThumbnailService writing under the temp storage root."""
    config = MagicMock()
    config.filmstrip_slot_px = 80
    config.filmstrip_max_frames = 24
    config.filmstrip_quality = 0.7
    config.filmstrip_max_frames_per_material = 240
    return ThumbnailService(storage=storage_svc, config=config)


@pytest.fixture
def wave_svc(storage_root):
    """A WaveformService writing under the temp storage root."""
    with patch("app.services.waveform_service.settings") as mock_settings:
        mock_settings.storage = MagicMock()
        mock_settings.storage.root = str(storage_root)
        mock_settings.waveform = MagicMock()
        mock_settings.waveform.peaks_per_second = 100
        mock_settings.waveform.timeout_seconds = 30
        mock_settings.waveform.max_concurrent = 2
        svc = WaveformService()
    return svc


@pytest.fixture
def gc_svc(storage_svc, thumb_svc, wave_svc, storage_root):
    """A DerivedGcService wired to the temp-rooted services."""
    return DerivedGcService(
        storage=storage_svc,
        thumbnail_service=thumb_svc,
        waveform_service=wave_svc,
        root=str(storage_root),
    )


# ---------------------------------------------------------------------------
# Helpers — plant derived files on disk
# ---------------------------------------------------------------------------


_JPEG = b"\xff\xd8\xff\xe0" + b"jpeg-bytes" + b"\xff\xd9"


def _plant_thumbnail(storage_root, key: str) -> None:
    """Create a thumbnail dir with a poster + one filmstrip frame for *key*."""
    mat_dir = storage_root / "static" / "video" / "thumbnails" / key
    mat_dir.mkdir(parents=True, exist_ok=True)
    (mat_dir / "poster.jpg").write_bytes(_JPEG)
    (mat_dir / "strip_1x_0.jpg").write_bytes(_JPEG)


def _plant_waveform(storage_root, key: str) -> None:
    """Create a waveform JSON document for *key*."""
    wf_dir = storage_root / "static" / "audio" / "waveforms"
    wf_dir.mkdir(parents=True, exist_ok=True)
    doc = {
        "version": 1,
        "materialId": key,
        "durationSec": 1.0,
        "peaksPerSecond": 100,
        "peaks": [0.1, 0.2],
    }
    (wf_dir / f"{key}.json").write_text(json.dumps(doc), encoding="utf-8")


def _thumb_dir(storage_root, key: str):
    return storage_root / "static" / "video" / "thumbnails" / key


def _wave_file(storage_root, key: str):
    return storage_root / "static" / "audio" / "waveforms" / f"{key}.json"


# ---------------------------------------------------------------------------
# reclaim — only-unreferenced deleted, referenced kept
# ---------------------------------------------------------------------------


def test_reclaim_deletes_only_unreferenced_thumbnails(gc_svc, storage_root):
    """Unreferenced thumbnail dirs are removed; referenced ones survive."""
    _plant_thumbnail(storage_root, "keep-1")
    _plant_thumbnail(storage_root, "orphan-1")
    _plant_thumbnail(storage_root, "orphan-2")

    report = gc_svc.reclaim({"keep-1"})

    assert _thumb_dir(storage_root, "keep-1").is_dir()
    assert not _thumb_dir(storage_root, "orphan-1").exists()
    assert not _thumb_dir(storage_root, "orphan-2").exists()
    assert report["dirs"] == 2


def test_reclaim_deletes_only_unreferenced_waveforms(gc_svc, storage_root):
    """Unreferenced waveform JSONs are removed; referenced ones survive."""
    _plant_waveform(storage_root, "keep-1")
    _plant_waveform(storage_root, "orphan-1")

    report = gc_svc.reclaim({"keep-1"})

    assert _wave_file(storage_root, "keep-1").is_file()
    assert not _wave_file(storage_root, "orphan-1").exists()
    assert report["files"] == 1


def test_reclaim_reports_reclaimed_bytes(gc_svc, storage_root):
    """The report includes the number of reclaimed bytes (> 0 when files go)."""
    _plant_thumbnail(storage_root, "orphan-1")
    _plant_waveform(storage_root, "orphan-2")

    report = gc_svc.reclaim({"some-unrelated-live-id"})

    assert report["bytes"] > 0
    assert report["dirs"] == 1
    assert report["files"] == 1


def test_reclaim_with_complete_set_keeps_both_key_spaces(gc_svc, storage_root):
    """Tester boundary probe (reviewer ISSUE #1 mitigation contract).

    The SAFE way to wire reclaim is to pass a COMPLETE referenced set that
    includes BOTH every materialId (filmstrip key) AND every poster STEM. Prove
    that when the set carries both key spaces, the referenced materialId dir and
    its differently-keyed poster-stem dir BOTH survive, while a genuine orphan
    (referenced by neither key) is reclaimed. This pins the partial-set footgun
    as avoidable by callers (it is not a shipped bug — no destructive caller
    exists yet), and confirms reclaim deletes ONLY the truly-unreferenced dir.
    """
    _plant_thumbnail(storage_root, "mat-1")        # frontend materialId key
    _plant_thumbnail(storage_root, "stored-stem")  # poster stem key (same asset)
    _plant_thumbnail(storage_root, "real-orphan")  # referenced by neither key

    # Complete referenced set: both key spaces for the live asset.
    report = gc_svc.reclaim({"mat-1", "stored-stem"})

    assert _thumb_dir(storage_root, "mat-1").is_dir()        # kept
    assert _thumb_dir(storage_root, "stored-stem").is_dir()  # kept (poster stem)
    assert not _thumb_dir(storage_root, "real-orphan").exists()  # reclaimed
    assert report["dirs"] == 1
    assert report["skipped"] is False


# ---------------------------------------------------------------------------
# reclaim SAFETY — empty / abnormal referenced set must NOT mass-delete
# ---------------------------------------------------------------------------


def test_reclaim_empty_referenced_set_deletes_nothing(gc_svc, storage_root):
    """SAFETY THRESHOLD: an empty referenced set reclaims NOTHING.

    A bug here would wipe every user's thumbnails/waveforms, so an empty
    reference集 is treated as "I don't know what's live" → keep everything.
    """
    _plant_thumbnail(storage_root, "a")
    _plant_thumbnail(storage_root, "b")
    _plant_waveform(storage_root, "a")

    report = gc_svc.reclaim(set())

    assert _thumb_dir(storage_root, "a").is_dir()
    assert _thumb_dir(storage_root, "b").is_dir()
    assert _wave_file(storage_root, "a").is_file()
    assert report["dirs"] == 0
    assert report["files"] == 0
    assert report["skipped"] is True


def test_reclaim_none_referenced_set_deletes_nothing(gc_svc, storage_root):
    """An abnormal (None) referenced set is treated as unsafe → skip."""
    _plant_thumbnail(storage_root, "a")

    report = gc_svc.reclaim(None)  # type: ignore[arg-type]

    assert _thumb_dir(storage_root, "a").is_dir()
    assert report["skipped"] is True


def test_reclaim_dry_run_deletes_nothing_but_reports(gc_svc, storage_root):
    """Dry-run logs intended deletions without touching the filesystem."""
    _plant_thumbnail(storage_root, "orphan-1")
    _plant_waveform(storage_root, "orphan-2")

    report = gc_svc.reclaim({"live"}, dry_run=True)

    # Nothing actually deleted.
    assert _thumb_dir(storage_root, "orphan-1").is_dir()
    assert _wave_file(storage_root, "orphan-2").is_file()
    # But the report still counts what WOULD be removed.
    assert report["dirs"] == 1
    assert report["files"] == 1
    assert report["dry_run"] is True


# ---------------------------------------------------------------------------
# delete-联动 cascade — source + thumbnails + waveform in one call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_material_cascade_removes_all_derived(gc_svc, storage_root):
    """Deleting a material removes its thumbnail dir AND waveform JSON."""
    _plant_thumbnail(storage_root, "mat-1")
    _plant_waveform(storage_root, "mat-1")

    result = await gc_svc.delete_material("mat-1")

    assert not _thumb_dir(storage_root, "mat-1").exists()
    assert not _wave_file(storage_root, "mat-1").exists()
    assert result["deleted"]["thumbnails"] == 2  # poster + 1 frame
    assert result["deleted"]["waveform"] is True


@pytest.mark.asyncio
async def test_delete_material_also_cleans_extra_keys(gc_svc, storage_root):
    """Extra keys (e.g. the stored-file poster stem) are cascaded too.

    Poster dirs are keyed by the stored-file stem while filmstrip dirs are
    keyed by the frontend materialId; the cascade must remove BOTH.
    """
    _plant_thumbnail(storage_root, "mat-1")          # frontend materialId key
    _plant_thumbnail(storage_root, "stored-stem")    # poster stem key

    result = await gc_svc.delete_material("mat-1", extra_keys=["stored-stem"])

    assert not _thumb_dir(storage_root, "mat-1").exists()
    assert not _thumb_dir(storage_root, "stored-stem").exists()
    assert result["deleted"]["thumbnails"] == 4  # 2 dirs × (poster + frame)


@pytest.mark.asyncio
async def test_delete_material_removes_source_file(gc_svc, storage_root):
    """A provided source path is removed from STORAGE_ROOT."""
    src_dir = storage_root / "video"
    src_dir.mkdir(parents=True, exist_ok=True)
    src = src_dir / "clip.mp4"
    src.write_bytes(b"video-bytes")

    result = await gc_svc.delete_material(
        "mat-1", source_path="video/clip.mp4"
    )

    assert not src.exists()
    assert result["deleted"]["source"] is True


@pytest.mark.asyncio
async def test_delete_material_missing_derived_is_noop(gc_svc, storage_root):
    """Deleting a material with no derived files is a safe no-op."""
    result = await gc_svc.delete_material("ghost")

    assert result["deleted"]["thumbnails"] == 0
    assert result["deleted"]["waveform"] is False
    assert result["deleted"]["source"] is False


# ---------------------------------------------------------------------------
# Startup reclaim entry — rate-limited + non-blocking
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_schedule_startup_reclaim_runs_once_within_cooldown(
    gc_svc, storage_root
):
    """Two startup schedules inside the cooldown run reclaim exactly once."""
    _plant_thumbnail(storage_root, "orphan")
    calls = []

    def _provider():
        return {"live"}

    gc_svc._reclaim_for_report = MagicMock(  # type: ignore[attr-defined]
        side_effect=lambda *a, **k: calls.append(1)
        or {"dirs": 0, "files": 0, "bytes": 0, "skipped": True, "dry_run": False}
    )

    await gc_svc.run_startup_reclaim(_provider)
    await gc_svc.run_startup_reclaim(_provider)  # within cooldown → skipped

    assert len(calls) == 1


@pytest.mark.asyncio
async def test_startup_reclaim_skips_when_provider_empty(gc_svc, storage_root):
    """A reference provider returning empty makes reclaim skip (safety)."""
    _plant_thumbnail(storage_root, "a")

    await gc_svc.run_startup_reclaim(lambda: set())

    # Safety threshold: empty provider → nothing deleted.
    assert _thumb_dir(storage_root, "a").is_dir()
