"""
Tests for database infrastructure.

运行测试：
pytest tests/test_database.py -v
"""

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_database_session_creation(db_session):
    """Verify db session can be created and used."""
    assert db_session is not None


@pytest.mark.asyncio
async def test_create_tables(db_session):
    """Verify tables exist after creation."""
    result = await db_session.execute(
        text("SELECT name FROM sqlite_master WHERE type='table'")
    )
    tables = [row[0] for row in result.fetchall()]
    assert "users" in tables
    assert "agent_workflows" in tables


@pytest.mark.asyncio
async def test_user_table_columns(db_session):
    """Verify users table has expected columns."""
    result = await db_session.execute(text("PRAGMA table_info(users)"))
    columns = {row[1] for row in result.fetchall()}
    expected = {
        "id", "username", "email", "password_hash", "full_name",
        "avatar_url", "is_active", "is_admin", "user_role",
        "created_at", "updated_at", "last_login_at",
        "active_session_token", "session_created_at",
        "session_device_info", "session_ip_address",
    }
    for col in expected:
        assert col in columns, f"Missing column: {col}"


@pytest.mark.asyncio
async def test_agent_workflows_table_columns(db_session):
    """Verify agent_workflows table has expected columns."""
    result = await db_session.execute(text("PRAGMA table_info(agent_workflows)"))
    columns = {row[1] for row in result.fetchall()}
    expected = {
        "id", "user_id", "workflow_name", "workflow_data",
        "description", "is_template", "created_at", "updated_at",
    }
    for col in expected:
        assert col in columns, f"Missing column: {col}"
