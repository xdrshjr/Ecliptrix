"""Add is_root column to users and create login_history table.

Revision ID: 002
Revises: 001
Create Date: 2026-03-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add is_root column to users table
    op.add_column(
        "users",
        sa.Column("is_root", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    # Create login_history table
    op.create_table(
        "login_history",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("login_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ip_address", sa.String(50), nullable=True),
        sa.Column("device_info", sa.Text(), nullable=True),
        sa.Column("login_result", sa.String(20), nullable=False),
        sa.Column("failure_reason", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("login_history")
    op.drop_column("users", "is_root")
