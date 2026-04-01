"""Add settings persistence tables: model_providers, model_assignments, system_settings, settings_audit_log.

Revision ID: 003
Revises: 002
Create Date: 2026-03-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. model_providers table
    op.create_table(
        "model_providers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("provider_type", sa.String(50), nullable=False),
        sa.Column("api_url", sa.String(500), nullable=False),
        sa.Column("api_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_model_providers_name", "model_providers", ["name"], unique=True)

    # 2. model_assignments table (FK to model_providers)
    op.create_table(
        "model_assignments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("function_type", sa.String(30), unique=True, nullable=False),
        sa.Column("provider_id", UUID(as_uuid=True), sa.ForeignKey("model_providers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model_name", sa.String(200), nullable=False),
        sa.Column("temperature", sa.Float(), server_default="0.7"),
        sa.Column("max_tokens", sa.Integer(), server_default="128000"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_model_assignments_function_type", "model_assignments", ["function_type"], unique=True)

    # 3. system_settings table
    op.create_table(
        "system_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", JSONB(), nullable=False),
        sa.Column("default_value", JSONB(), nullable=False),
        sa.Column("value_type", sa.String(30), server_default="object"),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_by", sa.String(50), nullable=True),
        sa.UniqueConstraint("category", "key", name="uq_system_settings_category_key"),
    )
    op.create_index("ix_system_settings_category", "system_settings", ["category"])

    # 4. settings_audit_log table
    op.create_table(
        "settings_audit_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("setting_type", sa.String(30), nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("key", sa.String(100), nullable=True),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("changed_by", sa.String(50), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_settings_audit_log_changed_at", "settings_audit_log", ["changed_at"])


def downgrade() -> None:
    op.drop_table("settings_audit_log")
    op.drop_table("system_settings")
    op.drop_table("model_assignments")
    op.drop_table("model_providers")
