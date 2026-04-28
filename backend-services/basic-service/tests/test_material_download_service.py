"""
Unit tests for MaterialDownloadService helpers that don't require the
background event loop / DB. The async lookup_async / enqueue paths are
exercised end-to-end through the router tests in test_material_router.py.
"""

import os

import pytest
from unittest.mock import MagicMock

from app.services.material_download_service import MaterialDownloadService


@pytest.fixture
def svc(tmp_path, monkeypatch):
    """Construct a service rooted at tmp_path so we don't touch real storage.

    The constructor reads `settings.storage.root` for the cache_dir base.
    """
    from app import config

    monkeypatch.setattr(config.settings.storage, "root", str(tmp_path))
    return MaterialDownloadService()


def _row(**kwargs):
    row = MagicMock()
    for k, v in kwargs.items():
        setattr(row, k, v)
    return row


def test_local_url_for_returns_none_when_row_missing(svc):
    assert svc.local_url_for(None) is None


def test_local_url_for_returns_none_when_status_not_ready(svc):
    row = _row(status="pending", local_path="/anything", source="pexels")
    assert svc.local_url_for(row) is None


def test_local_url_for_returns_none_when_local_path_missing(svc):
    row = _row(status="ready", local_path="", source="pexels")
    assert svc.local_url_for(row) is None


def test_local_url_for_returns_none_when_file_does_not_exist(svc, tmp_path):
    row = _row(
        status="ready",
        local_path=str(tmp_path / "nope.mp4"),
        source="pexels",
    )
    assert svc.local_url_for(row) is None


def test_local_url_for_happy_path(svc, tmp_path):
    cached = tmp_path / "cached_materials" / "pexels"
    cached.mkdir(parents=True, exist_ok=True)
    f = cached / "abc-123.mp4"
    f.write_bytes(b"x" * 1024)

    row = _row(status="ready", local_path=str(f), source="pexels")
    url = svc.local_url_for(row)
    assert url == "/api/storage/files/cached_materials/pexels/abc-123.mp4"


def test_local_url_for_falls_back_when_source_blank(svc, tmp_path):
    """Defensive: a row written with source='' (legacy) should still resolve."""
    cached = tmp_path / "cached_materials" / "url"
    cached.mkdir(parents=True, exist_ok=True)
    f = cached / "hash-xyz.mp4"
    f.write_bytes(b"x")

    row = _row(status="ready", local_path=str(f), source="")
    url = svc.local_url_for(row)
    assert url == "/api/storage/files/cached_materials/url/hash-xyz.mp4"
