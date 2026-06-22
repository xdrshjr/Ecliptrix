"""
Database engine, session management, and connection pool for the application.
"""

from typing import AsyncGenerator

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)


def _install_sqlite_pg_type_shims() -> None:
    """Teach SQLAlchemy to render ``postgresql.UUID``/``JSONB`` on SQLite.

    Desktop mode (docs/plans/desktop-electron-packaging) runs the production
    code path against ``sqlite+aiosqlite``, but the ORM declares
    PostgreSQL-native column types which SQLite cannot compile. These are the
    same dialect-scoped shims ``tests/conftest.py`` installs for the test
    suite: ``@compiles(<type>, "sqlite")`` affects ONLY the SQLite dialect
    compiler, so PostgreSQL keeps its native rendering. Safe to call more
    than once — ``@compiles`` simply re-registers the same handler.
    """
    from sqlalchemy.ext.compiler import compiles
    from sqlalchemy.dialects.postgresql import UUID as PG_UUID
    from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB

    @compiles(PG_UUID, "sqlite")
    def _compile_pg_uuid_sqlite(element, compiler, **kw):  # noqa: ANN001
        # 36-char canonical UUID string storage on SQLite.
        return "CHAR(36)"

    @compiles(PG_JSONB, "sqlite")
    def _compile_pg_jsonb_sqlite(element, compiler, **kw):  # noqa: ANN001
        # JSONB has no SQLite equivalent; store as TEXT-backed JSON.
        return "JSON"


def _create_engine():
    """Build the async engine with dialect-appropriate parameters.

    SQLite (desktop mode, spec §2.4) has no server-side connection pool, so
    the QueuePool-only kwargs are dropped. WAL journaling plus a busy
    timeout keep the rate-limit middleware's frequent writes from raising
    "database is locked", and ``foreign_keys=ON`` restores the FK
    enforcement PostgreSQL applies by default.
    """
    if settings.database.url.startswith("sqlite"):
        _install_sqlite_pg_type_shims()
        sqlite_engine = create_async_engine(
            settings.database.url,
            echo=settings.debug
        )

        @sa.event.listens_for(sqlite_engine.sync_engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection, _connection_record):  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return sqlite_engine

    return create_async_engine(
        settings.database.url,
        pool_size=settings.database.pool_size,
        max_overflow=settings.database.max_overflow,
        pool_timeout=settings.database.pool_timeout,
        pool_recycle=settings.database.pool_recycle,
        echo=settings.debug
    )


# Create async engine
engine = _create_engine()

# Create async session factory
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that provides a database session with auto-commit/rollback."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# Business tables whose obsolete ``user_id`` ownership column (and every index
# referencing it) must be stripped on startup when an OLDER database — created
# before the user system was removed (migration 015) — is opened by the current
# code. ``create_all`` only creates missing tables, it never ALTERs an existing
# one, so the stale ``user_id NOT NULL`` column survives and makes every INSERT
# fail. The desktop build ships no ``alembic/`` directory (it relies solely on
# ``create_all``), so this self-heal has to live in application code.
_USER_OWNED_TABLES = (
    "video_projects",
    "video_project_categories",
    "storyboard_packs",
    "project_covers",
)

# Residual user-system tables to drop entirely. Child before parent:
# ``login_history.user_id`` references ``users.id``.
_USER_SYSTEM_TABLES = ("login_history", "users")


def _drop_residual_user_system(sync_conn) -> None:
    """Strip the obsolete ``user_id`` column / user-system tables from an upgraded DB.

    Idempotent self-heal that mirrors migration ``015_drop_user_system`` but
    runs from application code because the desktop build ships no ``alembic/``
    directory and only ever runs ``create_all`` (which never drops a column).
    For each business table we act *only* when the inspector still reports a
    ``user_id`` column, so a fresh database — built by ``create_all`` from the
    current user-less models — is left untouched and re-running on an
    already-cleaned database is a no-op.

    ``batch_alter_table(recreate="always")`` rebuilds the table: older SQLite
    has no native ``DROP COLUMN`` and the ``user_id`` columns carry indexes that
    must be dropped first, otherwise SQLite's table rebuild would re-emit an
    index referencing the now-missing column and fail with "no such column".
    On PostgreSQL the same body runs as plain ``ALTER TABLE``.
    """
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    inspector = sa.inspect(sync_conn)
    existing_tables = set(inspector.get_table_names())
    op = Operations(MigrationContext.configure(sync_conn))

    for table in _USER_OWNED_TABLES:
        if table not in existing_tables:
            continue
        column_names = {col["name"] for col in inspector.get_columns(table)}
        if "user_id" not in column_names:
            continue

        # Discover the actual indexes that reference user_id (the implicit
        # ``ix_<table>_user_id`` from ``index=True`` plus named composite
        # indexes) — drop_index raises on an unknown name, so blind drops are
        # unsafe; the inspector keeps this robust across DBs.
        stale_indexes = [
            index["name"]
            for index in inspector.get_indexes(table)
            if "user_id" in (index.get("column_names") or [])
        ]
        row_count = sync_conn.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar()
        logger.warning(
            "Legacy schema detected: dropping residual 'user_id' column from "
            "'%s' (rebuilding %s row(s))",
            table,
            row_count,
        )
        with op.batch_alter_table(table, recreate="always") as batch_op:
            for index_name in stale_indexes:
                batch_op.drop_index(index_name)
            batch_op.drop_column("user_id")

    for table in _USER_SYSTEM_TABLES:
        if table in existing_tables:
            logger.warning("Legacy schema detected: dropping obsolete table '%s'", table)
            op.drop_table(table)


async def init_db() -> None:
    """Initialize database on application startup (auto-create tables)."""
    from app.models.db_models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Self-heal an OLDER database created before the user system was removed:
        # create_all never drops the obsolete ``user_id NOT NULL`` column, so an
        # upgraded DB would fail every project/category/cover/pack INSERT. The
        # guard makes this a no-op on fresh or already-cleaned databases.
        await conn.run_sync(_drop_residual_user_system)

        # Ensure api_format column exists on model_providers (added in migration 005).
        # IF NOT EXISTS keeps the transaction healthy on re-runs — a raised
        # DuplicateColumn here would abort the txn and silently roll back create_all.
        # PostgreSQL-only: `ADD COLUMN IF NOT EXISTS` is PG syntax, and on
        # SQLite (desktop mode, spec §2.4) create_all has just emitted the
        # column anyway, so the backfill is unnecessary there.
        if engine.dialect.name == "postgresql":
            await conn.execute(sa.text(
                "ALTER TABLE model_providers ADD COLUMN IF NOT EXISTS api_format VARCHAR(20) NOT NULL DEFAULT 'auto'"
            ))

    logger.info("Database tables created/verified")


async def close_db() -> None:
    """Dispose connection pool on application shutdown."""
    await engine.dispose()
    logger.info("Database connections closed")
