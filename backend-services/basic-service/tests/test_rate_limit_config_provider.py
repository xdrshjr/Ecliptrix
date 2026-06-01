"""
Unit tests for ``RateLimitConfigProvider`` (spec 03 §2.3).

Covers:
  * TTL cache hit ⇒ NO DB I/O (load count does not grow within the TTL).
  * ``invalidate()`` ⇒ immediate re-read on next ``get_config()``.
  * TTL expiry ⇒ refresh from DB.
  * Missing key ⇒ falls back to the config.py default.
  * DB error ⇒ degrades to last-good cache / all-defaults, NEVER raises.
  * ``window_seconds`` and the 5 limit keys parse correctly from DB rows.
  * ``build_config_from_values`` defensive coercion.

DB access path: the provider's ``_load_from_db`` imports
``app.database.async_session_factory`` lazily, so we patch THAT symbol to point
at an in-memory SQLite engine (a single-connection ``StaticPool`` so the
``:memory:`` DB persists across the provider's session opens).

The JSONB columns on ``SystemSetting`` create on SQLite because the root
``tests/conftest.py`` registers a dialect-scoped ``@compiles(JSONB, "sqlite")``
shim.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app import database as database_module
from app.config import RATE_LIMIT_DEFAULTS
from app.models.db_models import Base, SystemSetting
from app.services import rate_limit_config as cfg_module
from app.services.rate_limit_config import (
    DEFAULT_CONFIG,
    RATE_LIMIT_CATEGORY,
    RateLimitConfigProvider,
    build_config_from_values,
)


pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Fixtures: in-memory SQLite SystemSetting table + patched session factory
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def session_factory():
    """StaticPool single-connection in-memory SQLite so :memory: persists."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        yield factory
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def patched_db(monkeypatch, session_factory):
    """Point the provider's lazily-imported session factory at the test DB."""
    monkeypatch.setattr(database_module, "async_session_factory", session_factory)
    return session_factory


async def _seed(factory, **values):
    """Insert rate_limiting SystemSetting rows from a flat key->value dict."""
    async with factory() as session:
        for key, value in values.items():
            session.add(
                SystemSetting(
                    category=RATE_LIMIT_CATEGORY,
                    key=key,
                    value=value,
                    default_value=value,
                    value_type="number" if not isinstance(value, bool) else "boolean",
                    description="",
                )
            )
        await session.commit()


# ---------------------------------------------------------------------------
# DB read: keys parse correctly
# ---------------------------------------------------------------------------
async def test_reads_all_keys_from_db(patched_db):
    await _seed(
        patched_db,
        enabled=True,
        window_seconds=120,
        default_per_user_per_min=111,
        default_per_ip_per_min=222,
        ai_generation_per_min=33,
        auth_per_ip_per_min=9,
        media_serving_per_min=5000,
    )
    provider = RateLimitConfigProvider(ttl_seconds=5.0)
    cfg = await provider.get_config()
    assert cfg.enabled is True
    assert cfg.window_seconds == 120
    assert cfg.limits.normal_user == 111
    assert cfg.limits.normal_ip == 222
    assert cfg.limits.ai_generation == 33
    assert cfg.limits.auth_ip == 9
    assert cfg.limits.media_serving == 5000


async def test_window_seconds_parses(patched_db):
    await _seed(patched_db, window_seconds=300)
    provider = RateLimitConfigProvider(ttl_seconds=5.0)
    cfg = await provider.get_config()
    assert cfg.window_seconds == 300


# ---------------------------------------------------------------------------
# Missing key → config.py default
# ---------------------------------------------------------------------------
async def test_missing_key_falls_back_to_default(patched_db):
    # Only seed ONE key; the rest must come from RATE_LIMIT_DEFAULTS.
    await _seed(patched_db, ai_generation_per_min=42)
    provider = RateLimitConfigProvider(ttl_seconds=5.0)
    cfg = await provider.get_config()
    assert cfg.limits.ai_generation == 42  # from DB
    assert cfg.limits.normal_user == RATE_LIMIT_DEFAULTS["default_per_user_per_min"]
    assert cfg.window_seconds == RATE_LIMIT_DEFAULTS["window_seconds"]
    assert cfg.enabled == RATE_LIMIT_DEFAULTS["enabled"]


async def test_empty_db_is_all_defaults(patched_db):
    provider = RateLimitConfigProvider(ttl_seconds=5.0)
    cfg = await provider.get_config()
    assert cfg == DEFAULT_CONFIG


# ---------------------------------------------------------------------------
# TTL cache hit: no DB I/O within the TTL
# ---------------------------------------------------------------------------
async def test_cache_hit_does_no_db_io(patched_db, monkeypatch):
    await _seed(patched_db, ai_generation_per_min=50)
    provider = RateLimitConfigProvider(ttl_seconds=30.0)

    load_calls = {"n": 0}
    real_load = provider._load_from_db

    async def counting_load():
        load_calls["n"] += 1
        return await real_load()

    monkeypatch.setattr(provider, "_load_from_db", counting_load)

    # 5 reads within the TTL → exactly ONE DB load.
    for _ in range(5):
        cfg = await provider.get_config()
        assert cfg.limits.ai_generation == 50
    assert load_calls["n"] == 1


