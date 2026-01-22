"""
Local session provider for in-memory session management.
"""

import secrets
import threading
from typing import Dict, Any, Optional
from datetime import datetime

from app.logger import get_logger

logger = get_logger(__name__)


class LocalSessionProvider:
    """In-memory session provider for local authentication mode."""

    def __init__(self):
        """Initialize local session provider."""
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        logger.info("Local session provider initialized")

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
        user_id: str,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new session for a user, invalidating any existing sessions.

        Args:
            user_id: User ID
            device_info: Device information (User-Agent)
            ip_address: IP address of the client

        Returns:
            Dict containing session creation result
        """
        try:
            with self._lock:
                logger.info("Creating new user session (LOCAL mode)", {
                    "user_id": user_id,
                    "device_info": device_info[:100] if device_info else None,
                    "ip_address": ip_address,
                    "timestamp": datetime.now().isoformat()
                })

                # Check if user has an existing session
                if user_id in self._sessions:
                    logger.info("Detected existing session, will be replaced", {
                        "user_id": user_id,
                        "old_session_created_at": self._sessions[user_id].get("created_at"),
                        "action": "invalidate_old_session"
                    })

                # Generate new session token
                session_token = self._generate_session_token()

                # Store session data
                self._sessions[user_id] = {
                    "session_token": session_token,
                    "created_at": datetime.now().isoformat(),
                    "device_info": device_info,
                    "ip_address": ip_address
                }

                logger.info(f"User session created successfully (LOCAL mode) - user_id={user_id}, type={type(user_id).__name__}, stored_sessions={list(self._sessions.keys())}")

                return {
                    "success": True,
                    "message": "会话创建成功",
                    "session_token": session_token
                }

        except Exception as e:
            error_msg = str(e)
            logger.error("Session creation exception (LOCAL mode)", {
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
        user_id: str,
        session_token: str
    ) -> Dict[str, Any]:
        """
        Validate if a session token is currently active for a user.

        Args:
            user_id: User ID
            session_token: Session token to validate

        Returns:
            Dict containing validation result
        """
        try:
            with self._lock:
                logger.debug("Validating user session (LOCAL mode)", {
                    "user_id": user_id,
                    "timestamp": datetime.now().isoformat()
                })

                # Check if user has a session
                if user_id not in self._sessions:
                    logger.info(f"Session validation failed: no active session (LOCAL mode) - user_id={user_id}, type={type(user_id).__name__}, stored_sessions={list(self._sessions.keys())}")
                    return {
                        "success": True,
                        "valid": False,
                        "reason": "无活跃会话"
                    }

                # Check if session token matches
                stored_token = self._sessions[user_id].get("session_token")
                if stored_token != session_token:
                    logger.warning("Session validation failed: token mismatch (LOCAL mode)", {
                        "user_id": user_id,
                        "session_created_at": self._sessions[user_id].get("created_at"),
                        "reason": "另一台设备已登录"
                    })
                    return {
                        "success": True,
                        "valid": False,
                        "reason": "您的账号已在另一台设备上登录"
                    }

                logger.debug("Session validation successful (LOCAL mode)", {
                    "user_id": user_id,
                    "session_created_at": self._sessions[user_id].get("created_at")
                })

                return {
                    "success": True,
                    "valid": True,
                    "message": "会话有效"
                }

        except Exception as e:
            error_msg = str(e)
            logger.error("Session validation exception (LOCAL mode)", {
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

    async def invalidate_session(self, user_id: str) -> Dict[str, Any]:
        """
        Invalidate a user's current session.

        Args:
            user_id: User ID

        Returns:
            Dict containing invalidation result
        """
        try:
            with self._lock:
                logger.info("Invalidating user session (LOCAL mode)", {
                    "user_id": user_id,
                    "timestamp": datetime.now().isoformat()
                })

                # Remove session if exists
                if user_id in self._sessions:
                    del self._sessions[user_id]
                    logger.info("User session invalidated (LOCAL mode)", {
                        "user_id": user_id
                    })
                else:
                    logger.warning("Session invalidation: no session found (LOCAL mode)", {
                        "user_id": user_id
                    })

                return {
                    "success": True,
                    "message": "会话已注销"
                }

        except Exception as e:
            error_msg = str(e)
            logger.error("Session invalidation exception (LOCAL mode)", {
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
