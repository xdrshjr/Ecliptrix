"""Seed system_settings with default `rate_limiting` category values.

Adds the 7 rate-limiting config keys (spec/03 §2.1) consumed by the
``RateLimitConfigProvider`` and the admin ``/api/rate-limit/*`` endpoints.

Idempotent: uses INSERT ... ON CONFLICT ON CONSTRAINT
uq_system_settings_category_key DO NOTHING (mirrors migration 004), so it is
safe to run multiple times and compatible with the project's
"alembic + create_all hybrid" startup (create_all builds the table; this
migration only inserts rows).

``downgrade`` deletes ONLY the rate_limiting rows (NOT the whole table) so it
cannot clobber settings seeded by other migrations.

Revision ID: 012
Revises: 011
Create Date: 2026-06-01
"""
from typing import Sequence, Union
import json

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CATEGORY = "rate_limiting"

# Each entry: (key, value, value_type, description).
# `value` and `default_value` are seeded identical (the factory default).
# Keep these in sync with app/config.py RATE_LIMIT_DEFAULTS / RATE_LIMIT_META.
DEFAULT_RATE_LIMIT_SETTINGS = [
    (
        "enabled",
        True,
        "boolean",
        "全局限流开关。关闭后中间件直通,不计数不拦截。",
    ),
    (
        "window_seconds",
        60,
        "number",
        "滑动窗口长度(秒),所有类别共用。范围 10–3600。",
    ),
    (
        "default_per_user_per_min",
        300,
        "number",
        "普通(normal)类别:已登录用户每窗口请求上限。范围 1–100000。",
    ),
    (
        "default_per_ip_per_min",
        300,
        "number",
        "普通(normal)类别:匿名请求按 IP 每窗口请求上限。范围 1–100000。",
    ),
    (
        "ai_generation_per_min",
        30,
        "number",
        "AI/生成类(ai_generation)每窗口请求上限,偏严格。范围 1–100000。",
    ),
    (
        "auth_per_ip_per_min",
        10,
        "number",
        "登录/注册(auth)按 IP 每窗口上限,防爆破。范围 1–100000。",
    ),
    (
        "media_serving_per_min",
        6000,
        "number",
        "媒体服务(media_serving)高额度,避免播放分块请求被误伤。范围 1–1000000。",
    ),
]


def upgrade() -> None:
    """Seed rate_limiting defaults, idempotent via ON CONFLICT DO NOTHING."""
    conn = op.get_bind()

    for key, value, value_type, description in DEFAULT_RATE_LIMIT_SETTINGS:
        value_json = json.dumps(value)
        conn.execute(
            sa.text(
                """
                INSERT INTO system_settings
                    (id, category, key, value, default_value, value_type, description)
                VALUES
                    (gen_random_uuid(), :category, :key,
                     :value::jsonb, :default_value::jsonb, :value_type, :description)
                ON CONFLICT ON CONSTRAINT uq_system_settings_category_key DO NOTHING
                """
            ),
            {
                "category": _CATEGORY,
                "key": key,
                "value": value_json,
                "default_value": value_json,
                "value_type": value_type,
                "description": description,
            },
        )


def downgrade() -> None:
    """Remove ONLY the rate_limiting category rows (never the whole table)."""
    op.execute("DELETE FROM system_settings WHERE category = 'rate_limiting'")
