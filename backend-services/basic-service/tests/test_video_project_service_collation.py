"""
Unit tests for the locale → PG collation resolution helpers (iter10 Bug #5).

These tests focus on the pure logic: prefix extraction and the
collation-resolution algorithm with a mocked pg_collation cache. The COLLATE
behavior itself is exercised against a real PostgreSQL cluster in
integration tests (not run by the SQLite-backed unit suite).
"""
from __future__ import annotations

import pytest

from app.services.video_project_service import (
    _FALLBACK_COLLATION,
    _resolve_collation,
    _resolve_locale_to_prefix,
    _reset_collation_cache_for_tests,
)
from app.services import video_project_service as svc


class _StubDB:
    """Async-DB stand-in. Tests bypass _ensure_collation_cache by pre-seeding
    the module-level cache, so this stub never actually has its execute()
    method called. We provide one anyway to fail loudly if that assumption
    breaks in future."""

    async def execute(self, *args, **kwargs):  # pragma: no cover
        raise AssertionError(
            "_resolve_collation should not hit the DB when the cache is pre-seeded",
        )


@pytest.fixture(autouse=True)
def _reset_cache():
    _reset_collation_cache_for_tests()
    yield
    _reset_collation_cache_for_tests()


# ---------------------------------------------------------------------------
# _resolve_locale_to_prefix
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "header,expected",
    [
        ("en", "en"),
        ("en-US", "en"),
        ("en_US", "en"),
        ("EN-us", "en"),
        ("zh-CN,zh;q=0.9", "zh"),
        ("zh-Hant-TW", "zh"),
        ("fr", "fr"),
        ("fr-CH;q=0.8,de;q=0.6", "fr"),
        ("", None),
        (None, None),
        ("   ", None),
        (";q=0.9", None),
    ],
)
def test_resolve_locale_to_prefix(header, expected):
    assert _resolve_locale_to_prefix(header) == expected


# ---------------------------------------------------------------------------
# _resolve_collation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_collation_returns_fallback_when_only_C_available():
    svc._available_collations = {_FALLBACK_COLLATION}
    db = _StubDB()
    assert await _resolve_collation(db, "en") == _FALLBACK_COLLATION
    assert await _resolve_collation(db, "zh-CN") == _FALLBACK_COLLATION
    assert await _resolve_collation(db, "fr-CH") == _FALLBACK_COLLATION
    assert await _resolve_collation(db, None) == _FALLBACK_COLLATION


@pytest.mark.asyncio
async def test_resolve_collation_picks_locale_when_available():
    svc._available_collations = {
        _FALLBACK_COLLATION,
        "en_US.utf8",
        "zh_CN.utf8",
    }
    db = _StubDB()
    assert await _resolve_collation(db, "en") == "en_US.utf8"
    assert await _resolve_collation(db, "en-US") == "en_US.utf8"
    assert await _resolve_collation(db, "zh-CN,zh;q=0.9") == "zh_CN.utf8"
    # Unwhitelisted locale falls back to C
    assert await _resolve_collation(db, "fr-FR") == _FALLBACK_COLLATION
    # No header → fallback
    assert await _resolve_collation(db, None) == _FALLBACK_COLLATION


@pytest.mark.asyncio
async def test_resolve_collation_falls_back_when_locale_collation_missing():
    # Only en_US is available, but user requests zh-CN.
    svc._available_collations = {_FALLBACK_COLLATION, "en_US.utf8"}
    db = _StubDB()
    assert await _resolve_collation(db, "zh-CN") == _FALLBACK_COLLATION
    # And en still resolves to its locale-specific collation.
    assert await _resolve_collation(db, "en-GB") == "en_US.utf8"
