"""Add api_format column to model_providers table.

Stores the API format preference per provider: 'auto' (default), 'openai', or 'anthropic'.
When 'auto', the format is inferred from provider_type at runtime.

Revision ID: 005
Revises: 004
Create Date: 2026-04-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "model_providers",
        sa.Column("api_format", sa.String(20), server_default="auto", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("model_providers", "api_format")
