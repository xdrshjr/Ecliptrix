"""
User profile management router.

Permission matrix:
  GET  /user/profile           -> get_current_user (own info)
  PUT  /user/profile/{id}      -> require_admin (with root/admin protection logic)
  GET  /user/list              -> require_admin (pagination, filtering, sorting)
  POST /user/create            -> require_admin (creating admin role -> require_root)
  DELETE /user/delete/{id}     -> require_admin (deleting admin -> require_root; root cannot be deleted)
  POST /user/toggle-status/{id}   -> require_admin (admin target -> require_root; root cannot be toggled)
  POST /user/reset-password/{id}  -> require_admin (admin target -> require_root; root cannot be reset)
  GET  /user/login-history/{id}   -> require_admin (admin can only view non-admin history)
  POST /user/force-logout/{id}    -> require_admin (admin target -> require_root; root cannot be forced)
  GET  /user/stats             -> require_admin
  GET  /user/health            -> public
"""

from fastapi import APIRouter, Body, HTTPException, Depends, Query, status
from typing import Dict, Any, Optional
from datetime import datetime
from uuid import UUID as PyUUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user_models import (
    UserProfileUpdate,
    UserProfileResponse,
    UserCreateRequest,
    UserCreateResponse,
    ResetPasswordRequest,
)
from app.models.db_models import User
from app.services.user_service import user_service
from app.database import get_db_session
from app.dependencies.auth import get_current_user, require_admin, require_root
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/user", tags=["user"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _load_target_user(db: AsyncSession, user_id: str) -> User:
    """Load a target user by ID (or username fallback) for permission checks.

    Raises HTTPException 404 if user does not exist.
    """
    user = None

    # Try by UUID first
    try:
        user_uuid = PyUUID(user_id)
        stmt = select(User).where(User.id == user_uuid)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
    except (ValueError, AttributeError):
        pass

    # Fallback: try by username
    if user is None:
        stmt = select(User).where(User.username == user_id)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "success": False,
                "message": "目标用户不存在",
                "error_code": "USER_NOT_FOUND",
            },
        )

    return user


def _check_admin_target_protection(target_user: User, current_user: User) -> None:
    """Raise 403 if current_user lacks permission to act on target_user.

    - root target -> always forbidden (caller should handle separately)
    - admin target -> requires root caller
    """
    if target_user.is_admin and not current_user.is_root:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "success": False,
                "message": "操作管理员需要超级管理员权限",
                "error_code": "FORBIDDEN",
                "error_details": {"reason": "Root privilege required to manage admin users"},
            },
        )


# ---------------------------------------------------------------------------
# GET /user/profile
# ---------------------------------------------------------------------------

