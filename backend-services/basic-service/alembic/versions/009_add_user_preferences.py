"""Add preferences JSON column to users for self-service settings.

Revision ID: 009
Revises: 008
Create Date: 2026-05-09

Backs the new GET/PATCH /api/user/me/preferences endpoint. Plain JSON
(not JSONB) for portability with the SQLite test harness; matches the
existing ``AgentWorkflow.workflow_data`` and ``SystemSetting.value``
column types. ``server_default`` ensures historical rows are valid
immediately after upgrade.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "preferences",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "preferences")
