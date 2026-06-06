"""
SQLite dialect compatibility tests for desktop (Electron) mode.

Desktop packaging (docs/plans/desktop-electron-packaging, spec §2.4 / §6.3)
points ``DATABASE_URL`` at ``sqlite+aiosqlite`` and relies on the production
``init_db()`` path — ``Base.metadata.create_all`` + root user seeding —
instead of alembic. These tests pin the dialect behaviours that path
depends on:

1. ``_create_engine()`` builds a SQLite engine (no QueuePool-only kwargs)
   with WAL / busy_timeout / foreign_keys pragmas applied per connection.
2. ``init_db()`` completes on SQLite: the PG-only ``ALTER TABLE ... IF NOT
   EXISTS`` backfill is skipped (dialect guard), create_all already emits
   the ``api_format`` column the backfill would have added, and the root
   user is seeded. Re-running stays idempotent.
3. ``ensure_defaults_seeded()`` takes the SQLite upsert branch for both the
   first insert and the subsequent default-value refresh.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import database
from app.models.db_models import Base, SystemSetting, User


def _sqlite_url(tmp_path) -> str:
    """File-backed SQLite URL — WAL mode is a no-op on :memory: databases."""
    return "sqlite+aiosqlite:///" + (tmp_path / "desktop.db").as_posix()


@pytest_asyncio.fixture
async def sqlite_engine(tmp_path, monkeypatch):
    """Production-path SQLite engine built by ``database._create_engine()``."""
    monkeypatch.setattr(database.settings.database, "url", _sqlite_url(tmp_path))
    engine = database._create_engine()
    yield engine
    await engine.dispose()


class TestSqliteEngineFactory:
    @pytest.mark.asyncio
    async def test_sqlite_engine_applies_wal_and_pragmas(self, sqlite_engine):
        async with sqlite_engine.connect() as conn:
            journal_mode = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
            busy_timeout = (await conn.execute(text("PRAGMA busy_timeout"))).scalar()
            foreign_keys = (await conn.execute(text("PRAGMA foreign_keys"))).scalar()

        assert journal_mode == "wal"
        assert busy_timeout == 5000
        assert foreign_keys == 1

    @pytest.mark.asyncio
    async def test_create_all_on_sqlite_emits_api_format_column(self, sqlite_engine):
        """create_all must already include the column the PG backfill adds."""
        async with sqlite_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            rows = (await conn.execute(text("PRAGMA table_info(model_providers)"))).fetchall()

        column_names = {row[1] for row in rows}
        assert "api_format" in column_names


class TestInitDbOnSqlite:
    @pytest.mark.asyncio
    async def test_init_db_succeeds_and_seeds_root_user(self, sqlite_engine, monkeypatch):
        session_factory = async_sessionmaker(
            sqlite_engine, class_=AsyncSession, expire_on_commit=False
        )
        monkeypatch.setattr(database, "engine", sqlite_engine)
        monkeypatch.setattr(database, "async_session_factory", session_factory)

        # Exercises the dialect guard: on SQLite the PG-only ALTER is skipped,
        # so a raised OperationalError here would be a regression.
        await database.init_db()

        async with session_factory() as session:
            result = await session.execute(select(User).where(User.is_root == True))  # noqa: E712
            root_user = result.scalar_one()

        assert root_user.username == database.settings.auth.root_username
        assert root_user.is_admin is True
        assert root_user.is_active is True

    @pytest.mark.asyncio
    async def test_init_db_is_idempotent_on_sqlite(self, sqlite_engine, monkeypatch):
        session_factory = async_sessionmaker(
            sqlite_engine, class_=AsyncSession, expire_on_commit=False
        )
        monkeypatch.setattr(database, "engine", sqlite_engine)
        monkeypatch.setattr(database, "async_session_factory", session_factory)

        await database.init_db()
        await database.init_db()  # second run must not raise nor duplicate root

        async with session_factory() as session:
            result = await session.execute(select(User).where(User.is_root == True))  # noqa: E712
            assert len(result.scalars().all()) == 1

    @pytest.mark.asyncio
    async def test_init_db_pg_only_alter_fails_without_guard(self, tmp_path):
        """Anti-regression: the raw PG ALTER genuinely errors on SQLite.

        Proves the dialect guard in ``init_db()`` is load-bearing rather
        than decorative — if someone removes it, the statement below is what
        ``init_db()`` would execute, and it must fail on SQLite.
        """
        engine = create_async_engine(_sqlite_url(tmp_path))
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            with pytest.raises(Exception):
                async with engine.begin() as conn:
                    await conn.execute(text(
                        "ALTER TABLE model_providers ADD COLUMN IF NOT EXISTS "
                        "api_format VARCHAR(20) NOT NULL DEFAULT 'auto'"
                    ))
        finally:
            await engine.dispose()


class TestSystemSettingsSeedingOnSqlite:
    @pytest_asyncio.fixture
    async def seeding_service(self, sqlite_engine, monkeypatch):
        """SystemSettingsService wired to the SQLite engine."""
        from app.services import system_settings_service as sss_module

        async with sqlite_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(
            sqlite_engine, class_=AsyncSession, expire_on_commit=False
        )
        # The service imports async_session_factory by name, so patch the
        # module-level binding, not app.database.
        monkeypatch.setattr(sss_module, "async_session_factory", session_factory)
        yield sss_module.SystemSettingsService(), session_factory

    @pytest.mark.asyncio
    async def test_ensure_defaults_seeded_inserts_then_updates(self, seeding_service):
        service, session_factory = seeding_service

        inserted_first = await service.ensure_defaults_seeded()
        assert inserted_first > 0

        # Simulate a stale default from an older version, then re-seed:
        # the SQLite update branch must refresh default_value while leaving
        # the user-configured value untouched.
        async with session_factory() as session:
            result = await session.execute(select(SystemSetting))
            sample = result.scalars().first()
            assert sample is not None
            original_default = sample.default_value
            sample.default_value = {"stale": True}
            sample.value = {"user": "configured"}
            sample_id = sample.id
            await session.commit()

        inserted_second = await service.ensure_defaults_seeded()
        assert inserted_second == 0  # nothing new — update branch only

        async with session_factory() as session:
            refreshed = await session.get(SystemSetting, sample_id)
            assert refreshed.default_value == original_default
            assert refreshed.value == {"user": "configured"}
