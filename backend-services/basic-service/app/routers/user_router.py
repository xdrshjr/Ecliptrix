"""
User profile management router.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_models import (
    UserProfileUpdate,
    UserProfileResponse,
    UserListResponse,
    UserCreateRequest,
    UserCreateResponse
)
from app.services.user_service import user_service
from app.database import get_db_session
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/profile", response_model=UserProfileResponse)
async def get_user_profile(
    user_id: str = "admin",
    db: AsyncSession = Depends(get_db_session)
) -> UserProfileResponse:
    """
    Get user profile information.
    """
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


@router.put("/profile", response_model=UserProfileResponse)
async def update_user_profile(
    profile_data: UserProfileUpdate,
    user_id: str = "admin",
    db: AsyncSession = Depends(get_db_session)
) -> UserProfileResponse:
    """
    Update user profile information.
    """
    logger.info("Updating user profile", {
        "user_id": user_id,
        "endpoint": "/user/profile",
        "method": "PUT",
        "username": profile_data.username,
        "timestamp": datetime.now().isoformat()
    })

    try:
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


@router.get("/list", response_model=UserListResponse)
async def list_all_users(
    db: AsyncSession = Depends(get_db_session)
) -> UserListResponse:
    """
    Get all users list (admin only).
    """
    logger.info("Getting all users list", {
        "endpoint": "/user/list",
        "method": "GET",
        "timestamp": datetime.now().isoformat()
    })

    try:
        result = await user_service.get_all_users(db=db)

        if not result["success"]:
            logger.warning("Get user list failed", {
                "error": result.get("message", "Unknown error"),
                "error_code": result.get("error_code")
            })
            raise HTTPException(
                status_code=500,
                detail=result.get("message", "获取用户列表失败")
            )

        logger.info("User list retrieved successfully", {
            "total_count": result["total_count"]
        })

        return UserListResponse(
            success=True,
            message="用户列表获取成功",
            timestamp=datetime.now(),
            total_count=result["total_count"],
            users=result["users"]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("User list retrieval exception", {
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


@router.post("/create", response_model=UserCreateResponse)
async def create_user(
    user_data: UserCreateRequest,
    db: AsyncSession = Depends(get_db_session)
) -> UserCreateResponse:
    """
    Create a new user (admin only).
    """
    logger.info("Create user request", {
        "endpoint": "/user/create",
        "method": "POST",
        "username": user_data.username,
        "email": user_data.email,
        "is_admin": user_data.is_admin,
        "user_role": user_data.user_role,
        "timestamp": datetime.now().isoformat()
    })

    try:
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


@router.delete("/delete/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Delete a user (admin only).
    """
    logger.info("Delete user request", {
        "endpoint": "/user/delete/{user_id}",
        "method": "DELETE",
        "user_id": user_id,
        "timestamp": datetime.now().isoformat()
    })

    try:
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