# ---------------------------------------------------------------------------
# invalidate() → immediate re-read
# ---------------------------------------------------------------------------
async def test_invalidate_forces_reread(patched_db, monkeypatch):
    await _seed(patched_db, ai_generation_per_min=10)
    provider = RateLimitConfigProvider(ttl_seconds=30.0)

    load_calls = {"n": 0}
    real_load = provider._load_from_db

    async def counting_load():
        load_calls["n"] += 1
        return await real_load()

    monkeypatch.setattr(provider, "_load_from_db", counting_load)

    first = await provider.get_config()
    assert first.limits.ai_generation == 10
    assert load_calls["n"] == 1

    # Mutate the DB then invalidate → next get_config re-reads the new value.
    async with patched_db() as session:
        from sqlalchemy import select

        row = (
            await session.execute(
                select(SystemSetting).where(
                    SystemSetting.key == "ai_generation_per_min"
                )
            )
        ).scalar_one()
        row.value = 99
        await session.commit()

    provider.invalidate()
    second = await provider.get_config()
    assert second.limits.ai_generation == 99
    assert load_calls["n"] == 2


# ---------------------------------------------------------------------------
# TTL expiry → refresh
# ---------------------------------------------------------------------------
async def test_ttl_expiry_refreshes(patched_db, monkeypatch):
    await _seed(patched_db, ai_generation_per_min=10)
    provider = RateLimitConfigProvider(ttl_seconds=10.0)

    load_calls = {"n": 0}
    real_load = provider._load_from_db

    async def counting_load():
        load_calls["n"] += 1
        return await real_load()

    monkeypatch.setattr(provider, "_load_from_db", counting_load)

    # Drive a fake monotonic clock so we don't sleep for real.
    clock = {"t": 1000.0}
    monkeypatch.setattr(cfg_module.time, "monotonic", lambda: clock["t"])

    await provider.get_config()
    assert load_calls["n"] == 1

    # Still within TTL → no reload.
    clock["t"] += 5
    await provider.get_config()
    assert load_calls["n"] == 1

    # Past TTL → reload.
    clock["t"] += 10
    await provider.get_config()
    assert load_calls["n"] == 2


# ---------------------------------------------------------------------------
# DB error → degrade, never raise
# ---------------------------------------------------------------------------
async def test_db_error_degrades_to_defaults_without_raising(monkeypatch):
    # Point at a session factory that raises on use → exercise the except branch.
    def broken_factory(*_a, **_kw):
        raise RuntimeError("simulated DB outage")

    monkeypatch.setattr(database_module, "async_session_factory", broken_factory)

    provider = RateLimitConfigProvider(ttl_seconds=5.0)
    # Must NOT raise; degrades to all-defaults.
    cfg = await provider.get_config()
    assert cfg == DEFAULT_CONFIG


async def test_db_error_after_ttl_expiry_keeps_last_good_cache(patched_db, monkeypatch):
    """On a TTL-driven refresh that fails, the provider must keep serving the
    last good cache (NOT null it) — a transient DB blip can't drop live config.

    Note: this is the TTL-expiry path. ``invalidate()`` deliberately drops the
    cache to None (so a forced re-read on a broken DB degrades to all-defaults);
    that distinct behaviour is covered by
    ``test_db_error_degrades_to_defaults_without_raising``.
    """
    await _seed(patched_db, ai_generation_per_min=77)
    provider = RateLimitConfigProvider(ttl_seconds=10.0)

    clock = {"t": 1000.0}
    monkeypatch.setattr(cfg_module.time, "monotonic", lambda: clock["t"])

    good = await provider.get_config()
    assert good.limits.ai_generation == 77

    # Break the DB, then advance past the TTL so the next get_config refreshes.
    def broken_factory(*_a, **_kw):
        raise RuntimeError("simulated DB outage")

    monkeypatch.setattr(database_module, "async_session_factory", broken_factory)
    clock["t"] += 20  # past TTL → refresh attempt → fails → keep last good
    degraded = await provider.get_config()
    assert degraded.limits.ai_generation == 77


# ---------------------------------------------------------------------------
# build_config_from_values coercion
# ---------------------------------------------------------------------------
def test_build_config_coerces_garbage_to_defaults():
    cfg = build_config_from_values(
        {
            "ai_generation_per_min": "not-a-number",
            "window_seconds": None,
            "enabled": "true",
        }
    )
    assert cfg.limits.ai_generation == RATE_LIMIT_DEFAULTS["ai_generation_per_min"]
    assert cfg.window_seconds == RATE_LIMIT_DEFAULTS["window_seconds"]
    assert cfg.enabled is True  # string "true" → True


def test_build_config_all_missing_is_defaults():
    cfg = build_config_from_values({})
    assert cfg == DEFAULT_CONFIG


def test_build_config_enabled_false_string():
    cfg = build_config_from_values({"enabled": "false"})
    assert cfg.enabled is False


async def test_prewarm_populates_cache(patched_db):
    await _seed(patched_db, ai_generation_per_min=21)
    provider = RateLimitConfigProvider(ttl_seconds=30.0)
    warmed = await provider.prewarm()
    assert warmed.limits.ai_generation == 21
    # A subsequent read is served from cache (same object identity).
    again = await provider.get_config()
    assert again is warmed
