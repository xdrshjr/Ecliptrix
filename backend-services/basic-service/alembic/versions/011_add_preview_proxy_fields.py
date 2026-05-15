"""Add preview-proxy fields to cached_materials (spec 06 §六).

Revision ID: 011
Revises: 010
Create Date: 2026-05-16

Adds nine columns used by the new ``/api/media/preview-proxy`` endpoint to
track FFmpeg low-bitrate transcode state for hi-bitrate / 4K assets:

* ``preview_proxy_status`` — ``absent`` / ``queued`` / ``running`` / ``cached`` / ``failed``
* ``preview_proxy_profile`` — current ladder (first phase: ``preview-480p``)
* ``preview_proxy_local_url`` — same-origin path under STORAGE_ROOT
* ``preview_proxy_oss_url`` — optional CDN URL when OSS is enabled
* ``preview_proxy_progress`` — 0..100 transcode progress
* ``preview_proxy_bytes`` — output size in bytes
* ``preview_proxy_duration_sec`` — output duration
* ``preview_proxy_last_error`` — last failure message (FFmpeg stderr tail)
* ``preview_proxy_transcoded_at`` — completion timestamp

Per phase-3 spec §6.1: all columns nullable / have defaults so backfill
is unnecessary. Chains ``down_revision="010"``.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cached_materials",
        sa.Column(
            "preview_proxy_status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'absent'"),
        ),
    )
    op.add_column(
        "cached_materials",
        sa.Column("preview_proxy_profile", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "cached_materials",
        sa.Column("preview_proxy_local_url", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "cached_materials",
        sa.Column("preview_proxy_oss_url", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "cached_materials",
        sa.Column(
            "preview_proxy_progress",
            sa.SmallInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "cached_materials",
        sa.Column("preview_proxy_bytes", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "cached_materials",
        sa.Column("preview_proxy_duration_sec", sa.Float(), nullable=True),
    )
    op.add_column(
        "cached_materials",
        sa.Column("preview_proxy_last_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "cached_materials",
        sa.Column(
            "preview_proxy_transcoded_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("cached_materials", "preview_proxy_transcoded_at")
    op.drop_column("cached_materials", "preview_proxy_last_error")
    op.drop_column("cached_materials", "preview_proxy_duration_sec")
    op.drop_column("cached_materials", "preview_proxy_bytes")
    op.drop_column("cached_materials", "preview_proxy_progress")
    op.drop_column("cached_materials", "preview_proxy_oss_url")
    op.drop_column("cached_materials", "preview_proxy_local_url")
    op.drop_column("cached_materials", "preview_proxy_profile")
    op.drop_column("cached_materials", "preview_proxy_status")
