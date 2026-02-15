"""
Database engine, session management, and connection pool for the application.
"""

from typing import AsyncGenerator

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
    """Initialize database on application startup (auto-create tables + seed admin user)."""
    from app.models.db_models import Base, User
    import bcrypt
    from sqlalchemy import select

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified")

    # Check and create initial admin user
    async with async_session_factory() as session:
        stmt = select(User).where(User.is_admin == True)
        result = await session.execute(stmt)
        admin = result.scalar_one_or_none()

        if not admin:
            password_hash = bcrypt.hashpw(
                settings.auth.admin_password.encode('utf-8'),
                bcrypt.gensalt()
            ).decode('utf-8')

            admin_user = User(
                username=settings.auth.admin_username,
                email=f"{settings.auth.admin_username}@local.dev",
                password_hash=password_hash,
                is_admin=True,
                is_active=True,
                user_role="admin",
                full_name="Administrator"
            )
            session.add(admin_user)
            await session.commit()
            logger.info("Initial admin user created")


async def close_db() -> None:
    """Dispose connection pool on application shutdown."""
    await engine.dispose()
    logger.info("Database connections closed")
