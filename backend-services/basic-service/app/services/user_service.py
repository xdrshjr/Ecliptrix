"""
User profile service for user management operations.
Uses SQLAlchemy async operations on the User model.
"""

import bcrypt
import secrets
import string
import math
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID as PyUUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func, or_

from app.models.db_models import User, LoginHistory
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
            "is_root": user.is_root,
            "user_role": user.user_role or "regular",
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "updated_at": user.updated_at.isoformat() if user.updated_at else None,
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None
        }

    @staticmethod
    def _generate_random_password(length: int = 12) -> str:
        """Generate a random alphanumeric password."""
        alphabet = string.ascii_letters + string.digits
        return ''.join(secrets.choice(alphabet) for _ in range(length))

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

    async def get_all_users(
        self,
        db: AsyncSession,
        current_user: Optional[User] = None,
        page: int = 1,
        page_size: int = 20,
        role: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> Dict[str, Any]:
        """
        Get users list with pagination, filtering, searching, and sorting.

        Permission filtering:
          - admin caller: excludes admin and root users from results
          - root caller: shows all users except self

        Args:
            db: AsyncSession for database operations
            current_user: The caller's User ORM object (for permission filtering)
            page: Page number (1-based)
            page_size: Number of results per page (max 100)
            role: Filter by user_role ("admin", "regular", "premium")
            status: Filter by status ("active", "disabled")
            search: Search term matching username or email (ILIKE)
            sort_by: Sort field ("created_at", "last_login_at", "username")
            sort_order: Sort direction ("asc", "desc")

        Returns:
            Dict containing paginated user list
        """
        try:
            logger.info("Getting users list", {
                "page": page, "page_size": page_size, "role": role,
                "status": status, "search": search,
                "sort_by": sort_by, "sort_order": sort_order,
                "timestamp": datetime.now().isoformat()
            })

            # Clamp page_size
            page_size = max(1, min(page_size, 100))
            page = max(1, page)

            # Base query
            stmt = select(User)
            count_stmt = select(func.count(User.id))

            # Permission filtering
            if current_user is not None:
                if current_user.is_root:
                    # Root sees all except self
                    stmt = stmt.where(User.id != current_user.id)
                    count_stmt = count_stmt.where(User.id != current_user.id)
                else:
                    # Admin sees only non-admin, non-root users
                    stmt = stmt.where(User.is_admin == False, User.is_root == False)
                    count_stmt = count_stmt.where(User.is_admin == False, User.is_root == False)

            # Role filter
            if role:
                stmt = stmt.where(User.user_role == role)
                count_stmt = count_stmt.where(User.user_role == role)

            # Status filter
            if status == "active":
                stmt = stmt.where(User.is_active == True)
                count_stmt = count_stmt.where(User.is_active == True)
            elif status == "disabled":
                stmt = stmt.where(User.is_active == False)
                count_stmt = count_stmt.where(User.is_active == False)

            # Search filter (ILIKE on username or email)
            if search:
                # Escape LIKE-special characters to prevent wildcard injection
                escaped_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                search_pattern = f"%{escaped_search}%"
                search_filter = or_(
                    User.username.ilike(search_pattern),
                    User.email.ilike(search_pattern),
                )
                stmt = stmt.where(search_filter)
                count_stmt = count_stmt.where(search_filter)

            # Get total count
            total_result = await db.execute(count_stmt)
            total = total_result.scalar() or 0
            total_pages = math.ceil(total / page_size) if total > 0 else 0

            # Sorting
            allowed_sort_fields = {
                "created_at": User.created_at,
                "last_login_at": User.last_login_at,
                "username": User.username,
            }
            sort_column = allowed_sort_fields.get(sort_by, User.created_at)
            if sort_order == "asc":
                stmt = stmt.order_by(sort_column.asc())
            else:
                stmt = stmt.order_by(sort_column.desc())

            # Pagination
            offset = (page - 1) * page_size
            stmt = stmt.offset(offset).limit(page_size)

            result = await db.execute(stmt)
            users = result.scalars().all()
            users_list = [self._user_to_dict(user) for user in users]

            logger.info("User list retrieved successfully", {
                "total": total, "page": page, "page_size": page_size,
                "returned_count": len(users_list),
            })

            return {
                "success": True,
                "message": "用户列表获取成功",
                "data": {
                    "users": users_list,
                    "total": total,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": total_pages,
                }
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

            # Check if email already exists (skip if email not provided)
            effective_email = user_data.email or f"{user_data.username}@local.dev"
            if user_data.email:
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

            # Enforce is_admin / user_role consistency:
            #   user_role="admin" must imply is_admin=True and vice-versa.
            effective_role = user_data.user_role or "regular"
            effective_is_admin = user_data.is_admin
            if effective_role == "admin":
                effective_is_admin = True
            elif effective_is_admin:
                effective_role = "admin"

            # Create new user
            new_user = User(
                username=user_data.username,
                email=effective_email,
                password_hash=password_hash,
                full_name=user_data.full_name,
                avatar_url=user_data.avatar_url,
                is_active=user_data.is_active,
                is_admin=effective_is_admin,
                user_role=effective_role,
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

    async def toggle_user_status(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> Dict[str, Any]:
        """
        Toggle a user's is_active status. When disabling, clears session token.

        Args:
            db: AsyncSession for database operations
            user_id: Target user ID

        Returns:
            Dict containing updated user info and new status
        """
        try:
            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id
            stmt = select(User).where(User.id == user_uuid)
            result = await db.execute(stmt)
            user = result.scalar_one_or_none()

            if not user:
                return {"success": False, "message": "用户不存在", "error_code": "USER_NOT_FOUND"}

            new_active = not user.is_active
            update_values: Dict[str, Any] = {"is_active": new_active}

            # When disabling, clear session
            if not new_active:
                update_values["active_session_token"] = None
                update_values["session_created_at"] = None
                update_values["session_device_info"] = None
                update_values["session_ip_address"] = None

            update_stmt = (
                update(User)
                .where(User.id == user_uuid)
                .values(**update_values)
                .returning(User)
            )
            update_result = await db.execute(update_stmt)
            updated_user = update_result.scalar_one_or_none()

            if not updated_user:
                return {"success": False, "message": "状态切换失败", "error_code": "UPDATE_FAILED"}

            new_status = "active" if updated_user.is_active else "disabled"
            logger.info("User status toggled", {
                "user_id": user_id,
                "new_status": new_status,
            })

            return {
                "success": True,
                "message": f"用户已{'启用' if updated_user.is_active else '禁用'}",
                "data": {
                    "user": self._user_to_dict(updated_user),
                    "new_status": new_status,
                }
            }

        except Exception as e:
            logger.error("Toggle user status exception", {"user_id": user_id, "error": str(e)})
            return {"success": False, "message": "状态切换失败", "error_code": "UPDATE_ERROR"}

    async def reset_user_password(
        self,
        db: AsyncSession,
        user_id: str,
        new_password: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Reset a user's password. Auto-generates a temporary password if none provided.
        Clears the user's session token to force re-login.

        Args:
            db: AsyncSession for database operations
            user_id: Target user ID
            new_password: Optional explicit password; auto-generated if None

        Returns:
            Dict containing result (includes temporary_password if auto-generated)
        """
        try:
            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id

            auto_generated = new_password is None
            if auto_generated:
                new_password = ***REMOVED***(12)

            password_hash = self._hash_password(new_password)

            update_stmt = (
                update(User)
                .where(User.id == user_uuid)
                .values(
                    password_hash=password_hash,
                    active_session_token=None,
                    session_created_at=None,
                    session_device_info=None,
                    session_ip_address=None,
                )
            )
            result = await db.execute(update_stmt)

            if result.rowcount == 0:
                return {"success": False, "message": "用户不存在", "error_code": "USER_NOT_FOUND"}

            logger.info("User password reset", {"user_id": user_id, "auto_generated": auto_generated})

            response: Dict[str, Any] = {
                "success": True,
                "message": "密码已重置",
            }
            if auto_generated:
                response["data"] = {"temporary_password": new_password}

            return response

        except Exception as e:
            logger.error("Reset password exception", {"user_id": user_id, "error": str(e)})
            return {"success": False, "message": "密码重置失败", "error_code": "RESET_ERROR"}

    async def get_login_history(
        self,
        db: AsyncSession,
        user_id: str,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        """
        Retrieve paginated login history for a user.

        Args:
            db: AsyncSession for database operations
            user_id: Target user ID
            page: Page number
            page_size: Results per page

        Returns:
            Dict containing paginated login history records
        """
        try:
            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id
            page_size = max(1, min(page_size, 100))
            page = max(1, page)

            # Total count
            count_stmt = select(func.count(LoginHistory.id)).where(LoginHistory.user_id == user_uuid)
            total = (await db.execute(count_stmt)).scalar() or 0

            # Fetch records
            offset = (page - 1) * page_size
            stmt = (
                select(LoginHistory)
                .where(LoginHistory.user_id == user_uuid)
                .order_by(LoginHistory.login_at.desc())
                .offset(offset)
                .limit(page_size)
            )
            result = await db.execute(stmt)
            records = result.scalars().all()

            records_list = [
                {
                    "id": str(r.id),
                    "login_at": r.login_at.isoformat() if r.login_at else None,
                    "ip_address": r.ip_address,
                    "device_info": r.device_info,
                    "login_result": r.login_result,
                    "failure_reason": r.failure_reason,
                }
                for r in records
            ]

            return {
                "success": True,
                "message": "登录历史获取成功",
                "data": {
                    "records": records_list,
                    "total": total,
                    "page": page,
                    "page_size": page_size,
                }
            }

        except Exception as e:
            logger.error("Get login history exception", {"user_id": user_id, "error": str(e)})
            return {"success": False, "message": "登录历史获取失败", "error_code": "QUERY_ERROR"}

    async def force_logout_user(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> Dict[str, Any]:
        """
        Force-logout a user by clearing their session token.

        Args:
            db: AsyncSession for database operations
            user_id: Target user ID

        Returns:
            Dict containing result
        """
        try:
            user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id

            update_stmt = (
                update(User)
                .where(User.id == user_uuid)
                .values(
                    active_session_token=None,
                    session_created_at=None,
                    session_device_info=None,
                    session_ip_address=None,
                )
            )
            result = await db.execute(update_stmt)

            if result.rowcount == 0:
                return {"success": False, "message": "用户不存在", "error_code": "USER_NOT_FOUND"}

            logger.info("User force-logged out", {"user_id": user_id})
            return {"success": True, "message": "用户已被强制下线"}

        except Exception as e:
            logger.error("Force logout exception", {"user_id": user_id, "error": str(e)})
            return {"success": False, "message": "强制下线失败", "error_code": "LOGOUT_ERROR"}

    async def get_user_stats(self, db: AsyncSession, current_user: Optional[User] = None) -> Dict[str, Any]:
        """
        Get aggregated user statistics.
        Permission-filtered to match get_all_users() behavior.
        """
        try:
            # Build permission filter conditions matching get_all_users
            def apply_perm_filter(stmt):
                if current_user is not None:
                    if current_user.is_root:
                        stmt = stmt.where(User.id != current_user.id)
                    else:
                        stmt = stmt.where(User.is_admin == False, User.is_root == False)
                return stmt

            total = (await db.execute(
                apply_perm_filter(select(func.count(User.id)))
            )).scalar() or 0

            admin_count = (await db.execute(
                apply_perm_filter(select(func.count(User.id)).where(User.user_role == "admin"))
            )).scalar() or 0

            premium_count = (await db.execute(
                apply_perm_filter(select(func.count(User.id)).where(User.user_role == "premium"))
            )).scalar() or 0

            regular_count = (await db.execute(
                apply_perm_filter(select(func.count(User.id)).where(User.user_role == "regular"))
            )).scalar() or 0

            active_count = (await db.execute(
                apply_perm_filter(select(func.count(User.id)).where(User.is_active == True))
            )).scalar() or 0

            disabled_count = (await db.execute(
                apply_perm_filter(select(func.count(User.id)).where(User.is_active == False))
            )).scalar() or 0

            online_count = (await db.execute(
                apply_perm_filter(select(func.count(User.id)).where(User.active_session_token.isnot(None)))
            )).scalar() or 0

            return {
                "success": True,
                "message": "用户统计获取成功",
                "data": {
                    "total_users": total,
                    "admin_count": admin_count,
                    "premium_count": premium_count,
                    "regular_count": regular_count,
                    "active_count": active_count,
                    "disabled_count": disabled_count,
                    "online_count": online_count,
                }
            }

        except Exception as e:
            logger.error("Get user stats exception", {"error": str(e)})
            return {"success": False, "message": "用户统计获取失败", "error_code": "QUERY_ERROR"}

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