@router.get("/profile", response_model=UserProfileResponse)
async def get_user_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
) -> UserProfileResponse:
    """
    Get current user's own profile information.
    Requires: authenticated user.
    """
    user_id = str(current_user.id)
    logger.info("Getting user profile", {
        "user_id": user_id,
        "endpoint": "/user/profile",
        "method": "GET",
        "timestamp": datetime.now().isoformat()
    })

    try:
        result = await user_service.get_user_profile(db=db, user_id=user_id)

        if not result["success"]:
            logger.warning("User profile retrieval failed", {
                "user_id": user_id,
                "error": result.get("message", "Unknown error")
            })
            raise HTTPException(
                status_code=404 if result.get("error_code") == "USER_NOT_FOUND" else 500,
                detail=result.get("message", "获取用户资料失败")
            )

        logger.info("User profile retrieved successfully", {
            "user_id": user_id,
            "username": result["user"]["username"]
        })

        return UserProfileResponse(
            success=True,
            message="用户资料获取成功",
            timestamp=datetime.now(),
            user=result["user"]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("User profile retrieval exception", {
            "user_id": user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# PUT /user/profile/{user_id}
# ---------------------------------------------------------------------------

@router.put("/profile/{user_id}", response_model=UserProfileResponse)
async def update_user_profile(
    user_id: str,
    profile_data: UserProfileUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session)
) -> UserProfileResponse:
    """
    Update user profile information (admin only).

    Permission logic:
      - Modifying a root user -> 403 (root user cannot be modified via API)
      - Modifying an admin user -> require_root
      - Modifying a regular/premium user -> require_admin
    """
    logger.info("Updating user profile", {
        "user_id": user_id,
        "operator": str(current_user.id),
        "endpoint": "/user/profile",
        "method": "PUT",
        "username": profile_data.username,
        "timestamp": datetime.now().isoformat()
    })

    try:
        # Load the target user to check role protection
        target_user = await _load_target_user(db, user_id)

        if target_user.is_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "message": "无法通过 API 修改超级管理员",
                    "error_code": "FORBIDDEN",
                    "error_details": {"reason": "Root user cannot be modified via API"},
                },
            )

        _check_admin_target_protection(target_user, current_user)

        result = await user_service.update_user_profile(db=db, user_id=user_id, profile_data=profile_data)

        if not result["success"]:
            logger.warning("User profile update failed", {
                "user_id": user_id,
                "error": result.get("message", "Unknown error"),
                "error_code": result.get("error_code")
            })

            status_code = 404 if result.get("error_code") == "USER_NOT_FOUND" else 400
            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "用户资料更新失败")
            )

        logger.info("User profile updated successfully", {
            "user_id": user_id,
            "username": result["user"]["username"]
        })

        return UserProfileResponse(
            success=True,
            message="用户资料更新成功",
            timestamp=datetime.now(),
            user=result["user"]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("User profile update exception", {
            "user_id": user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# GET /user/health
# ---------------------------------------------------------------------------

@router.get("/health")
async def health_check(
    db: AsyncSession = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    User service health check.
    """
    logger.info("User service health check", {
        "endpoint": "/user/health",
        "timestamp": datetime.now().isoformat()
    })

    service_status = await user_service.check_health(db=db)

    return {
        "success": True,
        "message": "用户服务运行正常",
        "timestamp": datetime.now().isoformat(),
        "service": "UserService",
        "status": "healthy" if service_status else "unhealthy",
        "database_connected": service_status
    }


# ---------------------------------------------------------------------------
# GET /user/list
# ---------------------------------------------------------------------------

@router.get("/list")
async def list_all_users(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Page size"),
    role: Optional[str] = Query(None, description="Filter by role: admin, regular, premium"),
    status: Optional[str] = Query(None, description="Filter by status: active, disabled"),
    search: Optional[str] = Query(None, description="Search by username or email"),
    sort_by: str = Query("created_at", description="Sort field: created_at, last_login_at, username"),
    sort_order: str = Query("desc", description="Sort order: asc, desc"),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Get paginated, filterable, sortable user list.
    Requires: admin.
    """
    logger.info("Getting users list", {
        "operator": str(current_user.id),
        "endpoint": "/user/list",
        "method": "GET",
        "timestamp": datetime.now().isoformat()
    })

    try:
        result = await user_service.get_all_users(
            db=db,
            current_user=current_user,
            page=page,
            page_size=page_size,
            role=role,
            status=status,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
        )

        if not result["success"]:
            raise HTTPException(
                status_code=500,
                detail=result.get("message", "获取用户列表失败")
            )

        return {
            "success": True,
            "message": result["message"],
            "timestamp": datetime.now().isoformat(),
            "data": result["data"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("User list retrieval exception", {
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# POST /user/create
# ---------------------------------------------------------------------------

@router.post("/create", response_model=UserCreateResponse)
async def create_user(
    user_data: UserCreateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session)
) -> UserCreateResponse:
    """
    Create a new user.
    Requires: admin.  Creating an admin-role user requires root.

    Permission logic:
      - Creating admin user (is_admin=True or user_role="admin") -> require_root
      - Creating regular/premium user -> require_admin
    """
    logger.info("Create user request", {
        "operator": str(current_user.id),
        "endpoint": "/user/create",
        "method": "POST",
        "username": user_data.username,
        "email": user_data.email,
        "is_admin": user_data.is_admin,
        "user_role": user_data.user_role,
        "timestamp": datetime.now().isoformat()
    })

    try:
        # If creating an admin user, only root is allowed
        if user_data.is_admin or user_data.user_role == "admin":
            if not current_user.is_root:
                logger.warning("Non-root user attempted to create admin", {
                    "operator": str(current_user.id),
                    "operator_username": current_user.username,
                })
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "success": False,
                        "message": "创建管理员需要超级管理员权限",
                        "error_code": "FORBIDDEN",
                        "error_details": {"reason": "Root privilege required to create admin users"},
                    },
                )

        result = await user_service.create_user(db=db, user_data=user_data)

        if not result["success"]:
            logger.warning("User creation failed", {
                "username": user_data.username,
                "error": result.get("message", "Unknown error"),
                "error_code": result.get("error_code")
            })

            if result.get("error_code") in ["USERNAME_EXISTS", "EMAIL_EXISTS"]:
                status_code = 409
            elif result.get("error_code") == "SERVICE_UNAVAILABLE":
                status_code = 503
            else:
                status_code = 400

            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "用户创建失败")
            )

        logger.info("User created successfully", {
            "user_id": result["user"]["id"],
            "username": result["user"]["username"],
            "email": result["user"]["email"]
        })

        return UserCreateResponse(
            success=True,
            message="用户创建成功",
            timestamp=datetime.now(),
            user=result["user"]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("User creation endpoint exception", {
            "username": user_data.username,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# DELETE /user/delete/{user_id}
# ---------------------------------------------------------------------------

@router.delete("/delete/{user_id}")
async def delete_user(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Delete a user.
    Requires: admin.

    Permission logic:
      - Deleting root user -> 403 (root user cannot be deleted)
      - Deleting admin user -> require_root
      - Deleting regular/premium user -> require_admin
    """
    logger.info("Delete user request", {
        "operator": str(current_user.id),
        "endpoint": "/user/delete/{user_id}",
        "method": "DELETE",
        "user_id": user_id,
        "timestamp": datetime.now().isoformat()
    })

    try:
        # Load the target user to check role protection
        target_user = await _load_target_user(db, user_id)

        # Prevent self-deletion
        if target_user.id == current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "message": "不能删除自己的账户",
                    "error_code": "FORBIDDEN",
                    "error_details": {"reason": "Cannot delete your own account"},
                },
            )

        # Root user cannot be deleted
        if target_user.is_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "message": "无法删除超级管理员",
                    "error_code": "FORBIDDEN",
                    "error_details": {"reason": "Root user cannot be deleted"},
                },
            )

        # Deleting an admin requires root
        _check_admin_target_protection(target_user, current_user)

        # Clear session before deleting
        await user_service.force_logout_user(db=db, user_id=user_id)

        result = await user_service.delete_user(db=db, user_id=user_id)

        if not result["success"]:
            logger.warning("User deletion failed", {
                "user_id": user_id,
                "error": result.get("message", "Unknown error"),
                "error_code": result.get("error_code")
            })

            if result.get("error_code") == "USER_NOT_FOUND":
                status_code = 404
            elif result.get("error_code") == "SERVICE_UNAVAILABLE":
                status_code = 503
            else:
                status_code = 400

            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "用户删除失败")
            )

        logger.info("User deleted successfully", {
            "user_id": user_id
        })

        return {
            "success": True,
            "message": "用户删除成功",
            "timestamp": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("User deletion endpoint exception", {
            "user_id": user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# POST /user/toggle-status/{user_id}
# ---------------------------------------------------------------------------

@router.post("/toggle-status/{user_id}")
async def toggle_user_status(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Toggle a user's active/disabled status.
    Requires: admin. Admin targets require root. Root cannot be toggled.
    """
    logger.info("Toggle user status request", {
        "operator": str(current_user.id),
        "user_id": user_id,
        "timestamp": datetime.now().isoformat(),
    })

    try:
        target_user = await _load_target_user(db, user_id)

        if target_user.is_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "message": "不能禁用根用户",
                    "error_code": "FORBIDDEN",
                },
            )

        _check_admin_target_protection(target_user, current_user)

        result = await user_service.toggle_user_status(db=db, user_id=user_id)

        if not result["success"]:
            raise HTTPException(
                status_code=404 if result.get("error_code") == "USER_NOT_FOUND" else 500,
                detail=result.get("message", "状态切换失败"),
            )

        return {
            "success": True,
            "message": result["message"],
            "timestamp": datetime.now().isoformat(),
            "data": result.get("data"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Toggle status exception", {"user_id": user_id, "error": str(e)})
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# POST /user/reset-password/{user_id}
# ---------------------------------------------------------------------------

@router.post("/reset-password/{user_id}")
async def reset_user_password(
    user_id: str,
    body: Optional[ResetPasswordRequest] = Body(default=None),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Reset a user's password.
    Requires: admin. Admin targets require root. Root password cannot be reset (edit .env).
    """
    logger.info("Reset password request", {
        "operator": str(current_user.id),
        "user_id": user_id,
        "timestamp": datetime.now().isoformat(),
    })

    try:
        target_user = await _load_target_user(db, user_id)

        if target_user.is_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "message": "不能重置根用户密码，请修改 .env",
                    "error_code": "FORBIDDEN",
                },
            )

        _check_admin_target_protection(target_user, current_user)

        new_password = body.new_password if body else None
        result = await user_service.reset_user_password(
            db=db, user_id=user_id, new_password=new_password
        )

        if not result["success"]:
            raise HTTPException(
                status_code=404 if result.get("error_code") == "USER_NOT_FOUND" else 500,
                detail=result.get("message", "密码重置失败"),
            )

        response: Dict[str, Any] = {
            "success": True,
            "message": result["message"],
            "timestamp": datetime.now().isoformat(),
        }
        if result.get("data"):
            response["data"] = result["data"]

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Reset password exception", {"user_id": user_id, "error": str(e)})
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# GET /user/login-history/{user_id}
# ---------------------------------------------------------------------------

@router.get("/login-history/{user_id}")
async def get_login_history(
    user_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Get login history for a user.
    Requires: admin. Admin callers can only view non-admin user history. Root can view all.
    """
    logger.info("Get login history request", {
        "operator": str(current_user.id),
        "user_id": user_id,
        "timestamp": datetime.now().isoformat(),
    })

    try:
        target_user = await _load_target_user(db, user_id)

        # Admin can only view non-admin user history
        if not current_user.is_root and (target_user.is_admin or target_user.is_root):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "message": "管理员只能查看非管理员用户的登录历史",
                    "error_code": "FORBIDDEN",
                },
            )

        result = await user_service.get_login_history(
            db=db, user_id=user_id, page=page, page_size=page_size
        )

        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("message", "查询失败"))

        return {
            "success": True,
            "message": result["message"],
            "timestamp": datetime.now().isoformat(),
            "data": result["data"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Get login history exception", {"user_id": user_id, "error": str(e)})
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# POST /user/force-logout/{user_id}
# ---------------------------------------------------------------------------

@router.post("/force-logout/{user_id}")
async def force_logout_user(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Force-logout a user by clearing their session.
    Requires: admin. Admin targets require root. Root cannot be force-logged-out.
    """
    logger.info("Force logout request", {
        "operator": str(current_user.id),
        "user_id": user_id,
        "timestamp": datetime.now().isoformat(),
    })

    try:
        target_user = await _load_target_user(db, user_id)

        if target_user.is_root:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "message": "不能强制下线根用户",
                    "error_code": "FORBIDDEN",
                },
            )

        _check_admin_target_protection(target_user, current_user)

        result = await user_service.force_logout_user(db=db, user_id=user_id)

        if not result["success"]:
            raise HTTPException(
                status_code=404 if result.get("error_code") == "USER_NOT_FOUND" else 500,
                detail=result.get("message", "强制下线失败"),
            )

        return {
            "success": True,
            "message": result["message"],
            "timestamp": datetime.now().isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Force logout exception", {"user_id": user_id, "error": str(e)})
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ---------------------------------------------------------------------------
# GET /user/stats
# ---------------------------------------------------------------------------

@router.get("/stats")
async def get_user_stats(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Get aggregated user statistics.
    Requires: admin.
    """
    logger.info("Get user stats request", {
        "operator": str(current_user.id),
        "timestamp": datetime.now().isoformat(),
    })

    try:
        result = await user_service.get_user_stats(db=db)

        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("message", "统计获取失败"))

        return {
            "success": True,
            "message": result["message"],
            "timestamp": datetime.now().isoformat(),
            "data": result["data"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Get user stats exception", {"error": str(e)})
        raise HTTPException(status_code=500, detail="服务器内部错误")
