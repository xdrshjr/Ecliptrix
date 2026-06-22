"""Regression test for the "保存项目失败" upgrade bug.

An OLDER database (created before the user system was removed in migration 015)
keeps a ``user_id NOT NULL`` column on the business tables. The desktop build
ships no ``alembic/`` directory and only runs ``create_all`` — which never
ALTERs an existing table — so the stale column survived and made every
project / category / cover / pack INSERT fail with
``NOT NULL constraint failed: <table>.user_id`` (surfaced to the UI as
"保存项目失败"). ``init_db()`` now self-heals via
``_drop_residual_user_system``; these tests pin that behaviour.

See docs/diagnoses/new-project-panel-save-and-layout/analysis.md.

Run: pytest tests/test_user_id_self_heal.py -v
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine, AsyncSession

from app.database import _drop_residual_user_system
from app.models.db_models import (
    Base,
    ProjectCover,
    StoryboardPackOwnership,
    VideoProject,
    VideoProjectCategory,
)


# DDL recreating the pre-removal schema: every business table carries
# ``user_id NOT NULL`` plus the indexes that referenced it, and the residual
# ``users`` / ``login_history`` tables still exist. A seed project row proves
# the table rebuild copies existing data forward.
_OLD_SCHEMA_DDL = """
CREATE TABLE video_projects (
    id CHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    category_id CHAR(36),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    cover_url VARCHAR(1000),
    project_data JSON,
    created_at DATETIME,
    updated_at DATETIME,
    last_opened_at DATETIME
);
CREATE INDEX ix_video_projects_user_id ON video_projects (user_id);
CREATE INDEX ix_video_projects_user_updated ON video_projects (user_id, updated_at);
CREATE INDEX ix_video_projects_user_category ON video_projects (user_id, category_id);
CREATE INDEX ix_video_projects_user_lastopened ON video_projects (user_id, last_opened_at);

CREATE TABLE video_project_categories (
    id CHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME,
    updated_at DATETIME
);
CREATE INDEX ix_video_project_categories_user_id ON video_project_categories (user_id);
CREATE INDEX ix_video_project_categories_user_sort ON video_project_categories (user_id, sort_order);

CREATE TABLE storyboard_packs (
    pack_id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    pack_type VARCHAR(32) NOT NULL DEFAULT 'storyboard',
    created_at DATETIME
);
CREATE INDEX ix_storyboard_packs_project_created ON storyboard_packs (project_id, created_at);
CREATE INDEX ix_storyboard_packs_user_project ON storyboard_packs (user_id, project_id);

CREATE TABLE project_covers (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL UNIQUE,
    user_id VARCHAR(36) NOT NULL,
    template_id VARCHAR(50) NOT NULL,
    cover_config JSON NOT NULL,
    image_source VARCHAR(20) NOT NULL,
    frame_virtual_time_ms INTEGER,
    uploaded_image_url VARCHAR(1000),
    aspect_ratio VARCHAR(20) NOT NULL,
    created_at DATETIME,
    updated_at DATETIME
);
CREATE INDEX ix_project_covers_user_id ON project_covers (user_id);
CREATE INDEX ix_project_covers_user_updated ON project_covers (user_id, updated_at);

CREATE TABLE users (id CHAR(36) PRIMARY KEY, username VARCHAR(50) NOT NULL);
CREATE TABLE login_history (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO video_projects (id, user_id, name) VALUES
    ('11111111-1111-1111-1111-111111111111', 'legacy-user', 'Old Project');
"""

_BUSINESS_TABLES = (
    "video_projects",
    "video_project_categories",
    "storyboard_packs",
    "project_covers",
)


@pytest_asyncio.fixture
async def legacy_engine(tmp_path):
    """An async engine over a file-backed SQLite DB seeded with the OLD schema."""
    db_path = (tmp_path / "ecliptrix.db").as_posix()
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", echo=False)
    async with engine.begin() as conn:
        for statement in filter(str.strip, _OLD_SCHEMA_DDL.split(";")):
            await conn.execute(text(statement))
    try:
        yield engine
    finally:
        await engine.dispose()


async def _column_names(conn, table: str) -> set:
    result = await conn.execute(text(f"PRAGMA table_info({table})"))
    return {row[1] for row in result.fetchall()}


async def _run_startup(engine) -> None:
    """Mirror init_db()'s sequence: create_all, then the self-heal step."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_drop_residual_user_system)


@pytest.mark.asyncio
async def test_legacy_insert_fails_before_self_heal(legacy_engine):
    """Sanity: the old schema reproduces the NOT NULL failure (the bug)."""
    factory = async_sessionmaker(legacy_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        session.add(VideoProject(name="New Project"))
        with pytest.raises(IntegrityError):
            await session.flush()


@pytest.mark.asyncio
async def test_self_heal_drops_user_id_and_residual_tables(legacy_engine):
    await _run_startup(legacy_engine)

    async with legacy_engine.begin() as conn:
        for table in _BUSINESS_TABLES:
            assert "user_id" not in await _column_names(conn, table), table
        result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table'")
        )
        tables = {row[0] for row in result.fetchall()}
        assert "users" not in tables
        assert "login_history" not in tables
        # The rebuild must preserve existing rows.
        kept = (await conn.execute(text("SELECT name FROM video_projects"))).fetchall()
        assert kept == [("Old Project",)]


@pytest.mark.asyncio
async def test_create_paths_succeed_after_self_heal(legacy_engine):
    await _run_startup(legacy_engine)

    factory = async_sessionmaker(legacy_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        project_id = uuid.uuid4()
        session.add(VideoProject(id=project_id, name="New Project", description="hi"))
        session.add(VideoProjectCategory(name="Cat"))
        session.add(StoryboardPackOwnership(pack_id="pack-1", project_id=str(project_id)))
        session.add(
            ProjectCover(
                project_id=project_id,
                template_id="t1",
                cover_config={},
                image_source="frame",
                aspect_ratio="16:9",
            )
        )
        await session.commit()  # previously raised IntegrityError -> 500


@pytest.mark.asyncio
async def test_self_heal_is_idempotent(legacy_engine):
    """Re-running startup on an already-cleaned DB is a harmless no-op."""
    await _run_startup(legacy_engine)
    await _run_startup(legacy_engine)  # must not raise

    async with legacy_engine.begin() as conn:
        assert "user_id" not in await _column_names(conn, "video_projects")
