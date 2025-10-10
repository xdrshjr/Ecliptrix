"""
User profile management router.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
from datetime import datetime

from app.models.user_models import (
    UserProfileUpdate, 
    UserProfileResponse, 
    UserListResponse,
    UserCreateRequest,
    UserCreateResponse
)
from app.services.user_service import UserService
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/user", tags=["user"])

# Initialize user service
user_service = UserService()


@router.get("/profile", response_model=UserProfileResponse)
async def get_user_profile(user_id: str = "admin") -> UserProfileResponse:
    """
    获取用户资料信息
    
    Args:
        user_id: 用户ID（暂时使用默认admin用户）
        
    Returns:
        UserProfileResponse: 用户资料响应
        
    Raises:
        HTTPException: 当用户不存在或服务不可用时
    """
    logger.info("获取用户资料", {
        "user_id": user_id,
        "endpoint": "/user/profile",
        "method": "GET",
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        result = await user_service.get_user_profile(user_id)
        
        if not result["success"]:
            logger.warning("用户资料获取失败", {
                "user_id": user_id,
                "error": result.get("message", "Unknown error")
            })
            raise HTTPException(
                status_code=404 if result.get("error_code") == "USER_NOT_FOUND" else 500,
                detail=result.get("message", "获取用户资料失败")
            )
        
        logger.info("用户资料获取成功", {
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
        logger.error("用户资料获取异常", {
            "user_id": user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


@router.put("/profile", response_model=UserProfileResponse)
async def update_user_profile(
    profile_data: UserProfileUpdate,
    user_id: str = "admin"
) -> UserProfileResponse:
    """
    更新用户资料信息
    
    Args:
        profile_data: 用户资料更新数据
        user_id: 用户ID（暂时使用默认admin用户）
        
    Returns:
        UserProfileResponse: 更新后的用户资料响应
        
    Raises:
        HTTPException: 当用户不存在、验证失败或服务不可用时
    """
    logger.info("更新用户资料", {
        "user_id": user_id,
        "endpoint": "/user/profile",
        "method": "PUT",
        "username": profile_data.username,
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        result = await user_service.update_user_profile(user_id, profile_data)
        
        if not result["success"]:
            logger.warning("用户资料更新失败", {
                "user_id": user_id,
                "error": result.get("message", "Unknown error"),
                "error_code": result.get("error_code")
            })
            
            status_code = 404 if result.get("error_code") == "USER_NOT_FOUND" else 400
            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "用户资料更新失败")
            )
        
        logger.info("用户资料更新成功", {
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
        logger.error("用户资料更新异常", {
            "user_id": user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """
    用户服务健康检查
    
    Returns:
        Dict: 健康状态信息
    """
    logger.info("用户服务健康检查", {
        "endpoint": "/user/health",
        "timestamp": datetime.now().isoformat()
    })
    
    service_status = user_service.check_health()
    
    return {
        "success": True,
        "message": "用户服务运行正常",
        "timestamp": datetime.now().isoformat(),
        "service": "UserService",
        "status": "healthy" if service_status else "unhealthy",
        "database_connected": service_status
    }


@router.get("/list", response_model=UserListResponse)
async def list_all_users() -> UserListResponse:
    """
    获取所有用户列表（管理员专用）
    
    Returns:
        UserListResponse: 用户列表响应
        
    Raises:
        HTTPException: 当服务不可用或查询失败时
    """
    logger.info("获取所有用户列表", {
        "endpoint": "/user/list",
        "method": "GET",
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        result = await user_service.get_all_users()
        
        if not result["success"]:
            logger.warning("获取用户列表失败", {
                "error": result.get("message", "Unknown error"),
                "error_code": result.get("error_code")
            })
            raise HTTPException(
                status_code=500,
                detail=result.get("message", "获取用户列表失败")
            )
        
        logger.info("用户列表获取成功", {
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
        logger.error("用户列表获取异常", {
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


@router.post("/create", response_model=UserCreateResponse)
async def create_user(user_data: UserCreateRequest) -> UserCreateResponse:
    """
    创建新用户（管理员专用）
    
    Args:
        user_data: 用户创建数据
        
    Returns:
        UserCreateResponse: 创建的用户信息响应
        
    Raises:
        HTTPException: 当创建失败或服务不可用时
    """
    logger.info("创建新用户请求", {
        "endpoint": "/user/create",
        "method": "POST",
        "username": user_data.username,
        "email": user_data.email,
        "is_admin": user_data.is_admin,
        "user_role": user_data.user_role,
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        result = await user_service.create_user(user_data)
        
        if not result["success"]:
            logger.warning("用户创建失败", {
                "username": user_data.username,
                "error": result.get("message", "Unknown error"),
                "error_code": result.get("error_code")
            })
            
            # 根据错误类型返回不同的HTTP状态码
            if result.get("error_code") in ["USERNAME_EXISTS", "EMAIL_EXISTS"]:
                status_code = 409  # Conflict
            elif result.get("error_code") == "SERVICE_UNAVAILABLE":
                status_code = 503  # Service Unavailable
            else:
                status_code = 400  # Bad Request
            
            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "用户创建失败")
            )
        
        logger.info("用户创建成功", {
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
        logger.error("用户创建接口异常", {
            "username": user_data.username,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


@router.delete("/delete/{user_id}")
async def delete_user(user_id: str) -> Dict[str, Any]:
    """
    删除用户（管理员专用）
    
    Args:
        user_id: 要删除的用户ID
        
    Returns:
        Dict: 删除结果
        
    Raises:
        HTTPException: 当删除失败或服务不可用时
    """
    logger.info("删除用户请求", {
        "endpoint": "/user/delete/{user_id}",
        "method": "DELETE",
        "user_id": user_id,
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        result = await user_service.delete_user(user_id)
        
        if not result["success"]:
            logger.warning("用户删除失败", {
                "user_id": user_id,
                "error": result.get("message", "Unknown error"),
                "error_code": result.get("error_code")
            })
            
            # 根据错误类型返回不同的HTTP状态码
            if result.get("error_code") == "USER_NOT_FOUND":
                status_code = 404  # Not Found
            elif result.get("error_code") == "SERVICE_UNAVAILABLE":
                status_code = 503  # Service Unavailable
            else:
                status_code = 400  # Bad Request
            
            raise HTTPException(
                status_code=status_code,
                detail=result.get("message", "用户删除失败")
            )
        
        logger.info("用户删除成功", {
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
        logger.error("用户删除接口异常", {
            "user_id": user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误") 