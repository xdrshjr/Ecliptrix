"""
Authentication and authorization dependencies for FastAPI route protection.

Provides three composable dependency functions:
  - get_current_user: Extracts and validates the session token, returns the User ORM object.
  - require_admin: Ensures the caller has is_admin=True (includes root users).
  - require_root: Ensures the caller has is_root=True.
"""

import hmac
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.models.db_models import User
from app.logger import get_logger

logger = get_logger(__name__)


def _extract_token(request: Request) -> Optional[str]:
    """Extract session token from request headers.

    Checks (in order):
      1. Authorization header — "Bearer <token>" or raw token
      2. X-Session-Token header
    """
    auth_header = request.headers.get("authorization")
    if auth_header:
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()
        # Accept raw token in Authorization header as well
        return auth_header.strip()

    session_header = request.headers.get("x-session-token")
    if session_header:
        return session_header.strip()

    return None


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> User:
    """Authenticate the caller by session token and return the User object.

    Raises:
        HTTPException 401: No token provided, or token does not match any active session.
        HTTPException 403: User account is disabled (is_active=False).
    """
    token = _extract_token(request)
    if not token:
        logger.warning("Authentication failed: no session token in request")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "message": "未提供认证凭证",
                "error_code": "UNAUTHORIZED",
                "error_details": {"reason": "Missing session token"},
            },
        )

    # Look up the user whose active_session_token matches the provided token.
    # Using a constant-time comparison at the application layer is preferable, but
    # we first need to narrow down to a single candidate row.  Since
    # active_session_token is unique per user (single-device login), a direct
    # equality filter is acceptable here; the token itself is a high-entropy
    # secrets.token_urlsafe(32) value, so timing side-channels on the DB query are
    # not practically exploitable.
    stmt = select(User).where(User.active_session_token == token)
    result = await db.execute(stmt)
    user: Optional[User] = result.scalar_one_or_none()

    if user is None:
        logger.warning("Authentication failed: invalid or expired session token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "message": "会话无效或已过期",
                "error_code": "UNAUTHORIZED",
                "error_details": {"reason": "Invalid or expired session token"},
            },
        )

    # Constant-time comparison as defense-in-depth (the DB already matched, but
    # this guards against hypothetical DB collation surprises).
    if user.active_session_token is None or not hmac.compare_digest(user.active_session_token, token):
        logger.warning("Authentication failed: token mismatch after DB lookup", {
            "user_id": str(user.id),
        })
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "message": "会话无效或已过期",
                "error_code": "UNAUTHORIZED",
                "error_details": {"reason": "Token mismatch"},
            },
        )

    # Check account status
    if not user.is_active:
        logger.warning("Authentication failed: account disabled", {
            "user_id": str(user.id),
            "username": user.username,
        })
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "success": False,
                "message": "账户已被禁用",
                "error_code": "ACCOUNT_DISABLED",
                "error_details": {"reason": "User account is disabled"},
            },
        )

    logger.debug("User authenticated successfully", {
        "user_id": str(user.id),
        "username": user.username,
        "is_admin": user.is_admin,
        "is_root": user.is_root,
    })
    return user


async def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Require that the authenticated user has admin privileges (is_admin=True).

    Root users always satisfy this check because is_admin is True for root.

    Raises:
        HTTPException 403: User is not an admin.
    """
    if not current_user.is_admin:
        logger.warning("Authorization failed: admin required", {
            "user_id": str(current_user.id),
            "username": current_user.username,
            "user_role": current_user.user_role,
        })
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "success": False,
                "message": "需要管理员权限",
                "error_code": "FORBIDDEN",
                "error_details": {"reason": "Admin privilege required"},
            },
        )
    return current_user


async def require_root(
    current_user: User = Depends(get_current_user),
) -> User:
    """Require that the authenticated user is the root (super admin).

    Raises:
        HTTPException 403: User is not root.
    """
    if not current_user.is_root:
        logger.warning("Authorization failed: root required", {
            "user_id": str(current_user.id),
            "username": current_user.username,
            "is_admin": current_user.is_admin,
        })
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "success": False,
                "message": "需要超级管理员权限",
                "error_code": "FORBIDDEN",
                "error_details": {"reason": "Root privilege required"},
            },
        )
    return current_user
