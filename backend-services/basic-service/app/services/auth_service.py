"""
Authentication service for user login and management.
Uses SQLAlchemy async operations on the User model.
"""

import bcrypt
import hmac
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID as PyUUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.models.db_models import User, LoginHistory
from app.config import settings
from app.logger import get_logger
from app.models.auth_models import UserLogin, UserInfo, UserRegistration
from app.services.session_service import session_service

logger = get_logger(__name__)


class AuthService:
    """Service for handling user authentication with SQLAlchemy."""

    def __init__(self):
        """Initialize authentication service."""
        logger.info("Authentication service initialized (SQLAlchemy mode)")

    def _hash_password(self, password: str) -> str:
        """Hash password using bcrypt."""
        try:
            salt = bcrypt.gensalt()
            hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
            return hashed.decode('utf-8')
        except Exception as e:
            logger.error(f"Password hashing failed: {str(e)}")
            raise

    def _verify_password(self, password: str, hashed_password: str) -> bool:
        """Verify password against hash."""
        try:
            return bcrypt.checkpw(password.encode('utf-8'), hashed_password.encode('utf-8'))
        except Exception as e:
            logger.error(f"Password verification failed: {str(e)}")
            return False

    def _user_to_info(self, user: User) -> UserInfo:
        """Convert a User ORM object to a UserInfo Pydantic model."""
        return UserInfo(
            id=str(user.id),
            username=user.username,
            email=user.email,
            full_name=user.full_name,
            avatar_url=user.avatar_url,
            is_active=user.is_active,
            is_admin=user.is_admin,
            is_root=user.is_root,
            user_role=user.user_role or "regular",
            created_at=user.created_at,
            updated_at=user.updated_at,
            last_login_at=user.last_login_at
        )

    async def _record_login_history(
        self,
        db: AsyncSession,
        user_id,
        ip_address: Optional[str],
        device_info: Optional[str],
        login_result: str,
        failure_reason: Optional[str] = None
    ) -> None:
        """Record a login attempt in the login_history table.

        Uses an independent database session so that the record is always
        persisted, even when the caller's transaction is later rolled back
        (e.g. HTTPException on failed login causes get_db_session to rollback).
        """
        try:
            from app.database import async_session_factory
            async with async_session_factory() as independent_session:
                record = LoginHistory(
                    user_id=user_id,
                    ip_address=ip_address,
                    device_info=device_info,
                    login_result=login_result,
                    failure_reason=failure_reason
                )
                independent_session.add(record)
                await independent_session.commit()
        except Exception as e:
            logger.warning(f"Failed to record login history: {str(e)}")

    async def authenticate_user(
        self,
        db: AsyncSession,
        login_data: UserLogin,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Authenticate user with username and password.

        Args:
            db: AsyncSession for database operations
            login_data: User login credentials
            device_info: Device information (User-Agent)
            ip_address: IP address of the client

        Returns:
            Dict containing authentication result
        """
        try:
            logger.info("User login authentication started", {
                "username": login_data.username,
                "device_info": device_info[:100] if device_info else None,
                "ip_address": ip_address,
                "timestamp": datetime.now().isoformat()
            })

            # Query user from database
            stmt = (
                select(User)
                .where(User.username == login_data.username, User.is_active == True)
            )
            result = await db.execute(stmt)
            user = result.scalar_one_or_none()

            if not user:
                logger.warning("User not found or disabled", {
                    "username": login_data.username,
                    "query_result": "no_user_found"
                })
                # Cannot record login history without a user_id
                return {
                    "success": False,
                    "message": "用户名或密码错误",
                    "error_code": "INVALID_CREDENTIALS"
                }

            logger.info("User query successful", {
                "username": login_data.username,
                "user_id": str(user.id),
                "is_admin": user.is_admin,
                "is_root": user.is_root,
                "user_role": user.user_role
            })

            # Verify password — root user always authenticates against .env value (single source of truth)
            if user.is_root:
                # For root user, compare input password directly against .env ROOT_PASSWORD
                # using constant-time comparison to prevent timing attacks.
                password_valid = hmac.compare_digest(
                    login_data.password.encode('utf-8'),
                    ***REMOVED***.encode('utf-8')
                )
            else:
                password_valid = self._verify_password(login_data.password, user.password_hash)

            if not password_valid:
                logger.warning("Password verification failed", {
                    "username": login_data.username,
                    "user_id": str(user.id)
                })
                await self._record_login_history(
                    db=db, user_id=user.id, ip_address=ip_address,
                    device_info=device_info, login_result="failed",
                    failure_reason="invalid_password"
                )
                return {
                    "success": False,
                    "message": "用户名或密码错误",
                    "error_code": "INVALID_CREDENTIALS"
                }

            # Create new session (same db session for transaction consistency)
            session_result = await session_service.create_session(
                db=db,
                user_id=str(user.id),
                device_info=device_info,
                ip_address=ip_address
            )

            if not session_result.get("success"):
                logger.error("Session creation failed", {
                    "user_id": str(user.id),
                    "username": login_data.username,
                    "error": session_result.get("message")
                })
                session_token = None
            else:
                session_token = session_result.get("session_token")
                logger.info("User session created successfully", {
                    "user_id": str(user.id),
                    "username": login_data.username
                })

            # Update last login time
            try:
                now = datetime.now()
                update_stmt = (
                    update(User)
                    .where(User.id == user.id)
                    .values(last_login_at=now)
                )
                await db.execute(update_stmt)
                logger.info("Updated user last login time", {
                    "user_id": str(user.id),
                    "username": login_data.username
                })
            except Exception as update_error:
                logger.warning(f"Failed to update last login time: {str(update_error)}")

            # Refresh user object to avoid MissingGreenlet on lazy-loaded attributes
            await db.refresh(user)

            # Record successful login history
            await self._record_login_history(
                db=db, user_id=user.id, ip_address=ip_address,
                device_info=device_info, login_result="success"
            )

            # Create user info object
            user_info = UserInfo(
                id=str(user.id),
                username=user.username,
                email=user.email,
                full_name=user.full_name,
                avatar_url=user.avatar_url,
                is_active=user.is_active,
                is_admin=user.is_admin,
                is_root=user.is_root,
                user_role=user.user_role or "regular",
                created_at=user.created_at,
                updated_at=user.updated_at,
                last_login_at=datetime.now()
            )

            logger.info("User authentication successful", {
                "username": login_data.username,
                "user_id": str(user.id),
                "is_admin": user_info.is_admin,
                "is_root": user_info.is_root,
                "user_role": user_info.user_role,
                "has_session_token": session_token is not None,
                "login_time": datetime.now().isoformat()
            })

            return {
                "success": True,
                "message": "登录成功",
                "user": user_info,
                "session_token": session_token
            }

        except Exception as e:
            error_msg = str(e)
            logger.error(f"User authentication exception: {type(e).__name__}: {error_msg}")
            return {
                "success": False,
                "message": "认证服务异常",
                "error_code": "AUTHENTICATION_ERROR",
                "error_details": {"error": error_msg}
            }

    async def register_user(
        self,
        db: AsyncSession,
        registration_data: UserRegistration
    ) -> Dict[str, Any]:
        """
        Register a new user with invite code validation.

        Args:
            db: AsyncSession for database operations
            registration_data: User registration data

        Returns:
            Dict containing registration result
        """
        try:
            logger.info("User registration started", {
                "username": registration_data.username,
                "email": registration_data.email,
                "timestamp": datetime.now().isoformat()
            })

            # Validate invite code
            configured_invite_code = settings.auth.invite_code
            if not configured_invite_code:
                logger.warning("Registration rejected: invite code not configured (registration closed)")
                return {
                    "success": False,
                    "message": "注册功能已关闭",
                    "error_code": "REGISTRATION_CLOSED"
                }

            if registration_data.invite_code != configured_invite_code:
                logger.warning("Registration rejected: invalid invite code", {
                    "username": registration_data.username,
                })
                return {
                    "success": False,
                    "message": "邀请码无效",
                    "error_code": "INVALID_INVITE_CODE"
                }

            # Check if username already exists
            username_stmt = select(User.id).where(User.username == registration_data.username)
            username_result = await db.execute(username_stmt)
            if username_result.scalar_one_or_none() is not None:
                logger.warning("Username already exists", {"username": registration_data.username})
                return {
                    "success": False,
                    "message": "用户名已存在",
                    "error_code": "USERNAME_EXISTS"
                }

            # Check if email already exists
            email_stmt = select(User.id).where(User.email == registration_data.email)
            email_result = await db.execute(email_stmt)
            if email_result.scalar_one_or_none() is not None:
                logger.warning("Email already exists", {"email": registration_data.email})
                return {
                    "success": False,
                    "message": "邮箱已存在",
                    "error_code": "EMAIL_EXISTS"
                }

            # Hash password
            password_hash = self._hash_password(registration_data.password)

            # Create new user
            new_user = User(
                username=registration_data.username,
                email=registration_data.email,
                password_hash=password_hash,
                full_name=registration_data.full_name,
                is_active=True,
                is_admin=False,
                user_role="regular"
            )
            db.add(new_user)
            await db.flush()

            # Create user info object
            user_info = self._user_to_info(new_user)

            logger.info("User registration successful", {
                "username": registration_data.username,
                "user_id": str(new_user.id),
                "email": registration_data.email,
                "user_role": user_info.user_role
            })

            return {
                "success": True,
                "message": "用户注册成功",
                "user": user_info
            }

        except Exception as e:
            error_msg = str(e)
            logger.error("User registration exception", {
                "username": registration_data.username,
                "email": registration_data.email,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "注册服务异常",
                "error_code": "REGISTRATION_ERROR",
                "error_details": {"error": error_msg}
            }

    async def get_user_by_id(
        self,
        db: AsyncSession,
        user_id: str
    ) -> Optional[UserInfo]:
        """
        Get user information by ID.

        Args:
            db: AsyncSession for database operations
            user_id: User ID

        Returns:
            UserInfo object or None if not found
        """
        try:
            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id

            stmt = select(User).where(User.id == user_uuid, User.is_active == True)
            result = await db.execute(stmt)
            user = result.scalar_one_or_none()

            if not user:
                return None

            return self._user_to_info(user)

        except Exception as e:
            logger.error(f"Get user by ID exception: {str(e)}", {"user_id": user_id})
            return None

    async def health_check(self, db: AsyncSession) -> Dict[str, Any]:
        """Check authentication service health."""
        try:
            stmt = select(User.id).limit(1)
            await db.execute(stmt)

            return {
                "service": "AuthService",
                "status": "healthy",
                "message": "认证服务运行正常",
                "users_table_accessible": True
            }

        except Exception as e:
            logger.error("Authentication service health check failed", {"error": str(e)})
            return {
                "service": "AuthService",
                "status": "unhealthy",
                "message": f"数据库连接测试失败: {str(e)}"
            }


# Global auth service instance
auth_service = AuthService()
