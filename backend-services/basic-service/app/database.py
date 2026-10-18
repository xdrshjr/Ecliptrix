"""
Database engine, session management, and connection pool for the application.
"""

from typing import AsyncGenerator

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.config import DatabaseConfig, settings
from app.constants import LOCAL_OWNER_ID
from app.logger import get_logger

logger = get_logger(__name__)


_OWNED_TABLES = (
    "video_projects",
    "video_project_categories",
    "storyboard_packs",
    "project_covers",
)


def _install_sqlite_pg_type_shims() -> None:
    """Teach SQLAlchemy to render ``postgresql.UUID``/``JSONB`` on SQLite.

    The ORM declares PostgreSQL-native column types which SQLite cannot
    compile. These are the same dialect-scoped shims ``tests/conftest.py``
    installs for the test suite: ``@compiles(<type>, "sqlite")`` affects ONLY
    the SQLite dialect compiler. Safe to call more than once — ``@compiles``
    simply re-registers the same handler.
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


def _resolve_database_url() -> str:
    """Return a SQLite URL, rewriting a leftover server-era DSN.

    The desktop build ships SQLite only. Installs that predate
    `desktop-only-refactor` still carry ``DATABASE_URL=postgresql+asyncpg://...``
    in their ``.env`` (that is what the old template shipped), and there is no
    PostgreSQL on the machine to connect to — so honouring it would only crash
    at startup with a driver error nobody can act on. Fall back loudly instead.
    """
    url = settings.database.url
    if url.startswith("sqlite"):
        return url

    fallback = DatabaseConfig.model_fields["url"].default
    logger.warning(
        "Ignoring non-SQLite DATABASE_URL (%s); the desktop build is "
        "SQLite-only. Falling back to %s — remove DATABASE_URL from your "
        ".env to silence this.",
        url.split("://", 1)[0],
        fallback,
    )
    return fallback


def _create_engine():
    """Build the async engine for the bundled SQLite database.

    The desktop build ships SQLite only, so there is no server-side pool to
    size. WAL journaling plus a busy timeout keep concurrent writers from
    raising "database is locked", and ``foreign_keys=ON`` restores the FK
    enforcement the ORM assumes.
    """
    _install_sqlite_pg_type_shims()
    sqlite_engine = create_async_engine(
        _resolve_database_url(),
        echo=settings.debug, hide_parameters=True
    )

    @sa.event.listens_for(sqlite_engine.sync_engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return sqlite_engine


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


def _claim_ownership_for_local_owner(
    sync_connection: sa.Connection, metadata: sa.MetaData
) -> None:
    """Make every legacy row visible to the single local owner.

    Runs on every startup, three fixed steps per table: add the ownership
    column back if a previously shipped build dropped it, re-create the
    indexes that vanished with it, then re-tag rows still carrying an id
    minted by the removed user system.

    Idempotent (a second run adds nothing and matches zero rows) and
    non-destructive: the only DDL it may emit is ADD COLUMN. Never emit
    DROP / ALTER ... DROP here — both ``user_id`` self-heal incidents in
    ``docs/diagnoses`` started in this function's ancestor.
    """
    if sync_connection.dialect.name != "sqlite":
        return

    inspector = sa.inspect(sync_connection)
    existing_tables = set(inspector.get_table_names())

    for table_name in _OWNED_TABLES:
        if table_name not in existing_tables:
            continue

        columns = {c["name"] for c in inspector.get_columns(table_name)}
        if "user_id" not in columns:
            # SQLite requires a constant default when adding a NOT NULL
            # column to a populated table; LOCAL_OWNER_ID is that constant.
            # It is a literal defined in this repo, never a value from .env,
            # config or a request — nothing else may be interpolated here.
            sync_connection.execute(sa.text(
                f'ALTER TABLE "{table_name}" ADD COLUMN user_id VARCHAR(36) '
                f"NOT NULL DEFAULT '{LOCAL_OWNER_ID}'"
            ))
            logger.warning(
                "Restored missing ownership column on %s", table_name
            )

        # The indexes went away with the column, and create_all will not
        # bring them back on a table that already exists.
        for index in metadata.tables[table_name].indexes:
            if any(column.name == "user_id" for column in index.columns):
                index.create(sync_connection, checkfirst=True)

        result = sync_connection.execute(
            sa.text(
                f'UPDATE "{table_name}" SET user_id = :owner '
                "WHERE user_id <> :owner"
            ),
            {"owner": LOCAL_OWNER_ID},
        )
        if result.rowcount:
            logger.info(
                "Claimed %s legacy row(s) in %s for the local owner",
                result.rowcount,
                table_name,
            )


async def init_db() -> None:
    """Create the schema and claim legacy rows for the local owner."""
    from app.models.research_db_models import ResearchArtifact  # noqa: F401
    from app.models.agent_toolkit_db_models import (  # noqa: F401
        AgentDocument, AgentMemory,
    )
    from app.models.db_models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database tables created/verified")

    async with engine.begin() as conn:
        await conn.run_sync(_claim_ownership_for_local_owner, Base.metadata)


async def close_db() -> None:
    """Dispose connection pool on application shutdown."""
    await engine.dispose()
    logger.info("Database connections closed")
