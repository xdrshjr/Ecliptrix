"""
Tests for user profile service.

运行测试：
pytest tests/test_user_service.py -v
"""

import pytest
from app.services.user_service import user_service
from app.models.user_models import UserProfileUpdate, UserCreateRequest
from app.models.db_models import User
import bcrypt


async def _create_user(db_session, username="svcuser", email="svc@test.com"):
    """Helper: insert a user and return its string id."""
    password_hash = bcrypt.hashpw("Pass1234!".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user = User(
        username=username,
        email=email,
        password_hash=password_hash,
        is_active=True,
        is_admin=False,
        user_role="regular",
    )
    db_session.add(user)
    await db_session.flush()
    return str(user.id)


@pytest.mark.asyncio
async def test_get_user_profile_by_id(db_session):
    """Test fetching user profile by UUID."""
    user_id = await _create_user(db_session)
    result = await user_service.get_user_profile(db_session, user_id)
    assert result["success"] is True
    assert result["user"]["username"] == "svcuser"


@pytest.mark.asyncio
async def test_get_user_profile_by_username(db_session):
    """Test fetching user profile by username (backward compat)."""
    await _create_user(db_session, username="byname", email="byname@test.com")
    await db_session.flush()
    result = await user_service.get_user_profile(db_session, "byname")
    assert result["success"] is True


@pytest.mark.asyncio
async def test_get_user_profile_not_found(db_session):
    """Test fetching nonexistent user profile."""
    result = await user_service.get_user_profile(db_session, "nonexistent")
    assert result["success"] is False
    assert result["error_code"] == "USER_NOT_FOUND"


@pytest.mark.asyncio
async def test_get_all_users(db_session):
    """Test listing all users."""
    await _create_user(db_session, username="listuser1", email="list1@test.com")
    await _create_user(db_session, username="listuser2", email="list2@test.com")
    await db_session.flush()
    result = await user_service.get_all_users(db_session)
    assert result["success"] is True
    assert result["total_count"] >= 2


@pytest.mark.asyncio
async def test_create_user_admin(db_session):
    """Test admin user creation."""
    user_data = UserCreateRequest(
        username="newadmin",
        email="newadmin@test.com",
        password="Admin1234!",
        is_admin=True,
        user_role="admin",
    )
    result = await user_service.create_user(db_session, user_data)
    assert result["success"] is True
    assert result["user"]["is_admin"] is True


@pytest.mark.asyncio
async def test_delete_user(db_session):
    """Test user deletion."""
    user_id = await _create_user(db_session, username="deluser", email="del@test.com")
    await db_session.flush()
    result = await user_service.delete_user(db_session, user_id)
    assert result["success"] is True

    # Verify user is gone
    get_result = await user_service.get_user_profile(db_session, user_id)
    assert get_result["success"] is False
