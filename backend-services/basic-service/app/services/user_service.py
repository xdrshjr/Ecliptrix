"""
User profile service for user management operations.
Uses SQLAlchemy async operations on the User model.
"""

import bcrypt
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID as PyUUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete

from app.models.db_models import User
from app.logger import get_logger
from app.models.user_models import UserProfileUpdate, UserCreateRequest

logger = get_logger(__name__)


class UserService:
    """Service for handling user profile operations."""

    def __init__(self):
        """Initialize user service."""
        logger.info("User service initialized (SQLAlchemy mode)")

    def _hash_password(self, password: str) -> str:
        """Hash a password using bcrypt."""
        salt = bcrypt.gensalt()
        password_hash = bcrypt.hashpw(password.encode('utf-8'), salt)
        return password_hash.decode('utf-8')

    def _user_to_dict(self, user: User) -> Dict[str, Any]:
        """Convert a User ORM object to a dict for API response."""
        return {
            "id": str(user.id),
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "avatar_url": user.avatar_url,
            "is_active": user.is_active,
            "is_admin": user.is_admin,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "updated_at": user.updated_at.isoformat() if user.updated_at else None,
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None
        }

    async def get_user_profile(
        self,
        db: AsyncSession,
        user_id: str
    ) -> Dict[str, Any]:
        """
        Get user profile information.

        Args:
            db: AsyncSession for database operations
            user_id: User identifier (ID or username for backward compatibility)

        Returns:
            Dict containing user profile data
        """
        try:
            logger.info("Getting user profile", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })

            user = None

            # First try by ID
            try:
                user_uuid = PyUUID(user_id)
                stmt = select(User).where(User.id == user_uuid, User.is_active == True)
                result = await db.execute(stmt)
                user = result.scalar_one_or_none()
            except (ValueError, AttributeError):
                pass

            # Fallback: try by username for backward compatibility
            if not user:
                stmt = select(User).where(User.username == user_id, User.is_active == True)
                result = await db.execute(stmt)
                user = result.scalar_one_or_none()

            if not user:
                logger.warning("User not found", {
                    "user_id": user_id,
                    "query_result": "no_user_found"
                })
                return {
                    "success": False,
                    "message": "用户不存在",
                    "error_code": "USER_NOT_FOUND"
                }

            logger.info("User profile query successful", {
                "user_id": user_id,
                "username": user.username,
                "is_admin": user.is_admin
            })

            return {
                "success": True,
                "message": "用户资料获取成功",
                "user": self._user_to_dict(user)
            }

        except Exception as e:
            logger.error("User profile query exception", {
                "user_id": user_id,
                "error": str(e),
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "用户资料查询失败",
                "error_code": "QUERY_ERROR"
            }

    async def update_user_profile(
        self,
        db: AsyncSession,
        user_id: str,
        profile_data: UserProfileUpdate
    ) -> Dict[str, Any]:
        """
        Update user profile information.

        Args:
            db: AsyncSession for database operations
            user_id: User identifier
            profile_data: Profile update data

        Returns:
            Dict containing updated user profile data
        """
        try:
            logger.info("Updating user profile", {
                "user_id": user_id,
                "username": profile_data.username,
                "timestamp": datetime.now().isoformat()
            })

            # Find existing user (by ID or username)
            user = None
            actual_user_id = None

            try:
                user_uuid = PyUUID(user_id)
                stmt = select(User).where(User.id == user_uuid, User.is_active == True)
                result = await db.execute(stmt)
                user = result.scalar_one_or_none()
            except (ValueError, AttributeError):
                pass

            if not user:
                stmt = select(User).where(User.username == user_id, User.is_active == True)
                result = await db.execute(stmt)
                user = result.scalar_one_or_none()

            if not user:
                logger.warning("User not found for update", {"user_id": user_id})
                return {
                    "success": False,
                    "message": "用户不存在",
                    "error_code": "USER_NOT_FOUND"
                }

            actual_user_id = user.id

            # Check if username is taken by another user
            if profile_data.username != user.username:
                username_check_stmt = select(User.id).where(User.username == profile_data.username)
                username_check_result = await db.execute(username_check_stmt)
                if username_check_result.scalar_one_or_none() is not None:
                    logger.warning("Username already taken", {
                        "user_id": user_id,
                        "username": profile_data.username
                    })
                    return {
                        "success": False,
                        "message": "用户名已被使用",
                        "error_code": "USERNAME_TAKEN"
                    }

            # Prepare update data
            update_values: Dict[str, Any] = {
                "username": profile_data.username,
            }
            if profile_data.email is not None:
                update_values["email"] = profile_data.email
            if profile_data.full_name is not None:
                update_values["full_name"] = profile_data.full_name
            if profile_data.avatar_url is not None:
                update_values["avatar_url"] = profile_data.avatar_url

            # Update user in database
            update_stmt = (
                update(User)
                .where(User.id == actual_user_id)
                .values(**update_values)
                .returning(User)
            )
            update_result = await db.execute(update_stmt)
            updated_user = update_result.scalar_one_or_none()

            if not updated_user:
                logger.error("User profile update failed", {
                    "user_id": user_id,
                    "actual_user_id": str(actual_user_id)
                })
                return {
                    "success": False,
                    "message": "用户资料更新失败",
                    "error_code": "UPDATE_FAILED"
                }

            logger.info("User profile updated successfully", {
                "user_id": user_id,
                "username": updated_user.username
            })

            return {
                "success": True,
                "message": "用户资料更新成功",
                "user": self._user_to_dict(updated_user)
            }

        except Exception as e:
            logger.error("User profile update exception", {
                "user_id": user_id,
                "error": str(e),
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "用户资料更新失败",
                "error_code": "UPDATE_ERROR"
            }

    async def get_all_users(self, db: AsyncSession) -> Dict[str, Any]:
        """
        Get all users from the database.

        Args:
            db: AsyncSession for database operations

        Returns:
            Dict containing list of all users
        """
        try:
            logger.info("Getting all users list", {
                "timestamp": datetime.now().isoformat()
            })

            stmt = select(User).order_by(User.created_at.desc())
            result = await db.execute(stmt)
            users = result.scalars().all()

            users_list = [self._user_to_dict(user) for user in users]

            logger.info("User list retrieved successfully", {
                "total_count": len(users_list),
                "active_users": sum(1 for u in users_list if u['is_active']),
                "admin_users": sum(1 for u in users_list if u['is_admin'])
            })

            return {
                "success": True,
                "message": "用户列表获取成功",
                "total_count": len(users_list),
                "users": users_list
            }

        except Exception as e:
            logger.error("Get all users exception", {
                "error": str(e),
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "用户列表获取失败",
                "error_code": "QUERY_ERROR"
            }

    async def create_user(
        self,
        db: AsyncSession,
        user_data: UserCreateRequest
    ) -> Dict[str, Any]:
        """
        Create a new user (admin function).

        Args:
            db: AsyncSession for database operations
            user_data: User creation data

        Returns:
            Dict containing created user information
        """
        try:
            logger.info("Admin creating user", {
                "username": user_data.username,
                "email": user_data.email,
                "is_admin": user_data.is_admin,
                "user_role": user_data.user_role,
                "timestamp": datetime.now().isoformat()
            })

            # Check if username already exists
            username_check = select(User.id).where(User.username == user_data.username)
            if (await db.execute(username_check)).scalar_one_or_none() is not None:
                logger.warning("Username already exists", {"username": user_data.username})
                return {
                    "success": False,
                    "message": "用户名已存在",
                    "error_code": "USERNAME_EXISTS"
                }

            # Check if email already exists
            email_check = select(User.id).where(User.email == user_data.email)
            if (await db.execute(email_check)).scalar_one_or_none() is not None:
                logger.warning("Email already exists", {"email": user_data.email})
                return {
                    "success": False,
                    "message": "邮箱已存在",
                    "error_code": "EMAIL_EXISTS"
                }

            # Hash password
            password_hash = self._hash_password(user_data.password)

            # Create new user
            new_user = User(
                username=user_data.username,
                email=user_data.email,
                password_hash=password_hash,
                full_name=user_data.full_name,
                avatar_url=user_data.avatar_url,
                is_active=user_data.is_active,
                is_admin=user_data.is_admin,
                user_role=user_data.user_role or "regular"
            )
            db.add(new_user)
            await db.flush()

            logger.info("User created successfully", {
                "user_id": str(new_user.id),
                "username": new_user.username,
                "email": new_user.email,
                "is_admin": new_user.is_admin,
                "user_role": new_user.user_role
            })

            return {
                "success": True,
                "message": "用户创建成功",
                "user": self._user_to_dict(new_user)
            }

        except Exception as e:
            logger.error("Create user exception", {
                "username": user_data.username,
                "error": str(e),
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "用户创建失败",
                "error_code": "CREATE_ERROR"
            }

    async def delete_user(
        self,
        db: AsyncSession,
        user_id: str
    ) -> Dict[str, Any]:
        """
        Delete a user (admin function).

        Args:
            db: AsyncSession for database operations
            user_id: User ID to delete

        Returns:
            Dict containing deletion result
        """
        try:
            logger.info("Admin deleting user", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })

            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id

            # Check if user exists
            stmt = select(User.id, User.username, User.email).where(User.id == user_uuid)
            result = await db.execute(stmt)
            user_row = result.one_or_none()

            if not user_row:
                logger.warning("User not found for deletion", {"user_id": user_id})
                return {
                    "success": False,
                    "message": "用户不存在",
                    "error_code": "USER_NOT_FOUND"
                }

            # Delete user from database
            delete_stmt = delete(User).where(User.id == user_uuid)
            await db.execute(delete_stmt)

            logger.info("User deleted successfully", {
                "user_id": user_id,
                "username": user_row.username,
                "email": user_row.email
            })

            return {
                "success": True,
                "message": "用户删除成功"
            }

        except Exception as e:
            logger.error("Delete user exception", {
                "user_id": user_id,
                "error": str(e),
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "用户删除失败",
                "error_code": "DELETE_ERROR"
            }

    async def check_health(self, db: AsyncSession) -> bool:
        """Check if the user service is healthy."""
        try:
            stmt = select(User.id).limit(1)
            await db.execute(stmt)
            return True
        except Exception:
            return False


# Global user service instance
user_service = UserService()
