"""
Database engine, session management, and connection pool for the application.
"""

from typing import AsyncGenerator

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)

# Create async engine
engine = create_async_engine(
    settings.database.url,
    pool_size=settings.database.pool_size,
    max_overflow=settings.database.max_overflow,
    pool_timeout=settings.database.pool_timeout,
    pool_recycle=settings.database.pool_recycle,
    echo=settings.debug
)

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
