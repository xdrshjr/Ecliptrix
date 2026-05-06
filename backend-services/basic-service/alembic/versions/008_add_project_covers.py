"""Add project_covers table for the per-project Video Cover feature.

Revision ID: 008
Revises: 007
Create Date: 2026-05-07

One row per project (``project_id`` is unique). No DB-level FK to
``video_projects`` — ownership/cascade-delete are enforced at the service
layer (mirrors ``storyboard_packs``). The most recently rendered PNG lives
on disk and its cache-busted URL is written into ``video_projects.cover_url``.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_covers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False, unique=True, index=True),
        sa.Column("user_id", sa.String(36), nullable=False, index=True),
        sa.Column("template_id", sa.String(50), nullable=False),
        sa.Column("cover_config", sa.JSON(), nullable=False),
        sa.Column("image_source", sa.String(20), nullable=False),
        sa.Column("frame_virtual_time_ms", sa.Integer(), nullable=True),
        sa.Column("uploaded_image_url", sa.String(1000), nullable=True),
        sa.Column("aspect_ratio", sa.String(20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_project_covers_user_updated",
        "project_covers",
        ["user_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_covers_user_updated", table_name="project_covers")
    op.drop_table("project_covers")
