"""
Authentication service for user login and management.
"""

import bcrypt
from typing import Optional, Dict, Any
from datetime import datetime

try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False

from app.config import settings
from app.logger import get_logger
from app.models.auth_models import UserLogin, UserInfo, UserRegistration
from app.services.session_service import session_service

logger = get_logger(__name__)


class AuthService:
    """Service for handling user authentication."""
    
    def __init__(self):
        """Initialize authentication service."""
        if not SUPABASE_AVAILABLE:
            logger.warning("Supabase client not available for auth service. Install with: pip install supabase")
            self.client = None
            return
            
        try:
            # Validate environment variables
            if not settings.supabase.url:
                raise ValueError("SUPABASE_URL environment variable is not set or empty")
            if not settings.supabase.anon_key:
                raise ValueError("SUPABASE_ANON_KEY environment variable is not set or empty")
            
            logger.info(f"初始化认证服务，Supabase URL: {settings.supabase.url[:50]}...")
            
            # Create Supabase client for database operations
            self.client: Optional[Client] = create_client(
                settings.supabase.url,
                settings.supabase.anon_key
            )
            
            logger.info("认证服务初始化成功", {
                "service": "AuthService",
                "supabase_url": settings.supabase.url[:50] + "..." if len(settings.supabase.url) > 50 else settings.supabase.url
            })
            
        except Exception as e:
            logger.error(f"认证服务初始化失败: {str(e)}")
            logger.error(f"Error type: {type(e).__name__}")
            self.client = None
    
    def _validate_client(self) -> bool:
        """Validate if Supabase client is available."""
        if not SUPABASE_AVAILABLE:
            logger.error("Supabase客户端不可用，请安装: pip install supabase")
            return False
            
        if not self.client:
            logger.error("Supabase客户端未初始化")
            return False
            
        return True
    
    def _hash_password(self, password: str) -> str:
        """Hash password using bcrypt."""
        try:
            # Generate salt and hash password
            salt = bcrypt.gensalt()
            hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
            return hashed.decode('utf-8')
        except Exception as e:
            logger.error(f"密码哈希失败: {str(e)}")
            raise
    
    def _verify_password(self, password: str, hashed_password: str) -> bool:
        """Verify password against hash."""
        try:
            return bcrypt.checkpw(password.encode('utf-8'), hashed_password.encode('utf-8'))
        except Exception as e:
            logger.error(f"密码验证失败: {str(e)}")
            return False
    
    async def authenticate_user(
        self, 
        login_data: UserLogin,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Authenticate user with username and password.
        
        Args:
            login_data: User login credentials
            device_info: Device information (User-Agent)
            ip_address: IP address of the client
            
        Returns:
            Dict containing authentication result
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "认证服务不可用",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.info("用户登录认证开始", {
                "username": login_data.username,
                "device_info": device_info[:100] if device_info else None,
                "ip_address": ip_address,
                "timestamp": datetime.now().isoformat()
            })
            
            # Query user from database
            response = self.client.table('users').select('*').eq('username', login_data.username).eq('is_active', True).execute()
            
            if not response.data:
                logger.warning("用户不存在或已禁用", {
                    "username": login_data.username,
                    "query_result": "no_user_found"
                })
                return {
                    "success": False,
                    "message": "用户名或密码错误",
                    "error_code": "INVALID_CREDENTIALS"
                }
            
            user_data = response.data[0]
            logger.info("用户查询成功", {
                "username": login_data.username,
                "user_id": user_data['id'],
                "is_admin": user_data.get('is_admin', False)
            })
            
            # Verify password
            if not self._verify_password(login_data.password, user_data['password_hash']):
                logger.warning("密码验证失败", {
                    "username": login_data.username,
                    "user_id": user_data['id']
                })
                return {
                    "success": False,
                    "message": "用户名或密码错误",
                    "error_code": "INVALID_CREDENTIALS"
                }
            
            # Create new session (this will invalidate any existing session)
            session_result = await session_service.create_session(
                user_id=user_data['id'],
                device_info=device_info,
                ip_address=ip_address
            )
            
            if not session_result.get("success"):
                logger.error("会话创建失败", {
                    "user_id": user_data['id'],
                    "username": login_data.username,
                    "error": session_result.get("message")
                })
                # Continue with login even if session creation fails
                session_token = None
            else:
                session_token = session_result.get("session_token")
                logger.info("用户会话创建成功", {
                    "user_id": user_data['id'],
                    "username": login_data.username
                })
            
            # Update last login time
            try:
                self.client.table('users').update({
                    'last_login_at': datetime.now().isoformat()
                }).eq('id', user_data['id']).execute()
                logger.info("更新用户最后登录时间", {
                    "user_id": user_data['id'],
                    "username": login_data.username
                })
            except Exception as update_error:
                logger.warning(f"更新最后登录时间失败: {str(update_error)}")
                # Don't fail the login if we can't update the last login time
            
            # Create user info object
            user_info = UserInfo(
                id=user_data['id'],
                username=user_data['username'],
                email=user_data['email'],
                full_name=user_data.get('full_name'),
                avatar_url=user_data.get('avatar_url'),
                is_active=user_data['is_active'],
                is_admin=user_data.get('is_admin', False),
                created_at=datetime.fromisoformat(user_data['created_at'].replace('Z', '+00:00')),
                updated_at=datetime.fromisoformat(user_data['updated_at'].replace('Z', '+00:00')),
                last_login_at=datetime.now()
            )
            
            logger.info("用户认证成功", {
                "username": login_data.username,
                "user_id": user_data['id'],
                "is_admin": user_info.is_admin,
                "has_session_token": session_token is not None,
                "login_time": datetime.now().isoformat()
            })
            
            return {
                "success": True,
                "message": "登录成功",
                "user": user_info,
                "session_token": session_token
            }
            
        except Exception as e:
            error_msg = str(e)
            logger.error("用户认证异常", {
                "username": login_data.username,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "认证服务异常",
                "error_code": "AUTHENTICATION_ERROR",
                "error_details": {"error": error_msg}
            }
    
    async def register_user(self, registration_data: UserRegistration) -> Dict[str, Any]:
        """
        Register a new user.
        
        Args:
            registration_data: User registration data
            
        Returns:
            Dict containing registration result
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "认证服务不可用",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.info("用户注册开始", {
                "username": registration_data.username,
                "email": registration_data.email,
                "timestamp": datetime.now().isoformat()
            })
            
            # Check if user already exists
            existing_user = self.client.table('users').select('username, email').or_(
                f'username.eq.{registration_data.username},email.eq.{registration_data.email}'
            ).execute()
            
            if existing_user.data:
                existing = existing_user.data[0]
                if existing['username'] == registration_data.username:
                    logger.warning("用户名已存在", {"username": registration_data.username})
                    return {
                        "success": False,
                        "message": "用户名已存在",
                        "error_code": "USERNAME_EXISTS"
                    }
                if existing['email'] == registration_data.email:
                    logger.warning("邮箱已存在", {"email": registration_data.email})
                    return {
                        "success": False,
                        "message": "邮箱已存在",
                        "error_code": "EMAIL_EXISTS"
                    }
            
            # Hash password
            password_hash = self._hash_password(registration_data.password)
            
            # Insert new user
            new_user_data = {
                "username": registration_data.username,
                "email": registration_data.email,
                "password_hash": password_hash,
                "full_name": registration_data.full_name,
                "is_active": True,
                "is_admin": False
            }
            
            response = self.client.table('users').insert(new_user_data).execute()
            
            if not response.data:
                logger.error("用户创建失败", {
                    "username": registration_data.username,
                    "response": response
                })
                return {
                    "success": False,
                    "message": "用户创建失败",
                    "error_code": "USER_CREATION_FAILED"
                }
            
            created_user = response.data[0]
            
            # Create user info object
            user_info = UserInfo(
                id=created_user['id'],
                username=created_user['username'],
                email=created_user['email'],
                full_name=created_user.get('full_name'),
                avatar_url=created_user.get('avatar_url'),
                is_active=created_user['is_active'],
                is_admin=created_user.get('is_admin', False),
                created_at=datetime.fromisoformat(created_user['created_at'].replace('Z', '+00:00')),
                updated_at=datetime.fromisoformat(created_user['updated_at'].replace('Z', '+00:00')),
                last_login_at=None
            )
            
            logger.info("用户注册成功", {
                "username": registration_data.username,
                "user_id": created_user['id'],
                "email": registration_data.email
            })
            
            return {
                "success": True,
                "message": "用户注册成功",
                "user": user_info
            }
            
        except Exception as e:
            error_msg = str(e)
            logger.error("用户注册异常", {
                "username": registration_data.username,
                "email": registration_data.email,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "注册服务异常",
                "error_code": "REGISTRATION_ERROR",
                "error_details": {"error": error_msg}
            }
    
    async def get_user_by_id(self, user_id: str) -> Optional[UserInfo]:
        """
        Get user information by ID.
        
        Args:
            user_id: User ID
            
        Returns:
            UserInfo object or None if not found
        """
        if not self._validate_client():
            return None
        
        try:
            response = self.client.table('users').select('*').eq('id', user_id).eq('is_active', True).execute()
            
            if not response.data:
                return None
            
            user_data = response.data[0]
            return UserInfo(
                id=user_data['id'],
                username=user_data['username'],
                email=user_data['email'],
                full_name=user_data.get('full_name'),
                avatar_url=user_data.get('avatar_url'),
                is_active=user_data['is_active'],
                is_admin=user_data.get('is_admin', False),
                created_at=datetime.fromisoformat(user_data['created_at'].replace('Z', '+00:00')),
                updated_at=datetime.fromisoformat(user_data['updated_at'].replace('Z', '+00:00')),
                last_login_at=datetime.fromisoformat(user_data['last_login_at'].replace('Z', '+00:00')) if user_data.get('last_login_at') else None
            )
            
        except Exception as e:
            logger.error(f"获取用户信息异常: {str(e)}", {"user_id": user_id})
            return None
    
    def health_check(self) -> Dict[str, Any]:
        """Check authentication service health."""
        if not self._validate_client():
            return {
                "service": "AuthService",
                "status": "unhealthy",
                "message": "认证服务客户端不可用"
            }
        
        try:
            # Try to query users table (just count)
            response = self.client.table('users').select('id', count='exact').limit(1).execute()
            
            return {
                "service": "AuthService",
                "status": "healthy",
                "message": "认证服务运行正常",
                "users_table_accessible": True
            }
            
        except Exception as e:
            logger.error("认证服务健康检查失败", {"error": str(e)})
            return {
                "service": "AuthService",
                "status": "unhealthy",
                "message": f"数据库连接测试失败: {str(e)}"
            }


# Global auth service instance
auth_service = AuthService() 