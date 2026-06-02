"""Drop the legacy ``agent_workflows`` table.

The workflow feature (visual node editor, client-side executor, intent
detection) was removed from the product. Its only persistence was the
``agent_workflows`` table created in migration 001. This migration drops it.

``downgrade`` recreates the table with the same shape as 001 (so a rollback
restores a structurally identical, empty table). No data is preserved on
downgrade — the rows were workflow definitions that are obsolete once the
feature is gone.

Compatible with the project's "alembic + create_all hybrid" startup: the
``AgentWorkflow`` ORM model was also removed, so ``Base.metadata.create_all``
no longer recreates the table on boot.

Revision ID: 013
Revises: 012
Create Date: 2026-06-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("agent_workflows")


def downgrade() -> None:
    op.create_table(
        "agent_workflows",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.String(36), index=True),
        sa.Column("workflow_name", sa.String(200), nullable=False),
        sa.Column("workflow_data", sa.JSON(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_template", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
