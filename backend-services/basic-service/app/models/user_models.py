"""
User profile data models.
"""

from pydantic import BaseModel, ConfigDict, EmailStr, Field, validator
from typing import Literal, Optional, Dict, Any
from datetime import datetime


class UserProfileUpdate(BaseModel):
    """用户资料更新数据模型"""
    username: str = Field(..., min_length=3, max_length=50, description="用户名，3-50字符")
    email: Optional[EmailStr] = Field(None, description="邮箱地址")
    full_name: Optional[str] = Field(None, max_length=100, description="全名，最多100字符")
    avatar_url: Optional[str] = Field(None, max_length=500, description="头像URL，最多500字符")

    @validator('username')
    def validate_username(cls, v):
        """验证用户名格式"""
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError('用户名只能包含字母、数字、下划线和连字符')
        return v

    @validator('avatar_url')
    def validate_avatar_url(cls, v):
        """验证头像URL格式"""
        if v and not (v.startswith('http://') or v.startswith('https://')):
            raise ValueError('头像URL必须以http://或https://开头')
        return v

    class Config:
        schema_extra = {
            "example": {
                "username": "admin",
                "email": "admin@ecliptrix.com",
                "full_name": "System Administrator",
                "avatar_url": "https://example.com/avatar.jpg"
            }
        }


class UserProfile(BaseModel):
    """用户资料数据模型"""
    id: str = Field(..., description="用户ID")
    username: str = Field(..., description="用户名")
    email: Optional[str] = Field(None, description="邮箱地址")
    full_name: Optional[str] = Field(None, description="全名")
    avatar_url: Optional[str] = Field(None, description="头像URL")
    is_active: bool = Field(True, description="是否激活")
    is_admin: bool = Field(False, description="是否为管理员")
    is_root: bool = Field(False, description="是否为超级管理员")
    user_role: str = Field("regular", description="用户角色：admin, regular, premium")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")
    last_login_at: Optional[datetime] = Field(None, description="最后登录时间")

    class Config:
        schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "username": "admin",
                "email": "admin@ecliptrix.com",
                "full_name": "System Administrator",
                "avatar_url": None,
                "is_active": True,
                "is_admin": True,
                "created_at": "2023-12-01T10:00:00.000Z",
                "updated_at": "2023-12-01T12:00:00.000Z",
                "last_login_at": "2023-12-01T12:00:00.000Z"
            }
        }


class UserProfileResponse(BaseModel):
    """用户资料响应模型"""
    success: bool = Field(..., description="操作是否成功")
    message: str = Field(..., description="响应消息")
    timestamp: datetime = Field(..., description="响应时间戳")
    user: UserProfile = Field(..., description="用户资料信息")

    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "用户资料获取成功",
                "timestamp": "2023-12-01T12:00:00.000Z",
                "user": {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "username": "admin",
                    "email": "admin@ecliptrix.com",
                    "full_name": "System Administrator",
                    "avatar_url": None,
                    "is_active": True,
                    "is_admin": True,
                    "created_at": "2023-12-01T10:00:00.000Z",
                    "updated_at": "2023-12-01T12:00:00.000Z",
                    "last_login_at": "2023-12-01T12:00:00.000Z"
                }
            }
        }


class NotificationPrefs(BaseModel):
    """Notification preferences sub-object."""
    model_config = ConfigDict(extra='forbid')
    email: bool = True
    push: bool = False
    marketing: bool = False


class PrivacyPrefs(BaseModel):
    """Privacy visibility sub-object."""
    model_config = ConfigDict(extra='forbid')
    profile_visible: bool = True
    activity_visible: bool = False


class UserPreferences(BaseModel):
    """Authoritative server-side shape for /user/me/preferences."""
    model_config = ConfigDict(extra='forbid')
    notifications: NotificationPrefs = Field(default_factory=NotificationPrefs)
    privacy: PrivacyPrefs = Field(default_factory=PrivacyPrefs)
    language: Literal['en', 'zh-CN'] = 'zh-CN'
    theme: Literal['light', 'dark', 'auto'] = 'dark'


