"""
Authentication router for user login and management endpoints.
"""

from fastapi import APIRouter, HTTPException, status, Request
from typing import Dict, Any

from app.models.auth_models import (
    UserLogin, 
    UserLoginResponse, 
    UserLoginErrorResponse,
    UserRegistration,
    UserRegistrationResponse,
    SessionValidationRequest,
    SessionValidationResponse
)
from app.services.auth_service import auth_service
from app.services.session_service import session_service
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=UserLoginResponse)
async def login_user(login_data: UserLogin, request: Request) -> UserLoginResponse:
    """
    用户登录接口
    
    Args:
        login_data: 用户登录凭据
        request: FastAPI请求对象，用于获取设备信息
        
    Returns:
        UserLoginResponse: 登录结果，包含用户信息和会话令牌
        
    Raises:
        HTTPException: 登录失败时抛出异常
    """
    try:
        # 获取设备信息和IP地址
        device_info = request.headers.get("user-agent")
        ip_address = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip") or request.client.host if request.client else None
        
        logger.info("接收到用户登录请求", {
            "username": login_data.username,
            "endpoint": "/auth/login",
            "device_info": device_info[:100] if device_info else None,
            "ip_address": ip_address
        })
        
        # 调用认证服务进行用户验证（包含会话管理）
        auth_result = await auth_service.authenticate_user(
            login_data=login_data,
            device_info=device_info,
            ip_address=ip_address
        )
        
        if auth_result["success"]:
            logger.info("用户登录成功", {
                "username": login_data.username,
                "user_id": auth_result["user"].id,
                "is_admin": auth_result["user"].is_admin,
                "user_role": auth_result["user"].user_role,
                "has_session": auth_result.get("session_token") is not None
            })
            
            return UserLoginResponse(
                success=True,
                message=auth_result["message"],
                user=auth_result["user"],
                session_token=auth_result.get("session_token")
            )
        else:
            logger.warning("用户登录失败", {
                "username": login_data.username,
                "error_code": auth_result.get("error_code"),
                "message": auth_result["message"]
            })
            
            # 根据错误类型返回不同的HTTP状态码
            if auth_result.get("error_code") == "INVALID_CREDENTIALS":
                status_code = status.HTTP_401_UNAUTHORIZED
            elif auth_result.get("error_code") == "SERVICE_UNAVAILABLE":
                status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            else:
                status_code = status.HTTP_400_BAD_REQUEST
            
            raise HTTPException(
                status_code=status_code,
                detail={
                    "success": False,
                    "message": auth_result["message"],
                    "error_code": auth_result.get("error_code", "LOGIN_FAILED")
                }
            )
            
    except HTTPException:
        # 重新抛出HTTP异常
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error("用户登录接口异常", {
            "username": login_data.username,
            "error": error_msg,
            "error_type": type(e).__name__
        })
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "message": "登录服务异常",
                "error_code": "INTERNAL_SERVER_ERROR"
            }
        )


@router.post("/register", response_model=UserRegistrationResponse)
async def register_user(registration_data: UserRegistration) -> UserRegistrationResponse:
    """
    用户注册接口
    
    Args:
        registration_data: 用户注册数据
        
    Returns:
        UserRegistrationResponse: 注册结果，包含用户信息
        
    Raises:
        HTTPException: 注册失败时抛出异常
    """
    try:
        logger.info("接收到用户注册请求", {
            "username": registration_data.username,
            "email": registration_data.email,
            "endpoint": "/auth/register"
        })
        
        # 调用认证服务进行用户注册
        register_result = await auth_service.register_user(registration_data)
        
        if register_result["success"]:
            logger.info("用户注册成功", {
                "username": registration_data.username,
                "user_id": register_result["user"].id,
                "email": registration_data.email
            })
            
            return UserRegistrationResponse(
                success=True,
                message=register_result["message"],
                user=register_result["user"]
            )
        else:
            logger.warning("用户注册失败", {
                "username": registration_data.username,
                "email": registration_data.email,
                "error_code": register_result.get("error_code"),
                "message": register_result["message"]
            })
            
            # 根据错误类型返回不同的HTTP状态码
            if register_result.get("error_code") in ["USERNAME_EXISTS", "EMAIL_EXISTS"]:
                status_code = status.HTTP_409_CONFLICT
            elif register_result.get("error_code") == "SERVICE_UNAVAILABLE":
                status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            else:
                status_code = status.HTTP_400_BAD_REQUEST
            
            raise HTTPException(
                status_code=status_code,
                detail={
                    "success": False,
                    "message": register_result["message"],
                    "error_code": register_result.get("error_code", "REGISTRATION_FAILED")
                }
            )
            
    except HTTPException:
        # 重新抛出HTTP异常
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error("用户注册接口异常", {
            "username": registration_data.username,
            "email": registration_data.email,
            "error": error_msg,
            "error_type": type(e).__name__
        })
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "message": "注册服务异常",
                "error_code": "INTERNAL_SERVER_ERROR"
            }
        )


@router.post("/validate-session", response_model=SessionValidationResponse)
async def validate_session(validation_data: SessionValidationRequest) -> SessionValidationResponse:
    """
    会话验证接口
    
    Args:
        validation_data: 会话验证数据（用户ID和会话令牌）
        
    Returns:
        SessionValidationResponse: 会话验证结果
        
    Raises:
        HTTPException: 验证服务异常时抛出异常
    """
    try:
        logger.info("接收到会话验证请求", {
            "user_id": validation_data.user_id,
            "endpoint": "/auth/validate-session"
        })
        
        # 调用会话服务进行验证
        validation_result = await session_service.validate_session(
            user_id=validation_data.user_id,
            session_token=validation_data.session_token
        )
        
        if validation_result.get("success"):
            is_valid = validation_result.get("valid", False)
            reason = validation_result.get("reason")
            
            logger.info("会话验证完成", {
                "user_id": validation_data.user_id,
                "valid": is_valid,
                "reason": reason
            })
            
            return SessionValidationResponse(
                success=True,
                message=validation_result.get("message", "验证完成"),
                valid=is_valid,
                reason=reason
            )
        else:
            logger.warning("会话验证失败", {
                "user_id": validation_data.user_id,
                "error_code": validation_result.get("error_code"),
                "message": validation_result.get("message")
            })
            
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "success": False,
                    "message": validation_result.get("message", "会话验证服务异常"),
                    "error_code": validation_result.get("error_code", "VALIDATION_ERROR")
                }
            )
            
    except HTTPException:
        # 重新抛出HTTP异常
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error("会话验证接口异常", {
            "user_id": validation_data.user_id,
            "error": error_msg,
            "error_type": type(e).__name__
        })
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "message": "会话验证服务异常",
                "error_code": "INTERNAL_SERVER_ERROR"
            }
        )


@router.get("/health")
async def auth_health_check() -> Dict[str, Any]:
    """
    认证服务健康检查接口
    
    Returns:
        Dict: 健康检查结果
    """
    try:
        logger.info("认证服务健康检查请求", {"endpoint": "/auth/health"})
        
        health_result = auth_service.health_check()
        
        logger.info("认证服务健康检查完成", {
            "status": health_result["status"],
            "service": health_result["service"]
        })
        
        return health_result
        
    except Exception as e:
        error_msg = str(e)
        logger.error("认证服务健康检查异常", {
            "error": error_msg,
            "error_type": type(e).__name__
        })
        
        return {
            "service": "AuthService",
            "status": "unhealthy",
            "message": f"健康检查异常: {error_msg}"
        } 