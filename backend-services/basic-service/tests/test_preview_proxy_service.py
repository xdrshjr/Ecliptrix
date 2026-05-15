"""
Unit tests for PreviewProxyService (spec 06 §四 / phase-3 §3.2.7).

Heavy paths (FFmpeg subprocess, real DB) are mocked. Tests focus on the
contract of ensure_or_enqueue / get_status / progress parsing /
finalize_failure cleanup — i.e. the surface the router and frontend
consume.
"""

from __future__ import annotations

import asyncio
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
# Singleton
# ---------------------------------------------------------------------------


def test_get_preview_proxy_service_returns_singleton():
    pps._preview_proxy_service = None
    a = pps.get_preview_proxy_service()
    b = pps.get_preview_proxy_service()
    assert a is b
