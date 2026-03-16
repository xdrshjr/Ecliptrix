"""
Authentication models for the Basic Service application.
"""

from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from .base_models import BaseResponse

# User role type definition
UserRole = Literal["admin", "regular", "premium"]


class UserLogin(BaseModel):
    """User login request model."""
    username: str = Field(..., description="Username", min_length=3, max_length=50)
    password: str = Field(..., description="Password", min_length=1)


class UserInfo(BaseModel):
    """User information model."""
    id: str = Field(..., description="User ID")
    username: str = Field(..., description="Username")
    email: str = Field(..., description="Email address")
    full_name: Optional[str] = Field(None, description="Full name")
    avatar_url: Optional[str] = Field(None, description="Avatar URL")
    is_active: bool = Field(True, description="Whether user is active")
    is_admin: bool = Field(False, description="Whether user is admin")
    is_root: bool = Field(False, description="Whether user is root (super admin)")
    user_role: UserRole = Field("regular", description="User role: admin, regular, or premium")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: datetime = Field(..., description="Last update time")
    last_login_at: Optional[datetime] = Field(None, description="Last login time")

    model_config = ConfigDict(from_attributes=True)


class UserLoginResponse(BaseResponse):
    """User login response model."""
    user: Optional[UserInfo] = Field(None, description="User information")
    token: Optional[str] = Field(None, description="Authentication token (if applicable)")
    session_token: Optional[str] = Field(None, description="Session token for single device login")


class UserLoginErrorResponse(BaseResponse):
    """User login error response model."""
    error_code: str = Field(..., description="Error code")
    error_details: Optional[dict] = Field(None, description="Error details")


class UserRegistration(BaseModel):
    """User registration request model."""
    username: str = Field(..., description="Username", min_length=3, max_length=50)
    email: EmailStr = Field(..., description="Email address")
    password: str = Field(..., description="Password", min_length=6, max_length=100)
    full_name: Optional[str] = Field(None, description="Full name", max_length=255)
    invite_code: str = Field(..., description="Invite code for registration")


class UserRegistrationResponse(BaseResponse):
    """User registration response model."""
    user: Optional[UserInfo] = Field(None, description="Created user information")


class PasswordChangeRequest(BaseModel):
    """Password change request model."""
    current_password: str = Field(..., description="Current password")
    new_password: str = Field(..., description="New password", min_length=6)


class UserUpdateRequest(BaseModel):
    """User update request model."""
    full_name: Optional[str] = Field(None, description="Full name", max_length=255)
    email: Optional[EmailStr] = Field(None, description="Email address")
    avatar_url: Optional[str] = Field(None, description="Avatar URL")


class UserUpdateResponse(BaseResponse):
    """User update response model."""
    user: Optional[UserInfo] = Field(None, description="Updated user information")


class SessionValidationRequest(BaseModel):
    """Session validation request model."""
    user_id: str = Field(..., description="User ID")
    session_token: str = Field(..., description="Session token to validate")


class SessionValidationResponse(BaseResponse):
    """Session validation response model."""
    valid: bool = Field(..., description="Whether session is valid")
    reason: Optional[str] = Field(None, description="Reason if session is invalid")
    is_root: Optional[bool] = Field(None, description="Whether user is root (included when valid=True)")