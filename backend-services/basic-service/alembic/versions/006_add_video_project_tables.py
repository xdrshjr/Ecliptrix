"""Add video project tables (categories + projects) for the per-user
project-list landing on the Video Editing tab.

Revision ID: 006
Revises: 005
Create Date: 2026-04-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "video_project_categories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False, index=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_video_project_categories_user_sort",
        "video_project_categories",
        ["user_id", "sort_order"],
    )

    op.create_table(
        "video_projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False, index=True),
        sa.Column("category_id", UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cover_url", sa.String(1000), nullable=True),
        sa.Column("project_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_video_projects_user_updated",
        "video_projects",
        ["user_id", "updated_at"],
    )
    op.create_index(
        "ix_video_projects_user_category",
        "video_projects",
        ["user_id", "category_id"],
    )
    op.create_index(
        "ix_video_projects_user_lastopened",
        "video_projects",
        ["user_id", "last_opened_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_video_projects_user_lastopened", table_name="video_projects")
    op.drop_index("ix_video_projects_user_category", table_name="video_projects")
    op.drop_index("ix_video_projects_user_updated", table_name="video_projects")
    op.drop_table("video_projects")

    op.drop_index(
        "ix_video_project_categories_user_sort",
        table_name="video_project_categories",
    )
    op.drop_table("video_project_categories")
