"""
Local authentication provider for in-memory user management.
"""

import bcrypt
import uuid
import threading
from typing import Dict, Any, Optional
from datetime import datetime

from app.config import settings
from app.logger import get_logger
from app.models.auth_models import UserLogin, UserInfo, UserRegistration

logger = get_logger(__name__)


class LocalAuthProvider:
    """In-memory authentication provider for local mode."""

    def __init__(self, session_provider=None):
        """Initialize local authentication provider.

        Args:
            session_provider: Optional shared LocalSessionProvider instance
        """
        self._users: Dict[str, Dict[str, Any]] = {}
        self._users_by_username: Dict[str, str] = {}
        self._lock = threading.Lock()

        # Use provided session provider or import and get the global instance
        if session_provider is None:
            from app.services.session_service import session_service
            self._session_provider = session_service.local_provider
        else:
            self._session_provider = session_provider

        self._initialize_admin_user()
        logger.info("Local authentication provider initialized")

    def _initialize_admin_user(self):
        """Create admin user from configuration."""
        try:
            with self._lock:
                admin_username = settings.auth.local_admin_username
                admin_password = ***REMOVED***

                # Generate UUID for admin user
                admin_id = str(uuid.uuid4())

                # Hash password using bcrypt
                password_hash = self._hash_password(admin_password)

                # Create admin user data
                admin_user = {
                    "id": admin_id,
                    "username": admin_username,
                    "email": f"{admin_username}@local.dev",
                    "password_hash": password_hash,
                    "full_name": "Local Administrator",
                    "avatar_url": None,
                    "is_active": True,
                    "is_admin": True,
                    "user_role": "admin",
                    "created_at": datetime.now().isoformat(),
                    "updated_at": datetime.now().isoformat(),
                    "last_login_at": None
                }

                # Store admin user
                self._users[admin_id] = admin_user
                self._users_by_username[admin_username] = admin_id

                logger.info("Admin user initialized (LOCAL mode)", {
                    "username": admin_username,
                    "user_id": admin_id
                })

                # Log warning if using default credentials
                if admin_username == "admin" and admin_password == "admin":
                    logger.warning("Using default admin credentials (admin/admin). "
                                   "Consider changing LOCAL_ADMIN_USERNAME and LOCAL_ADMIN_PASSWORD in .env")

        except Exception as e:
            logger.error(f"Failed to initialize admin user: {str(e)}")
            raise

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

    async def authenticate_user(
        self,
        login_data: UserLogin,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Authenticate user with username and password.

        Args:
            login_data: User login credentials
            device_info: Device information (User-Agent)
            ip_address: IP address of the client

        Returns:
            Dict containing authentication result
        """
        try:
            with self._lock:
                logger.info("User login authentication started (LOCAL mode)", {
                    "username": login_data.username,
                    "device_info": device_info[:100] if device_info else None,
                    "ip_address": ip_address,
                    "timestamp": datetime.now().isoformat()
                })

                # Find user by username
                user_id = self._users_by_username.get(login_data.username)
                if not user_id:
                    logger.warning("User not found (LOCAL mode)", {
                        "username": login_data.username
                    })
                    return {
                        "success": False,
                        "message": "用户名或密码错误",
                        "error_code": "INVALID_CREDENTIALS"
                    }

                user_data = self._users[user_id]

                # Check if user is active
                if not user_data.get("is_active", False):
                    logger.warning("User is disabled (LOCAL mode)", {
                        "username": login_data.username,
                        "user_id": user_id
                    })
                    return {
                        "success": False,
                        "message": "用户已被禁用",
                        "error_code": "USER_DISABLED"
                    }

                # Verify password
                if not self._verify_password(login_data.password, user_data["password_hash"]):
                    logger.warning("Password verification failed (LOCAL mode)", {
                        "username": login_data.username,
                        "user_id": user_id
                    })
                    return {
                        "success": False,
                        "message": "用户名或密码错误",
                        "error_code": "INVALID_CREDENTIALS"
                    }

                # Update last login time
                user_data["last_login_at"] = datetime.now().isoformat()
                user_data["updated_at"] = datetime.now().isoformat()

            # Create new session (outside lock to avoid deadlock)
            session_result = await self._session_provider.create_session(
                user_id=user_id,
                device_info=device_info,
                ip_address=ip_address
            )

            if not session_result.get("success"):
                logger.error("Session creation failed (LOCAL mode)", {
                    "user_id": user_id,
                    "username": login_data.username,
                    "error": session_result.get("message")
                })
                session_token = None
            else:
                session_token = session_result.get("session_token")
                logger.info("User session created successfully (LOCAL mode)", {
                    "user_id": user_id,
                    "username": login_data.username
                })

            # Create user info object
            user_info = UserInfo(
                id=user_data["id"],
                username=user_data["username"],
                email=user_data["email"],
                full_name=user_data.get("full_name"),
                avatar_url=user_data.get("avatar_url"),
                is_active=user_data["is_active"],
                is_admin=user_data.get("is_admin", False),
                user_role=user_data.get("user_role", "regular"),
                created_at=datetime.fromisoformat(user_data["created_at"]),
                updated_at=datetime.fromisoformat(user_data["updated_at"]),
                last_login_at=datetime.now()
            )

            logger.info("User authentication successful (LOCAL mode)", {
                "username": login_data.username,
                "user_id": user_id,
                "is_admin": user_info.is_admin,
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
            logger.error("User authentication exception (LOCAL mode)", {
                "username": login_data.username,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "认证服务异常",
                "error_code": "AUTHENTICATION_ERROR",
                "error_details": {"error": error_msg}
            }

    async def register_user(self, registration_data: UserRegistration) -> Dict[str, Any]:
        """
        Register a new user (not supported in local mode).

        Args:
            registration_data: User registration data

        Returns:
            Dict containing registration result
        """
        logger.warning("User registration attempted in LOCAL mode", {
            "username": registration_data.username
        })
        return {
            "success": False,
            "message": "本地模式不支持用户注册",
            "error_code": "REGISTRATION_NOT_SUPPORTED"
        }

    async def get_user_by_id(self, user_id: str) -> Optional[UserInfo]:
        """
        Get user information by ID.

        Args:
            user_id: User ID

        Returns:
            UserInfo object or None if not found
        """
        try:
            with self._lock:
                user_data = self._users.get(user_id)
                if not user_data:
                    return None

                if not user_data.get("is_active", False):
                    return None

                return UserInfo(
                    id=user_data["id"],
                    username=user_data["username"],
                    email=user_data["email"],
                    full_name=user_data.get("full_name"),
                    avatar_url=user_data.get("avatar_url"),
                    is_active=user_data["is_active"],
                    is_admin=user_data.get("is_admin", False),
                    user_role=user_data.get("user_role", "regular"),
                    created_at=datetime.fromisoformat(user_data["created_at"]),
                    updated_at=datetime.fromisoformat(user_data["updated_at"]),
                    last_login_at=datetime.fromisoformat(user_data["last_login_at"]) if user_data.get("last_login_at") else None
                )

        except Exception as e:
            logger.error(f"Get user by ID exception (LOCAL mode): {str(e)}", {"user_id": user_id})
            return None

    def health_check(self) -> Dict[str, Any]:
        """Check authentication service health."""
        try:
            with self._lock:
                user_count = len(self._users)

            return {
                "service": "AuthService",
                "status": "healthy",
                "message": "认证服务运行正常 (LOCAL mode)",
                "mode": "local",
                "user_count": user_count
            }

        except Exception as e:
            logger.error("Authentication service health check failed (LOCAL mode)", {"error": str(e)})
            return {
                "service": "AuthService",
                "status": "unhealthy",
                "message": f"健康检查失败: {str(e)}",
                "mode": "local"
            }
