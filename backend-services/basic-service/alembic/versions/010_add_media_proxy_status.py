"""Add media-proxy status fields to cached_materials (spec 05 §六).

Revision ID: 010
Revises: 009
Create Date: 2026-05-15

Adds three columns used by the new ``/api/media/proxy`` endpoint to track
hot-cache state for assets that pass through the same-origin streaming
proxy:

* ``proxy_status``  — ``absent`` / ``partial`` / ``cached`` / ``error``
* ``proxy_bytes_cached`` — bytes successfully written to the hot cache
* ``proxy_last_updated`` — last write timestamp

All columns are nullable with a safe default so historical rows continue
to validate. Spec 06's preview-proxy migration (revision 011) targets
the same table and chains its ``down_revision`` to this one — see
master-plan §0.2 N3.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cached_materials",
        sa.Column(
            "proxy_status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'absent'"),
        ),
    )
    op.add_column(
        "cached_materials",
        sa.Column(
            "proxy_bytes_cached",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "cached_materials",
        sa.Column(
            "proxy_last_updated",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("cached_materials", "proxy_last_updated")
    op.drop_column("cached_materials", "proxy_bytes_cached")
    op.drop_column("cached_materials", "proxy_status")
