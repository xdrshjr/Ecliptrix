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


async def init_db() -> None:
    """Initialize database on application startup (auto-create tables + sync root user)."""
    from app.models.db_models import Base, User
    import bcrypt
    from sqlalchemy import select

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

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

    # Sync root user from .env configuration
    root_username = settings.auth.root_username
    root_password = ***REMOVED***

    async with async_session_factory() as session:
        # Step 1: Find all users with is_root=True
        stmt = select(User).where(User.is_root == True)
        result = await session.execute(stmt)
        root_users = result.scalars().all()

        # Step 2: Handle multiple is_root users (abnormal state) — keep first, demote rest
        if len(root_users) > 1:
            logger.warning(f"Found {len(root_users)} root users, keeping first and demoting others")
            for extra_root in root_users[1:]:
                extra_root.is_root = False
            root_users = [root_users[0]]

        password_hash = bcrypt.hashpw(
            root_password.encode('utf-8'),
            bcrypt.gensalt()
        ).decode('utf-8')

        if root_users:
            # Step 3a: Root user exists — sync username, password, and flags
            root_user = root_users[0]
            if root_user.username != root_username:
                logger.info(f"Syncing root username: {root_user.username} -> {root_username}")
                root_user.username = root_username
            root_user.password_hash = password_hash
            root_user.is_admin = True
            root_user.is_active = True
            root_user.user_role = "admin"
            logger.info("Root user synced from .env configuration")
        else:
            # Step 3b: No root user exists — check if username is already taken
            existing_stmt = select(User).where(User.username == root_username)
            existing_result = await session.execute(existing_stmt)
            existing_user = existing_result.scalar_one_or_none()

            if existing_user:
                # Promote existing user to root
                existing_user.is_root = True
                existing_user.is_admin = True
                existing_user.is_active = True
                existing_user.user_role = "admin"
                existing_user.password_hash = password_hash
                logger.info(f"Existing user '{root_username}' promoted to root")
            else:
                # Create new root user
                root_user = User(
                    username=root_username,
                    email=f"{root_username}@local.dev",
                    password_hash=password_hash,
                    is_root=True,
                    is_admin=True,
                    is_active=True,
                    user_role="admin",
                    full_name="Root Administrator"
                )
                session.add(root_user)
                logger.info(f"Root user '{root_username}' created")

        await session.commit()


async def close_db() -> None:
    """Dispose connection pool on application shutdown."""
    await engine.dispose()
    logger.info("Database connections closed")
