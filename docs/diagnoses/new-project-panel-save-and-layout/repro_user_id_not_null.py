"""Minimal reproduction for Bug #1: "保存项目失败" (save project failed).

Demonstrates the root cause without needing the full backend/Postgres:

  1. A pre-existing SQLite DB (created by an OLDER app build) has a
     ``video_projects`` table WITH ``user_id VARCHAR(36) NOT NULL``.
  2. The NEW ORM model (post user-system removal) has NO ``user_id``.
  3. ``init_db()`` runs ``Base.metadata.create_all`` — which SKIPS the
     already-existing table and therefore NEVER drops the stale column.
  4. ``create_project()`` issues an INSERT without ``user_id`` →
     ``IntegrityError: NOT NULL constraint failed: video_projects.user_id``.

This is the exact failure path that surfaces to the UI as a 500, which the
frontend maps to the toast ``t.videoProjects.saveError`` = "保存项目失败".

Run:  python repro_user_id_not_null.py
"""

import sqlite3
import tempfile
import uuid
from pathlib import Path

from sqlalchemy import (
    Column,
    DateTime,
    JSON,
    String,
    Text,
    create_engine,
    func,
    inspect,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Session


def make_old_database(db_path: str) -> None:
    """Simulate a DB created by the OLD build (user system still present)."""
    con = sqlite3.connect(db_path)
    con.executescript(
        """
        CREATE TABLE video_projects (
            id CHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,        -- the stale ownership column
            category_id CHAR(36),
            name VARCHAR(200) NOT NULL,
            description TEXT,
            cover_url VARCHAR(1000),
            project_data JSON,
            created_at DATETIME,
            updated_at DATETIME,
            last_opened_at DATETIME
        );
        """
    )
    con.commit()
    con.close()


class Base(DeclarativeBase):
    pass


class VideoProject(Base):
    """Mirror of the WORKING-TREE model (app/models/db_models.py) — no user_id."""

    __tablename__ = "video_projects"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category_id = Column(String(36), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    cover_url = Column(String(1000), nullable=True)
    project_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
    last_opened_at = Column(DateTime(timezone=True), nullable=True)


def main() -> int:
    tmp = tempfile.mkdtemp()
    db_path = str(Path(tmp) / "ecliptrix.db")
    make_old_database(db_path)

    engine = create_engine(f"sqlite:///{db_path}")

    # Step 3: init_db() -> create_all. Existing table is skipped, NOT altered.
    Base.metadata.create_all(engine)
    cols = [c["name"] for c in inspect(engine).get_columns("video_projects")]
    print("columns after create_all:", cols)
    assert "user_id" in cols, "expected stale user_id column to survive create_all"
    print("-> create_all did NOT drop the stale 'user_id' column (as expected)\n")

    # Step 4: create_project() -> INSERT without user_id.
    with Session(engine) as session:
        session.add(VideoProject(name="My Project", description="hello"))
        try:
            session.flush()
            print("INSERT succeeded — bug NOT reproduced (fresh-schema DB?)")
            return 1
        except IntegrityError as exc:
            print("INSERT failed with IntegrityError (bug reproduced):")
            print("   ", str(exc.orig))
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
