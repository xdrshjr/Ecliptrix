"""
Session management service for single-device login functionality.
Uses SQLAlchemy async operations on the User model.
"""

import secrets
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID as PyUUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.models.db_models import User
from app.logger import get_logger

logger = get_logger(__name__)


class SessionService:
    """Service for managing user sessions and single-device login."""

    def __init__(self):
        """Initialize session service."""
        logger.info("Session service initialized (SQLAlchemy mode)")

    def _generate_session_token(self) -> str:
        """
        Generate a secure random session token.

        Returns:
            str: A cryptographically secure random token
        """
        token = secrets.token_urlsafe(32)
        logger.debug("Generated new session token", {"token_length": len(token)})
        return token

    async def create_session(
        self,
        db: AsyncSession,
        user_id: str,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new session for a user, invalidating any existing sessions.

        Args:
            db: AsyncSession for database operations
            user_id: User ID
            device_info: Device information (User-Agent)
            ip_address: IP address of the client

        Returns:
            Dict containing session creation result
        """
        try:
            logger.info("Creating new user session", {
                "user_id": user_id,
                "device_info": device_info[:100] if device_info else None,
                "ip_address": ip_address,
                "timestamp": datetime.now().isoformat()
            })

            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id
            session_token = self._generate_session_token()
            now = datetime.now()

            stmt = (
                update(User)
                .where(User.id == user_uuid)
                .values(
                    active_session_token=session_token,
                    session_created_at=now,
                    session_device_info=device_info,
                    session_ip_address=ip_address
                )
            )
            result = await db.execute(stmt)

            if result.rowcount == 0:
                logger.error("Session creation failed: user not found", {
                    "user_id": user_id
                })
                return {
                    "success": False,
                    "message": "Session creation failed: user not found",
                    "error_code": "SESSION_CREATION_FAILED"
                }

            logger.info("User session created successfully", {
                "user_id": user_id,
                "session_created_at": now.isoformat(),
                "device_info": device_info[:100] if device_info else None,
                "ip_address": ip_address
            })

            return {
                "success": True,
                "message": "会话创建成功",
                "session_token": session_token
            }

        except Exception as e:
            error_msg = str(e)
            logger.error("Session creation exception", {
                "user_id": user_id,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "会话创建异常",
                "error_code": "SESSION_ERROR",
                "error_details": {"error": error_msg}
            }

    async def validate_session(
        self,
        db: AsyncSession,
        user_id: str,
        session_token: str
    ) -> Dict[str, Any]:
        """
        Validate if a session token is currently active for a user.

        Args:
            db: AsyncSession for database operations
            user_id: User ID
            session_token: Session token to validate

        Returns:
            Dict containing validation result
        """
        try:
            logger.debug("Validating user session", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })

            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id

            stmt = select(
                User.active_session_token,
                User.session_created_at,
                User.is_active
            ).where(User.id == user_uuid)
            result = await db.execute(stmt)
            row = result.one_or_none()

            if not row:
                logger.warning("Session validation failed: user not found", {
                    "user_id": user_id
                })
                return {
                    "success": True,
                    "valid": False,
                    "reason": "用户不存在"
                }

            if not row.is_active:
                logger.warning("Session validation failed: user disabled", {
                    "user_id": user_id
                })
                return {
                    "success": True,
                    "valid": False,
                    "reason": "用户已被禁用"
                }

            if not row.active_session_token:
                logger.info("Session validation failed: no active session", {
                    "user_id": user_id
                })
                return {
                    "success": True,
                    "valid": False,
                    "reason": "无活跃会话"
                }

            if row.active_session_token != session_token:
                logger.warning("Session validation failed: token mismatch", {
                    "user_id": user_id,
                    "session_created_at": row.session_created_at.isoformat() if row.session_created_at else None,
                    "reason": "另一台设备已登录"
                })
                return {
                    "success": True,
                    "valid": False,
                    "reason": "您的账号已在另一台设备上登录"
                }

            logger.debug("Session validation successful", {
                "user_id": user_id,
                "session_created_at": row.session_created_at.isoformat() if row.session_created_at else None
            })

            return {
                "success": True,
                "valid": True,
                "message": "会话有效"
            }

        except Exception as e:
            error_msg = str(e)
            logger.error("Session validation exception", {
                "user_id": user_id,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "valid": False,
                "message": "会话验证异常",
                "error_code": "SESSION_VALIDATION_ERROR",
                "error_details": {"error": error_msg}
            }

    async def invalidate_session(
        self,
        db: AsyncSession,
        user_id: str
    ) -> Dict[str, Any]:
        """
        Invalidate a user's current session.

        Args:
            db: AsyncSession for database operations
            user_id: User ID

        Returns:
            Dict containing invalidation result
        """
        try:
            logger.info("Invalidating user session", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })

            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id

            stmt = (
                update(User)
                .where(User.id == user_uuid)
                .values(
                    active_session_token=None,
                    session_created_at=None,
                    session_device_info=None,
                    session_ip_address=None
                )
            )
            result = await db.execute(stmt)

            if result.rowcount == 0:
                logger.warning("Session invalidation: user not found", {
                    "user_id": user_id
                })

            logger.info("User session invalidated", {
                "user_id": user_id
            })

            return {
                "success": True,
                "message": "会话已注销"
            }

        except Exception as e:
            error_msg = str(e)
            logger.error("Session invalidation exception", {
                "user_id": user_id,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "会话注销异常",
                "error_code": "SESSION_INVALIDATION_ERROR",
                "error_details": {"error": error_msg}
            }


# Global session service instance
session_service = SessionService()
