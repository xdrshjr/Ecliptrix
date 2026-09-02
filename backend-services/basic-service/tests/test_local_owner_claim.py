"""
Regression tests for ``database._claim_ownership_for_local_owner``.

This is the replacement for the old ``test_user_id_self_heal`` suite. The user
system is gone, so a legacy database still carries rows tagged with the removed
root account's UUID; startup must re-tag them for the single local owner
WITHOUT dropping anything. Two production incidents (``docs/diagnoses``, the
``user_id`` self-heal series) began in this function's ancestor emitting
destructive DDL, so the "no DROP" assertion below is load-bearing.

Pins:
  1. A row minted by the old user system is claimed on startup.
  2. A second startup matches zero rows (idempotent).
  3. Startup emits NO ``DROP`` of any kind.
  4. A database whose ``user_id`` column was dropped by a broken build gets the
     column AND its indexes back, and its rows stay queryable.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import database
from app.constants import LOCAL_OWNER_ID
from app.models.db_models import Base


LEGACY_OWNER_ID = "9f3d1c62-0000-4000-8000-abcdefabcdef"
LEGACY_PROJECT_ID = "11111111-1111-1111-1111-111111111111"

_USER_INDEXES = {
    "video_projects": {
        "ix_video_projects_user_id",
        "ix_video_projects_user_updated",
        "ix_video_projects_user_category",
        "ix_video_projects_user_lastopened",
    },
    "video_project_categories": {
        "ix_video_project_categories_user_id",
        "ix_video_project_categories_user_sort",
    },
    "storyboard_packs": {"ix_storyboard_packs_user_project"},
    "project_covers": {
        "ix_project_covers_user_id",
        "ix_project_covers_user_updated",
    },
}


def _sqlite_url(tmp_path) -> str:
    return "sqlite+aiosqlite:///" + (tmp_path / "legacy.db").as_posix()


@pytest_asyncio.fixture
async def wired_engine(tmp_path, monkeypatch):
    """A file-backed SQLite engine wired in as ``database.engine``."""
    monkeypatch.setattr(database.settings.database, "url", _sqlite_url(tmp_path))
    engine = database._create_engine()
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(
        database,
        "async_session_factory",
        async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False),
    )
    try:
        yield engine
    finally:
        await engine.dispose()


async def _insert_legacy_project(engine, owner: str = LEGACY_OWNER_ID) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text(
                "INSERT INTO video_projects (id, user_id, name) "
                "VALUES (:id, :owner, 'Legacy Project')"
            ),
            {"id": LEGACY_PROJECT_ID, "owner": owner},
        )


async def _owner_of_legacy_project(engine) -> str:
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT user_id FROM video_projects WHERE id = :id"),
            {"id": LEGACY_PROJECT_ID},
        )
        return result.scalar_one()


@pytest.mark.asyncio
async def test_legacy_row_is_claimed_for_the_local_owner(wired_engine):
    """A project owned by the removed root account becomes visible again."""
    await _insert_legacy_project(wired_engine)

    await database.init_db()

    assert await _owner_of_legacy_project(wired_engine) == LOCAL_OWNER_ID


@pytest.mark.asyncio
async def test_second_startup_claims_nothing(wired_engine, caplog):
    """The claim is idempotent — a second run matches zero rows."""
    await _insert_legacy_project(wired_engine)
    await database.init_db()

    caplog.clear()
    with caplog.at_level("INFO"):
        await database.init_db()

    assert not [r for r in caplog.records if "Claimed" in r.getMessage()]
    assert await _owner_of_legacy_project(wired_engine) == LOCAL_OWNER_ID


@pytest.mark.asyncio
async def test_startup_never_emits_a_drop(wired_engine, monkeypatch):
    """Startup must not run DROP TABLE / DROP COLUMN / DROP INDEX.

    Both ``user_id`` self-heal incidents started with a startup path that
    "repaired" the schema destructively. Collect every statement the sync
    connection executes and assert none of them drops anything.
    """
    import sqlalchemy as sa

    await _insert_legacy_project(wired_engine)

    executed: list[str] = []
    original_execute = sa.Connection.execute

    def _recording_execute(self, statement, *args, **kwargs):
        executed.append(str(statement))
        return original_execute(self, statement, *args, **kwargs)

    monkeypatch.setattr(sa.Connection, "execute", _recording_execute)
    await database.init_db()

    assert executed, "expected the startup path to execute SQL"
    offenders = [sql for sql in executed if "DROP" in sql.upper()]
    assert not offenders, f"startup emitted destructive DDL: {offenders}"


@pytest.mark.asyncio
async def test_dropped_ownership_column_is_restored_with_its_indexes(wired_engine):
    """A database damaged by a previously shipped build heals on startup."""
    await _insert_legacy_project(wired_engine)

    async with wired_engine.begin() as conn:
        for indexes in _USER_INDEXES.values():
            for index in indexes:
                await conn.execute(text(f'DROP INDEX IF EXISTS "{index}"'))
        for table in _USER_INDEXES:
            await conn.execute(text(f'ALTER TABLE "{table}" DROP COLUMN user_id'))

    await database.init_db()

    async with wired_engine.begin() as conn:
        # Simulate an interruption after the column came back but before every
        # index did; the next startup must heal the partial state too.
        await conn.execute(text("DROP INDEX ix_video_projects_user_id"))
    await database.init_db()

    assert await _owner_of_legacy_project(wired_engine) == LOCAL_OWNER_ID

    async with wired_engine.connect() as conn:
        for table, expected in _USER_INDEXES.items():
            columns = (
                await conn.execute(text(f"PRAGMA table_info({table})"))
            ).fetchall()
            user_id_column = next(row for row in columns if row[1] == "user_id")
            assert user_id_column[3] == 1, f"{table}.user_id must stay NOT NULL"

            indexes = (
                await conn.execute(text(f"PRAGMA index_list({table})"))
            ).fetchall()
            assert expected.issubset({row[1] for row in indexes}), table


@pytest.mark.asyncio
async def test_legacy_user_tables_are_left_untouched(wired_engine):
    """``users`` / ``login_history`` rows in an old database survive startup.

    D3: the models are gone but the tables are deliberately NOT dropped —
    ``create_all`` only creates. They become inert data, not deleted data.
    """
    await _insert_legacy_project(wired_engine)
    async with wired_engine.begin() as conn:
        await conn.execute(text("CREATE TABLE users (id TEXT PRIMARY KEY)"))
        await conn.execute(
            text("INSERT INTO users (id) VALUES (:id)"), {"id": LEGACY_OWNER_ID}
        )

    await database.init_db()

    async with wired_engine.connect() as conn:
        survivors = (await conn.execute(text("SELECT id FROM users"))).fetchall()
    assert [row[0] for row in survivors] == [LEGACY_OWNER_ID]
