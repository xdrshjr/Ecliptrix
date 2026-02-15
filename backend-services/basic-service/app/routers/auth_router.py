"""
Authentication router for user login and management endpoints.
"""

from fastapi import APIRouter, HTTPException, status, Request, Depends
from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.database import get_db_session
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=UserLoginResponse)
async def login_user(
    login_data: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db_session)
) -> UserLoginResponse:
    """
    User login endpoint.
    """
    try:
        device_info = request.headers.get("user-agent")
        ip_address = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip") or request.client.host if request.client else None

        logger.info("Login request received", {
            "username": login_data.username,
            "endpoint": "/auth/login",
            "device_info": device_info[:100] if device_info else None,
            "ip_address": ip_address
        })

        auth_result = await auth_service.authenticate_user(
            db=db,
            login_data=login_data,
            device_info=device_info,
            ip_address=ip_address
        )

        if auth_result["success"]:
            logger.info("User login successful", {
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
            logger.warning("User login failed", {
                "username": login_data.username,
                "error_code": auth_result.get("error_code"),
                "message": auth_result["message"]
            })

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
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error("Login endpoint exception", {
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
async def register_user(
    registration_data: UserRegistration,
    db: AsyncSession = Depends(get_db_session)
) -> UserRegistrationResponse:
    """
    User registration endpoint.
    """
    try:
        logger.info("Registration request received", {
            "username": registration_data.username,
            "email": registration_data.email,
            "endpoint": "/auth/register"
        })

        register_result = await auth_service.register_user(db=db, registration_data=registration_data)

        if register_result["success"]:
            logger.info("User registration successful", {
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
            logger.warning("User registration failed", {
                "username": registration_data.username,
                "email": registration_data.email,
                "error_code": register_result.get("error_code"),
                "message": register_result["message"]
            })

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
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error("Registration endpoint exception", {
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
async def validate_session(
    validation_data: SessionValidationRequest,
    db: AsyncSession = Depends(get_db_session)
) -> SessionValidationResponse:
    """
    Session validation endpoint.
    """
    try:
        logger.info(f"Session validation request - user_id={validation_data.user_id}, token_length={len(validation_data.session_token) if validation_data.session_token else 0}")

        validation_result = await session_service.validate_session(
            db=db,
            user_id=validation_data.user_id,
            session_token=validation_data.session_token
        )

        if validation_result.get("success"):
            is_valid = validation_result.get("valid", False)
            reason = validation_result.get("reason")

            logger.info("Session validation completed", {
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
            logger.warning("Session validation failed", {
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
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error("Session validation endpoint exception", {
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
async def auth_health_check(
    db: AsyncSession = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Authentication service health check endpoint.
    """
    try:
        logger.info("Auth service health check request", {"endpoint": "/auth/health"})

        health_result = await auth_service.health_check(db=db)

        logger.info("Auth service health check completed", {
            "status": health_result["status"],
            "service": health_result["service"]
        })

        return health_result

    except Exception as e:
        error_msg = str(e)
        logger.error("Auth service health check exception", {
            "error": error_msg,
            "error_type": type(e).__name__
        })

        return {
            "service": "AuthService",
            "status": "unhealthy",
            "message": f"健康检查异常: {error_msg}"
        }
