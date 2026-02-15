"""
Tests for authentication service.

运行测试：
pytest tests/test_auth_service.py -v
"""

import pytest
from app.services.auth_service import auth_service
from app.models.auth_models import UserLogin, UserRegistration


@pytest.mark.asyncio
async def test_register_user_success(db_session):
    """Test successful user registration."""
    reg_data = UserRegistration(
        username="testuser",
        email="test@test.com",
        password="Test1234!",
    )
    result = await auth_service.register_user(db_session, reg_data)
    assert result["success"] is True
    assert result["message"] == "用户注册成功"
    assert result["user"] is not None
    assert result["user"].username == "testuser"


@pytest.mark.asyncio
async def test_register_duplicate_username(db_session):
    """Test registration with duplicate username fails."""
    reg_data = UserRegistration(
        username="dupuser",
        email="first@test.com",
        password="Test1234!",
    )
    await auth_service.register_user(db_session, reg_data)
    await db_session.flush()

    reg_data2 = UserRegistration(
        username="dupuser",
        email="second@test.com",
        password="Test1234!",
    )
    result = await auth_service.register_user(db_session, reg_data2)
    assert result["success"] is False
    assert result["error_code"] == "USERNAME_EXISTS"


@pytest.mark.asyncio
async def test_register_duplicate_email(db_session):
    """Test registration with duplicate email fails."""
    reg_data = UserRegistration(
        username="user_a",
        email="same@test.com",
        password="Test1234!",
    )
    await auth_service.register_user(db_session, reg_data)
    await db_session.flush()

    reg_data2 = UserRegistration(
        username="user_b",
        email="same@test.com",
        password="Test1234!",
    )
    result = await auth_service.register_user(db_session, reg_data2)
    assert result["success"] is False
    assert result["error_code"] == "EMAIL_EXISTS"


@pytest.mark.asyncio
async def test_authenticate_user_success(db_session):
    """Test successful authentication."""
    reg_data = UserRegistration(
        username="authtest",
        email="auth@test.com",
        password="Pass1234!",
    )
    await auth_service.register_user(db_session, reg_data)
    await db_session.flush()

    login_data = UserLogin(username="authtest", password="Pass1234!")
    result = await auth_service.authenticate_user(db_session, login_data)
    assert result["success"] is True
    assert result["message"] == "登录成功"
    assert result["user"] is not None


@pytest.mark.asyncio
async def test_authenticate_wrong_password(db_session):
    """Test authentication with wrong password fails."""
    reg_data = UserRegistration(
        username="wrongpass",
        email="wrong@test.com",
        password="Pass1234!",
    )
    await auth_service.register_user(db_session, reg_data)
    await db_session.flush()

    login_data = UserLogin(username="wrongpass", password="WrongPass!")
    result = await auth_service.authenticate_user(db_session, login_data)
    assert result["success"] is False
    assert result["error_code"] == "INVALID_CREDENTIALS"


@pytest.mark.asyncio
async def test_authenticate_nonexistent_user(db_session):
    """Test authentication with nonexistent user fails."""
    login_data = UserLogin(username="ghost", password="Pass1234!")
    result = await auth_service.authenticate_user(db_session, login_data)
    assert result["success"] is False
    assert result["error_code"] == "INVALID_CREDENTIALS"
