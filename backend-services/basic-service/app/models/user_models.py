"""
User profile data models.
"""

from pydantic import BaseModel, EmailStr, Field, validator
from typing import Optional, Dict, Any
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


class UserSettingsUpdate(BaseModel):
    """用户设置更新数据模型"""
    notifications: Optional[Dict[str, bool]] = Field(None, description="通知设置")
    privacy: Optional[Dict[str, bool]] = Field(None, description="隐私设置")
    preferences: Optional[Dict[str, Any]] = Field(None, description="偏好设置")

    class Config:
        schema_extra = {
            "example": {
                "notifications": {
                    "email": True,
                    "push": False,
                    "marketing": False
                },
                "privacy": {
                    "profile_visible": True,
                    "activity_visible": False
                },
                "preferences": {
                    "theme": "light",
                    "language": "zh-CN"
                }
            }
        } 