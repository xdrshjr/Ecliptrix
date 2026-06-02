"""
Unit tests for PreviewProxyService (spec 06 §四 / phase-3 §3.2.7).

Heavy paths (FFmpeg subprocess, real DB) are mocked. Tests focus on the
contract of ensure_or_enqueue / get_status / progress parsing /
finalize_failure cleanup — i.e. the surface the router and frontend
consume.
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import preview_proxy_service as pps


@pytest.fixture
def svc(tmp_path, monkeypatch):
    """Build a service instance pointed at a tmp output dir.

    The service holds a singleton inside the module so we patch its
    constructor inputs and clear the singleton between tests.
    """
    # Reset singleton so each test gets a fresh instance.
    pps._preview_proxy_service = None
    # Force output dir to a tmp path so we don't pollute the repo.
    monkeypatch.setattr(pps.settings.preview_proxy, "output_dir", str(tmp_path / "out"))
    instance = pps.PreviewProxyService()
    return instance


# ---------------------------------------------------------------------------
# Static helpers
# ---------------------------------------------------------------------------


def test_estimate_progress_end_returns_100():
    assert pps.PreviewProxyService._estimate_progress({"progress": "end"}) == 100


def test_estimate_progress_continue_returns_low_pct():
    pct = pps.PreviewProxyService._estimate_progress({"progress": "continue"})
    assert pct is not None
    assert 0 < pct < 100


def test_ffmpeg_args_uses_baseline_profile():
    args = pps._ffmpeg_args("/tmp/in.mp4", "/tmp/out.mp4", "preview-480p")
    assert args[0] == "ffmpeg"
    assert "-c:v" in args
    assert "libx264" in args
    assert "-progress" in args and "pipe:1" in args


def test_ffmpeg_args_unknown_profile_falls_back_to_default():
    args1 = pps._ffmpeg_args("/in", "/out", "garbage")
    args2 = pps._ffmpeg_args("/in", "/out", "preview-480p")
    # Same arg set regardless — unknown profile silently coerced.
    assert args1 == args2


# ---------------------------------------------------------------------------
# ensure_or_enqueue
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ensure_disabled_raises(monkeypatch, svc):
    monkeypatch.setattr(pps.settings.preview_proxy, "enabled", False)
    svc._cfg = pps.settings.preview_proxy
    with pytest.raises(pps.PreviewProxyDisabledError):
        await svc.ensure_or_enqueue(material_id="00000000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_ensure_validation_no_inputs(svc):
    with pytest.raises(pps.PreviewProxyValidationError):
        await svc.ensure_or_enqueue()


@pytest.mark.asyncio
async def test_ensure_cached_short_circuit(svc):
    # Stub DB layer.
    row = MagicMock()
    row.preview_proxy_status = "cached"
    row.preview_proxy_local_url = "/api/storage/files/preview-proxies/x/480p.mp4"
    svc._ensure_runtime = AsyncMock(return_value=None)
    svc._session_factory = MagicMock()
    sess = AsyncMock()
    sess.__aenter__ = AsyncMock(return_value=sess)
    sess.__aexit__ = AsyncMock(return_value=False)
    svc._session_factory.return_value = sess
    svc._get_row = AsyncMock(return_value=row)

    task_id, status, url, mid = await svc.ensure_or_enqueue(
        material_id="00000000-0000-0000-0000-000000000001"
    )
    assert status == "cached"
    assert task_id is None
    assert url.endswith("480p.mp4")


@pytest.mark.asyncio
async def test_ensure_queued_enqueues(svc):
    row = MagicMock()
    row.preview_proxy_status = "absent"
    row.preview_proxy_local_url = None
    svc._ensure_runtime = AsyncMock(return_value=None)
    svc._session_factory = MagicMock()
    sess = AsyncMock()
    sess.__aenter__ = AsyncMock(return_value=sess)
    sess.__aexit__ = AsyncMock(return_value=False)
    svc._session_factory.return_value = sess
    svc._get_row = AsyncMock(return_value=row)

    with patch.object(pps.preview_proxy_queue, "enqueue", AsyncMock()) as enq:
        task_id, status, url, mid = await svc.ensure_or_enqueue(
            material_id="00000000-0000-0000-0000-000000000001"
        )
    assert status == "queued"
    assert task_id is not None
    enq.assert_awaited_once()


# ---------------------------------------------------------------------------
# get_status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_status_absent_when_row_missing(svc):
    svc._ensure_runtime = AsyncMock(return_value=None)
    svc._session_factory = MagicMock()
    sess = AsyncMock()
    sess.__aenter__ = AsyncMock(return_value=sess)
    sess.__aexit__ = AsyncMock(return_value=False)
    svc._session_factory.return_value = sess
    svc._get_row = AsyncMock(return_value=None)

    snap = await svc.get_status("00000000-0000-0000-0000-000000000001")
    assert snap["status"] == "absent"
    assert snap["progress_percent"] == 0


@pytest.mark.asyncio
async def test_get_status_uses_in_memory_progress(svc):
    row = MagicMock()
    row.preview_proxy_status = "running"
    row.preview_proxy_local_url = None
    row.preview_proxy_profile = "preview-480p"
    row.preview_proxy_progress = 10
    row.preview_proxy_last_error = None
    row.preview_proxy_transcoded_at = None
    row.preview_proxy_duration_sec = None
    row.preview_proxy_bytes = None
    svc._ensure_runtime = AsyncMock(return_value=None)
    svc._session_factory = MagicMock()
    sess = AsyncMock()
    sess.__aenter__ = AsyncMock(return_value=sess)
    sess.__aexit__ = AsyncMock(return_value=False)
    svc._session_factory.return_value = sess
    svc._get_row = AsyncMock(return_value=row)
    svc._progress_cache["00000000-0000-0000-0000-000000000001"] = 55

    snap = await svc.get_status("00000000-0000-0000-0000-000000000001")
    assert snap["status"] == "running"
    # In-memory cache takes precedence for sub-second freshness.
    assert snap["progress_percent"] == 55


# ---------------------------------------------------------------------------
# Cleanup invariant
# ---------------------------------------------------------------------------


def test_cleanup_partial_unlinks_existing(svc, tmp_path):
    p = tmp_path / "x.mp4"
    p.write_text("partial")
    svc._cleanup_partial(p)
    assert not p.exists()


def test_cleanup_partial_noop_when_missing(svc, tmp_path):
    p = tmp_path / "missing.mp4"
    # Must not raise.
    svc._cleanup_partial(p)


def test_local_url_for_strips_storage_root(svc, monkeypatch):
    monkeypatch.setattr(pps.settings.storage, "root", "static/uploads")
    svc._cfg = pps.settings.preview_proxy
    url = svc._local_url_for("abc-123", "480p.mp4")
    assert url.startswith("/api/storage/files/")
    assert "abc-123/480p.mp4" in url


# ---------------------------------------------------------------------------
# Same-origin storage helpers (C2 / §3.2.5)
# ---------------------------------------------------------------------------


def test_is_same_origin_storage_url():
    assert pps.is_same_origin_storage_url("/api/storage/files/video/x.mp4") is True
    assert (
        pps.is_same_origin_storage_url("https://host/api/storage/files/video/x.mp4")
        is True
    )
    assert pps.is_same_origin_storage_url("https://cdn.example.com/v.mp4") is False
    assert pps.is_same_origin_storage_url(None) is False
    assert pps.is_same_origin_storage_url("") is False


def test_storage_relpath_from_url():
    assert (
        pps._storage_relpath_from_url("/api/storage/files/video/x.mp4")
        == "video/x.mp4"
    )
    # Absolute form + query string stripped.
    assert (
        pps._storage_relpath_from_url("https://h/api/storage/files/a/b.mp4?token=1")
        == "a/b.mp4"
    )
    # Percent escapes decoded.
    assert (
        pps._storage_relpath_from_url("/api/storage/files/video/a%20b.mp4")
        == "video/a b.mp4"
    )
    assert pps._storage_relpath_from_url("https://cdn/v.mp4") is None


# ---------------------------------------------------------------------------
# _seed_local_row (C2 seed branch)
# ---------------------------------------------------------------------------


def _seed_session_no_existing():
    """An AsyncMock session whose lookups all return 'no row'."""
    session = AsyncMock()
    res = MagicMock()
    res.scalars.return_value.first.return_value = None
    res.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=res)
    session.commit = AsyncMock()

    async def _refresh(row):
        if not getattr(row, "id", None):
            row.id = uuid.uuid4()

    session.refresh = AsyncMock(side_effect=_refresh)
    session.add = MagicMock()
    return session


@pytest.mark.asyncio
async def test_seed_local_row_creates_upload_row_for_same_origin_file(
    svc, tmp_path, monkeypatch
):
    # Real on-disk file under a tmp storage root.
    storage_root = tmp_path / "uploads"
    (storage_root / "video").mkdir(parents=True)
    f = storage_root / "video" / "clip.mp4"
    f.write_bytes(b"x" * 4096)

    monkeypatch.setattr(pps.settings.storage, "root", str(storage_root))
    monkeypatch.setattr(pps.settings.preview_proxy, "output_dir", str(tmp_path / "out"))
    monkeypatch.setattr(
        pps.settings.media_proxy, "hot_cache_dir", str(tmp_path / "hot")
    )
    monkeypatch.setattr(pps.settings, "temp_dir", str(tmp_path / "tmp"))
    svc._cfg = pps.settings.preview_proxy

    # storage_service maps the relative path → the real disk file.
    fake_storage = MagicMock()
    fake_storage._validate_path = MagicMock(return_value=f)
    monkeypatch.setattr(pps, "storage_service", fake_storage)

    session = _seed_session_no_existing()
    row = await svc._seed_local_row(session, "/api/storage/files/video/clip.mp4")

    assert row is not None
    session.add.assert_called_once()
    assert row.source == "upload"
    assert row.status == "ready"
    assert row.preview_proxy_status == "absent"
    # local_path is the validated (resolved) on-disk path.
    assert Path(row.local_path).resolve() == f.resolve()
    fake_storage._validate_path.assert_called_once_with("video/clip.mp4")


@pytest.mark.asyncio
async def test_seed_local_row_reuses_existing_row_by_local_path(
    svc, tmp_path, monkeypatch
):
    storage_root = tmp_path / "uploads"
    (storage_root / "cached_materials" / "pexels").mkdir(parents=True)
    f = storage_root / "cached_materials" / "pexels" / "9.mp4"
    f.write_bytes(b"y" * 2048)

    monkeypatch.setattr(pps.settings.storage, "root", str(storage_root))
    monkeypatch.setattr(pps.settings.preview_proxy, "output_dir", str(tmp_path / "out"))
    monkeypatch.setattr(
        pps.settings.media_proxy, "hot_cache_dir", str(tmp_path / "hot")
    )
    monkeypatch.setattr(pps.settings, "temp_dir", str(tmp_path / "tmp"))
    svc._cfg = pps.settings.preview_proxy

    fake_storage = MagicMock()
    fake_storage._validate_path = MagicMock(return_value=f)
    monkeypatch.setattr(pps, "storage_service", fake_storage)

    existing = MagicMock()
    session = AsyncMock()
    res = MagicMock()
    res.scalars.return_value.first.return_value = existing  # local_path hit
    session.execute = AsyncMock(return_value=res)
    session.add = MagicMock()

    row = await svc._seed_local_row(
        session, "/api/storage/files/cached_materials/pexels/9.mp4"
    )
    assert row is existing
    session.add.assert_not_called()  # reuse, don't duplicate


@pytest.mark.asyncio
async def test_seed_local_row_rejects_traversal(svc, monkeypatch):
    fake_storage = MagicMock()
    fake_storage._validate_path = MagicMock(side_effect=ValueError("traversal"))
    monkeypatch.setattr(pps, "storage_service", fake_storage)

    session = AsyncMock()
    session.add = MagicMock()
    row = await svc._seed_local_row(
        session, "/api/storage/files/../../etc/passwd"
    )
    assert row is None
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_seed_local_row_none_for_external_or_missing_url(svc):
    session = AsyncMock()
    assert await svc._seed_local_row(session, "https://cdn.example.com/v.mp4") is None
    assert await svc._seed_local_row(session, None) is None


# ---------------------------------------------------------------------------
# ensure_or_enqueue — seed branch integration (C2)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ensure_seeds_local_row_then_queues(svc, monkeypatch):
    """material_id has no row but a same-origin source_url seeds one → queued.

    Covers the local-upload case where the front-end id (`video_<ts>_<rand>`)
    is not even a UUID; the resolved row UUID is returned to the caller.
    """
    seeded = MagicMock()
    seeded.id = uuid.UUID("00000000-0000-0000-0000-0000000000aa")
    seeded.preview_proxy_status = "absent"
    seeded.preview_proxy_local_url = None

    svc._ensure_runtime = AsyncMock(return_value=None)
    svc._session_factory = MagicMock()
    sess = AsyncMock()
    sess.__aenter__ = AsyncMock(return_value=sess)
    sess.__aexit__ = AsyncMock(return_value=False)
    svc._session_factory.return_value = sess
    svc._get_row = AsyncMock(return_value=None)  # no row by id
    svc._seed_local_row = AsyncMock(return_value=seeded)

    with patch.object(pps.preview_proxy_queue, "enqueue", AsyncMock()) as enq:
        task_id, status, url, mid = await svc.ensure_or_enqueue(
            material_id="video_1748_abc",  # non-UUID upload id
            source_url="/api/storage/files/video/clip.mp4",
        )
    assert status == "queued"
    assert mid == str(seeded.id)  # resolved canonical UUID returned
    svc._seed_local_row.assert_awaited_once()
    enq.assert_awaited_once()


@pytest.mark.asyncio
async def test_ensure_not_found_when_no_resolvable_source(svc):
    svc._ensure_runtime = AsyncMock(return_value=None)
    svc._session_factory = MagicMock()
    sess = AsyncMock()
    sess.__aenter__ = AsyncMock(return_value=sess)
    sess.__aexit__ = AsyncMock(return_value=False)
    svc._session_factory.return_value = sess
    svc._get_row = AsyncMock(return_value=None)

    # No source_url at all → seed branch returns None → NotFound.
    with pytest.raises(pps.PreviewProxyNotFoundError):
        await svc.ensure_or_enqueue(
            material_id="00000000-0000-0000-0000-000000000009"
        )


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------


def test_get_preview_proxy_service_returns_singleton():
    pps._preview_proxy_service = None
    a = pps.get_preview_proxy_service()
    b = pps.get_preview_proxy_service()
    assert a is b
