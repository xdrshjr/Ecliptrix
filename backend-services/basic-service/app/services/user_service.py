"""
User profile service for user management operations.
"""

from typing import Optional, Dict, Any
from datetime import datetime

try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False

from app.config import settings
from app.logger import get_logger
from app.models.user_models import UserProfileUpdate, UserProfile

logger = get_logger(__name__)


class UserService:
    """Service for handling user profile operations."""
    
    def __init__(self):
        """Initialize user service."""
        if not SUPABASE_AVAILABLE:
            logger.warning("Supabase client not available for user service. Install with: pip install supabase")
            self.client = None
            return
            
        try:
            # Validate environment variables
            if not settings.supabase.url:
                raise ValueError("SUPABASE_URL environment variable is not set or empty")
            if not settings.supabase.anon_key:
                raise ValueError("SUPABASE_ANON_KEY environment variable is not set or empty")
            
            logger.info(f"初始化用户服务，Supabase URL: {settings.supabase.url[:50]}...")
            
            # Create Supabase client for database operations
            self.client: Optional[Client] = create_client(
                settings.supabase.url,
                settings.supabase.anon_key
            )
            
            logger.info("用户服务初始化成功", {
                "service": "UserService",
                "supabase_url": settings.supabase.url[:50] + "..." if len(settings.supabase.url) > 50 else settings.supabase.url
            })
            
        except Exception as e:
            logger.error(f"用户服务初始化失败: {str(e)}")
            logger.error(f"Error type: {type(e).__name__}")
            self.client = None
    
    def _validate_client(self) -> bool:
        """Validate if Supabase client is available."""
        if not self.client:
            logger.error("Supabase client not available")
            return False
        return True
    
    def check_health(self) -> bool:
        """Check if the user service is healthy."""
        return self._validate_client()
    
    async def get_user_profile(self, user_id: str) -> Dict[str, Any]:
        """
        Get user profile information.
        
        Args:
            user_id: User identifier
            
        Returns:
            Dict containing user profile data
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "用户服务不可用",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.info("获取用户资料", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })
            
            # Query user from database by ID or username
            # First try by ID, then by username for backward compatibility
            response = self.client.table('users').select('*').eq('id', user_id).eq('is_active', True).execute()
            
            if not response.data:
                # Try by username
                response = self.client.table('users').select('*').eq('username', user_id).eq('is_active', True).execute()
            
            if not response.data:
                logger.warning("用户不存在", {
                    "user_id": user_id,
                    "query_result": "no_user_found"
                })
                return {
                    "success": False,
                    "message": "用户不存在",
                    "error_code": "USER_NOT_FOUND"
                }
            
            user_data = response.data[0]
            logger.info("用户资料查询成功", {
                "user_id": user_id,
                "username": user_data['username'],
                "is_admin": user_data.get('is_admin', False)
            })
            
            # Convert database fields to API response format
            user_profile = {
                "id": user_data['id'],
                "username": user_data['username'],
                "email": user_data.get('email'),
                "full_name": user_data.get('full_name'),
                "avatar_url": user_data.get('avatar_url'),
                "is_active": user_data.get('is_active', True),
                "is_admin": user_data.get('is_admin', False),
                "created_at": user_data.get('created_at'),
                "updated_at": user_data.get('updated_at'),
                "last_login_at": user_data.get('last_login_at')
            }
            
            return {
                "success": True,
                "message": "用户资料获取成功",
                "user": user_profile
            }
            
        except Exception as e:
            logger.error("用户资料查询异常", {
                "user_id": user_id,
                "error": str(e),
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "用户资料查询失败",
                "error_code": "QUERY_ERROR"
            }
    
    async def update_user_profile(self, user_id: str, profile_data: UserProfileUpdate) -> Dict[str, Any]:
        """
        Update user profile information.
        
        Args:
            user_id: User identifier
            profile_data: Profile update data
            
        Returns:
            Dict containing updated user profile data
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "用户服务不可用",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.info("更新用户资料", {
                "user_id": user_id,
                "username": profile_data.username,
                "timestamp": datetime.now().isoformat()
            })
            
            # First check if user exists
            existing_user_response = self.client.table('users').select('*').eq('id', user_id).eq('is_active', True).execute()
            
            if not existing_user_response.data:
                # Try by username
                existing_user_response = self.client.table('users').select('*').eq('username', user_id).eq('is_active', True).execute()
            
            if not existing_user_response.data:
                logger.warning("用户不存在，无法更新", {
                    "user_id": user_id
                })
                return {
                    "success": False,
                    "message": "用户不存在",
                    "error_code": "USER_NOT_FOUND"
                }
            
            existing_user = existing_user_response.data[0]
            actual_user_id = existing_user['id']
            
            # Check if username is already taken by another user
            if profile_data.username != existing_user['username']:
                username_check_response = self.client.table('users').select('id').eq('username', profile_data.username).execute()
                if username_check_response.data:
                    logger.warning("用户名已被使用", {
                        "user_id": user_id,
                        "username": profile_data.username
                    })
                    return {
                        "success": False,
                        "message": "用户名已被使用",
                        "error_code": "USERNAME_TAKEN"
                    }
            
            # Prepare update data
            update_data = {
                "username": profile_data.username,
                "updated_at": datetime.now().isoformat()
            }
            
            if profile_data.email is not None:
                update_data["email"] = profile_data.email
            if profile_data.full_name is not None:
                update_data["full_name"] = profile_data.full_name
            if profile_data.avatar_url is not None:
                update_data["avatar_url"] = profile_data.avatar_url
            
            # Update user in database
            update_response = self.client.table('users').update(update_data).eq('id', actual_user_id).execute()
            
            if not update_response.data:
                logger.error("用户资料更新失败", {
                    "user_id": user_id,
                    "actual_user_id": actual_user_id
                })
                return {
                    "success": False,
                    "message": "用户资料更新失败",
                    "error_code": "UPDATE_FAILED"
                }
            
            updated_user_data = update_response.data[0]
            logger.info("用户资料更新成功", {
                "user_id": user_id,
                "username": updated_user_data['username']
            })
            
            # Convert database fields to API response format
            user_profile = {
                "id": updated_user_data['id'],
                "username": updated_user_data['username'],
                "email": updated_user_data.get('email'),
                "full_name": updated_user_data.get('full_name'),
                "avatar_url": updated_user_data.get('avatar_url'),
                "is_active": updated_user_data.get('is_active', True),
                "is_admin": updated_user_data.get('is_admin', False),
                "created_at": updated_user_data.get('created_at'),
                "updated_at": updated_user_data.get('updated_at'),
                "last_login_at": updated_user_data.get('last_login_at')
            }
            
            return {
                "success": True,
                "message": "用户资料更新成功",
                "user": user_profile
            }
            
        except Exception as e:
            logger.error("用户资料更新异常", {
                "user_id": user_id,
                "error": str(e),
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "用户资料更新失败",
                "error_code": "UPDATE_ERROR"
            }
    
    async def get_all_users(self) -> Dict[str, Any]:
        """
        Get all users from the database.
        
        Returns:
            Dict containing list of all users
        """
        if not self._validate_client():
            logger.error("用户服务不可用，无法获取用户列表")
            return {
                "success": False,
                "message": "用户服务不可用",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.info("获取所有用户列表", {
                "timestamp": datetime.now().isoformat()
            })
            
            # Query all users from database
            response = self.client.table('users').select('*').order('created_at', desc=True).execute()
            
            if not response.data:
                logger.info("数据库中暂无用户")
                return {
                    "success": True,
                    "message": "用户列表获取成功",
                    "total_count": 0,
                    "users": []
                }
            
            users_list = []
            for user_data in response.data:
                user_profile = {
                    "id": user_data['id'],
                    "username": user_data['username'],
                    "email": user_data.get('email'),
                    "full_name": user_data.get('full_name'),
                    "avatar_url": user_data.get('avatar_url'),
                    "is_active": user_data.get('is_active', True),
                    "is_admin": user_data.get('is_admin', False),
                    "created_at": user_data.get('created_at'),
                    "updated_at": user_data.get('updated_at'),
                    "last_login_at": user_data.get('last_login_at')
                }
                users_list.append(user_profile)
            
            logger.info("用户列表获取成功", {
                "total_count": len(users_list),
                "active_users": sum(1 for u in users_list if u['is_active']),
                "admin_users": sum(1 for u in users_list if u['is_admin'])
            })
            
            return {
                "success": True,
                "message": "用户列表获取成功",
                "total_count": len(users_list),
                "users": users_list
            }
            
        except Exception as e:
            logger.error("获取用户列表异常", {
                "error": str(e),
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "用户列表获取失败",
                "error_code": "QUERY_ERROR"
            } 