class UserPreferencesUpdate(BaseModel):
    """PATCH body — every top-level field optional; sub-objects are full
    replacements (FE always sends the whole sub-object after toggling a key)."""
    model_config = ConfigDict(extra='forbid')
    notifications: Optional[NotificationPrefs] = None
    privacy: Optional[PrivacyPrefs] = None
    language: Optional[Literal['en', 'zh-CN']] = None
    theme: Optional[Literal['light', 'dark', 'auto']] = None


class UserPreferencesResponse(BaseModel):
    success: bool
    preferences: UserPreferences


# Back-compat alias for any legacy import sites that still reference the
# loose dict-based shape. Prefer ``UserPreferencesUpdate`` for new code.
UserSettingsUpdate = UserPreferencesUpdate


class UserListResponse(BaseModel):
    """用户列表响应模型"""
    success: bool = Field(..., description="操作是否成功")
    message: str = Field(..., description="响应消息")
    timestamp: datetime = Field(..., description="响应时间戳")
    total_count: int = Field(..., description="用户总数")
    users: list[UserProfile] = Field(..., description="用户列表")

    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "用户列表获取成功",
                "timestamp": "2023-12-01T12:00:00.000Z",
                "total_count": 2,
                "users": [
                    {
                        "id": "550e8400-e29b-41d4-a716-446655440000",
                        "username": "admin",
                        "email": "admin@ecliptrix.com",
                        "full_name": "System Administrator",
                        "avatar_url": None,
                        "is_active": True,
                        "is_admin": True,
                        "created_at": "2023-12-01T10:00:00.000Z",
                        "updated_at": "2023-12-01T12:00:00.000Z",
                        "last_login_at": "2023-12-01T12:00:00.000Z"
                    }
                ]
            }
        }


class UserCreateRequest(BaseModel):
    """管理员创建用户请求模型"""
    username: str = Field(..., min_length=3, max_length=50, description="用户名，3-50字符")
    email: Optional[EmailStr] = Field(None, description="邮箱地址")
    password: str = Field(..., min_length=6, max_length=100, description="密码，6-100字符")
    full_name: Optional[str] = Field(None, max_length=255, description="全名，最多255字符")
    avatar_url: Optional[str] = Field(None, max_length=500, description="头像URL，最多500字符")
    is_active: bool = Field(True, description="是否激活")
    is_admin: bool = Field(False, description="是否为管理员")
    user_role: Optional[str] = Field("regular", description="用户角色：admin, regular, premium")

    @validator('username')
    def validate_username(cls, v):
        """验证用户名格式"""
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError('用户名只能包含字母、数字、下划线和连字符')
        return v

    @validator('avatar_url')
    def validate_avatar_url(cls, v):
        """验证头像URL格式"""
        if v and not (v.startswith('http://') or v.startswith('https://')):
            raise ValueError('头像URL必须以http://或https://开头')
        return v
    
    @validator('user_role')
    def validate_user_role(cls, v):
        """验证用户角色"""
        if v not in ['admin', 'regular', 'premium']:
            raise ValueError('用户角色必须是admin, regular或premium之一')
        return v

    class Config:
        schema_extra = {
            "example": {
                "username": "newuser",
                "email": "newuser@ecliptrix.com",
                "password": "password123",
                "full_name": "New User",
                "avatar_url": None,
                "is_active": True,
                "is_admin": False,
                "user_role": "regular"
            }
        }


class UserCreateResponse(BaseModel):
    """创建用户响应模型"""
    success: bool = Field(..., description="操作是否成功")
    message: str = Field(..., description="响应消息")
    timestamp: datetime = Field(..., description="响应时间戳")
    user: UserProfile = Field(..., description="创建的用户信息")

    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "用户创建成功",
                "timestamp": "2023-12-01T12:00:00.000Z",
                "user": {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "username": "newuser",
                    "email": "newuser@ecliptrix.com",
                    "full_name": "New User",
                    "avatar_url": None,
                    "is_active": True,
                    "is_admin": False,
                    "created_at": "2023-12-01T12:00:00.000Z",
                    "updated_at": "2023-12-01T12:00:00.000Z",
                    "last_login_at": None
                }
            }
        }


class ResetPasswordRequest(BaseModel):
    """密码重置请求模型"""
    new_password: Optional[str] = Field(
        None,
        min_length=6,
        max_length=100,
        description="新密码（可选），不提供时自动生成12位随机密码"
    )