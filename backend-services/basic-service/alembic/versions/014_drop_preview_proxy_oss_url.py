"""Drop the ``preview_proxy_oss_url`` column from cached_materials.

The Alibaba Cloud OSS ("upload to server") integration was removed now that
Ecliptrix ships as a self-contained local desktop app: preview-proxy
transcodes are served exclusively via the same-origin
``preview_proxy_local_url``, so the optional CDN mirror column added in
migration 011 is dead. This migration drops it.

``downgrade`` re-adds the nullable column with its original shape (mirrors
migration 011) so a rollback restores a structurally identical, always-NULL
column.

Uses ``op.batch_alter_table`` so the DDL also works on SQLite < 3.35 (which
predates native ``DROP COLUMN``); on PostgreSQL it is equivalent to a bare
``ALTER TABLE ... DROP COLUMN``. Desktop/test environments use
``Base.metadata.create_all`` and never run this migration — it exists to keep
historical PostgreSQL deployments aligned with the ORM model.

Revision ID: 014
Revises: 013
Create Date: 2026-06-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cached_materials") as batch:
        batch.drop_column("preview_proxy_oss_url")


def downgrade() -> None:
    with op.batch_alter_table("cached_materials") as batch:
        batch.add_column(
            sa.Column("preview_proxy_oss_url", sa.String(length=1024), nullable=True)
        )
