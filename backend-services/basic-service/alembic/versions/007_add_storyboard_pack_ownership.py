"""Add storyboard_packs ownership table — scopes storyboard packs to projects.

Revision ID: 007
Revises: 006
Create Date: 2026-05-07

Stores the (pack_id, project_id, user_id) ownership edge that pre-feature
flat-list storyboard packs lacked. No FK to video_projects: pack rows are
collected inside the project-delete transaction and the on-disk cleanup
runs after commit.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "storyboard_packs",
        sa.Column("pack_id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column(
            "pack_type",
            sa.String(32),
            nullable=False,
            server_default="storyboard",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_storyboard_packs_project_created",
        "storyboard_packs",
        ["project_id", "created_at"],
    )
    op.create_index(
        "ix_storyboard_packs_user_project",
        "storyboard_packs",
        ["user_id", "project_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_storyboard_packs_user_project",
        table_name="storyboard_packs",
    )
    op.drop_index(
        "ix_storyboard_packs_project_created",
        table_name="storyboard_packs",
    )
    op.drop_table("storyboard_packs")
