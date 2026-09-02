"""
SQLite dialect compatibility tests.

The desktop build points ``DATABASE_URL`` at ``sqlite+aiosqlite`` and relies on
the production ``init_db()`` path — ``Base.metadata.create_all`` — instead of a
migration tool. These tests pin the dialect behaviours that path depends on:

1. ``_create_engine()`` builds a SQLite engine (no QueuePool-only kwargs) with
   WAL / busy_timeout / foreign_keys pragmas applied per connection.
2. ``_resolve_database_url()`` rewrites a leftover server-era PostgreSQL DSN
   rather than letting the process die on a driver error.
3. ``init_db()`` completes on SQLite and stays idempotent.
4. ``ensure_defaults_seeded()`` takes the SQLite upsert branch for both the
   first insert and the subsequent default-value refresh.

Legacy-row claiming lives in ``tests/test_local_owner_claim.py``.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import database
from app.models.db_models import Base, SystemSetting


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
        """create_all must emit every column; there is no backfill any more."""
        async with sqlite_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            rows = (await conn.execute(text("PRAGMA table_info(model_providers)"))).fetchall()

        column_names = {row[1] for row in rows}
        assert "api_format" in column_names

    def test_sqlite_url_is_passed_through(self, tmp_path, monkeypatch):
        url = _sqlite_url(tmp_path)
        monkeypatch.setattr(database.settings.database, "url", url)
        assert database._resolve_database_url() == url

    def test_legacy_postgres_url_falls_back_to_sqlite(self, monkeypatch):
        """A stale server-era DSN must not take the app down on startup.

        ``env.template`` shipped ``DATABASE_URL=postgresql+asyncpg://...`` for
        the whole server era, so plenty of installs still carry it. There is no
        PostgreSQL on a desktop machine, so honouring it would only produce a
        driver error nobody can act on.
        """
        monkeypatch.setattr(
            database.settings.database,
            "url",
            "postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix",
        )
        resolved = database._resolve_database_url()
        assert resolved.startswith("sqlite")


class TestInitDbOnSqlite:
    @pytest.mark.asyncio
    async def test_init_db_creates_the_full_schema(self, sqlite_engine, monkeypatch):
        session_factory = async_sessionmaker(
            sqlite_engine, class_=AsyncSession, expire_on_commit=False
        )
        monkeypatch.setattr(database, "engine", sqlite_engine)
        monkeypatch.setattr(database, "async_session_factory", session_factory)

        await database.init_db()

        async with sqlite_engine.connect() as conn:
            for table in (
                "video_projects",
                "video_project_categories",
                "storyboard_packs",
                "project_covers",
            ):
                columns = (await conn.execute(text(f"PRAGMA table_info({table})"))).fetchall()
                assert "user_id" in {row[1] for row in columns}, table

    @pytest.mark.asyncio
    async def test_init_db_does_not_create_the_removed_user_tables(
        self, sqlite_engine, monkeypatch
    ):
        """``users`` / ``login_history`` left the ORM; create_all must not make them.

        (An EXISTING database keeps its own copies — see
        ``test_local_owner_claim.test_legacy_user_tables_are_left_untouched``.)
        """
        session_factory = async_sessionmaker(
            sqlite_engine, class_=AsyncSession, expire_on_commit=False
        )
        monkeypatch.setattr(database, "engine", sqlite_engine)
        monkeypatch.setattr(database, "async_session_factory", session_factory)

        await database.init_db()

        async with sqlite_engine.connect() as conn:
            rows = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            )
            tables = {row[0] for row in rows.fetchall()}

        assert "users" not in tables
        assert "login_history" not in tables

    @pytest.mark.asyncio
    async def test_init_db_is_idempotent_on_sqlite(self, sqlite_engine, monkeypatch):
        session_factory = async_sessionmaker(
            sqlite_engine, class_=AsyncSession, expire_on_commit=False
        )
        monkeypatch.setattr(database, "engine", sqlite_engine)
        monkeypatch.setattr(database, "async_session_factory", session_factory)

        await database.init_db()
        await database.init_db()  # second run must not raise

        async with sqlite_engine.connect() as conn:
            rows = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            )
            assert "video_projects" in {row[0] for row in rows.fetchall()}


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
