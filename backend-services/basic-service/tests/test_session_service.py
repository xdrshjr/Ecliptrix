"""
Tests for session management service.

运行测试：
pytest tests/test_session_service.py -v
"""

import pytest
from app.services.session_service import session_service
from app.models.db_models import User
import bcrypt


async def _create_test_user(db_session, username="sessionuser", email="session@test.com"):
    """Helper to create a test user and return its ID."""
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
async def test_create_session_success(db_session):
    """Test successful session creation."""
    user_id = await _create_test_user(db_session)
    result = await session_service.create_session(
        db=db_session,
        user_id=user_id,
        device_info="Mozilla/5.0 Test",
        ip_address="127.0.0.1",
    )
    assert result["success"] is True
    assert "session_token" in result
    assert len(result["session_token"]) > 0


@pytest.mark.asyncio
async def test_validate_session_valid(db_session):
    """Test validating a valid session."""
    user_id = await _create_test_user(db_session, username="valuser", email="val@test.com")
    create_result = await session_service.create_session(
        db=db_session,
        user_id=user_id,
    )
    token = create_result["session_token"]
    await db_session.flush()

    result = await session_service.validate_session(
        db=db_session,
        user_id=user_id,
        session_token=token,
    )
    assert result["success"] is True
    assert result["valid"] is True


@pytest.mark.asyncio
async def test_validate_session_wrong_token(db_session):
    """Test validation with wrong token (simulating another device login)."""
    user_id = await _create_test_user(db_session, username="tokenuser", email="token@test.com")
    await session_service.create_session(db=db_session, user_id=user_id)
    await db_session.flush()

    result = await session_service.validate_session(
        db=db_session,
        user_id=user_id,
        session_token="wrong_token_value",
    )
    assert result["valid"] is False
    assert "另一台设备" in result["reason"]


@pytest.mark.asyncio
async def test_validate_session_nonexistent_user(db_session):
    """Test validation for a nonexistent user."""
    result = await session_service.validate_session(
        db=db_session,
        user_id="00000000-0000-0000-0000-000000000000",
        session_token="any_token",
    )
    assert result["valid"] is False
    assert result["reason"] == "用户不存在"


@pytest.mark.asyncio
async def test_invalidate_session(db_session):
    """Test session invalidation (logout)."""
    user_id = await _create_test_user(db_session, username="logoutuser", email="logout@test.com")
    create_result = await session_service.create_session(db=db_session, user_id=user_id)
    token = create_result["session_token"]
    await db_session.flush()

    inv_result = await session_service.invalidate_session(db=db_session, user_id=user_id)
    assert inv_result["success"] is True
    assert inv_result["message"] == "会话已注销"

    # After invalidation the token should no longer be valid
    val_result = await session_service.validate_session(
        db=db_session,
        user_id=user_id,
        session_token=token,
    )
    assert val_result["valid"] is False


def test_generate_session_token():
    """Test that token generation produces unique tokens."""
    token1 = session_service._generate_session_token()
    token2 = session_service._generate_session_token()
    assert len(token1) > 0
    assert len(token2) > 0
    assert token1 != token2
