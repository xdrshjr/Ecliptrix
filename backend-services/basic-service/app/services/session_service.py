"""
Session management service for single-device login functionality.
"""

import secrets
from typing import Optional, Dict, Any
from datetime import datetime

try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)


class SessionService:
    """Service for managing user sessions and single-device login."""
    
    def __init__(self):
        """Initialize session service."""
        if not SUPABASE_AVAILABLE:
            logger.warning("Supabase客户端不可用于会话服务。请安装: pip install supabase")
            self.client = None
            return
            
        try:
            # Validate environment variables
            if not settings.supabase.url:
                raise ValueError("SUPABASE_URL环境变量未设置或为空")
            if not settings.supabase.anon_key:
                raise ValueError("SUPABASE_ANON_KEY环境变量未设置或为空")
            
            logger.info(f"初始化会话服务，Supabase URL: {settings.supabase.url[:50]}...")
            
            # Create Supabase client for database operations
            self.client: Optional[Client] = create_client(
                settings.supabase.url,
                settings.supabase.anon_key
            )
            
            logger.info("会话服务初始化成功", {
                "service": "SessionService",
                "supabase_url": settings.supabase.url[:50] + "..." if len(settings.supabase.url) > 50 else settings.supabase.url
            })
            
        except Exception as e:
            logger.error(f"会话服务初始化失败: {str(e)}")
            logger.error(f"错误类型: {type(e).__name__}")
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
    
    def _generate_session_token(self) -> str:
        """
        Generate a secure random session token.
        
        Returns:
            str: A cryptographically secure random token
        """
        # Generate a 32-byte (256-bit) random token and convert to hex
        token = secrets.token_urlsafe(32)
        logger.debug("生成新会话令牌", {"token_length": len(token)})
        return token
    
    async def create_session(
        self, 
        user_id: str, 
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new session for a user, invalidating any existing sessions.
        
        Args:
            user_id: User ID
            device_info: Device information (User-Agent)
            ip_address: IP address of the client
            
        Returns:
            Dict containing session creation result
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "会话服务不可用",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.info("创建新用户会话", {
                "user_id": user_id,
                "device_info": device_info[:100] if device_info else None,
                "ip_address": ip_address,
                "timestamp": datetime.now().isoformat()
            })
            
            # Generate new session token
            session_token = self._generate_session_token()
            
            # Check if user has an existing active session
            existing_session_response = self.client.table('users').select(
                'active_session_token, session_created_at'
            ).eq('id', user_id).execute()
            
            if existing_session_response.data:
                existing_data = existing_session_response.data[0]
                if existing_data.get('active_session_token'):
                    logger.info("检测到现有会话，将被新会话替代", {
                        "user_id": user_id,
                        "old_session_created_at": existing_data.get('session_created_at'),
                        "action": "invalidate_old_session"
                    })
            
            # Update user with new session information
            # This will automatically invalidate any previous session
            update_data = {
                'active_session_token': session_token,
                'session_created_at': datetime.now().isoformat(),
                'session_device_info': device_info,
                'session_ip_address': ip_address
            }
            
            response = self.client.table('users').update(update_data).eq('id', user_id).execute()
            
            if not response.data:
                logger.error("会话创建失败：数据库更新未返回数据", {
                    "user_id": user_id
                })
                return {
                    "success": False,
                    "message": "会话创建失败",
                    "error_code": "SESSION_CREATION_FAILED"
                }
            
            logger.info("用户会话创建成功", {
                "user_id": user_id,
                "session_created_at": datetime.now().isoformat(),
                "device_info": device_info[:100] if device_info else None,
                "ip_address": ip_address
            })
            
            return {
                "success": True,
                "message": "会话创建成功",
                "session_token": session_token
            }
            
        except Exception as e:
            error_msg = str(e)
            logger.error("会话创建异常", {
                "user_id": user_id,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "会话创建异常",
                "error_code": "SESSION_ERROR",
                "error_details": {"error": error_msg}
            }
    
    async def validate_session(
        self, 
        user_id: str, 
        session_token: str
    ) -> Dict[str, Any]:
        """
        Validate if a session token is currently active for a user.
        
        Args:
            user_id: User ID
            session_token: Session token to validate
            
        Returns:
            Dict containing validation result
        """
        if not self._validate_client():
            return {
                "success": False,
                "valid": False,
                "message": "会话服务不可用",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.debug("验证用户会话", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })
            
            # Query user's active session
            response = self.client.table('users').select(
                'active_session_token, session_created_at, is_active'
            ).eq('id', user_id).execute()
            
            if not response.data:
                logger.warning("会话验证失败：用户不存在", {
                    "user_id": user_id
                })
                return {
                    "success": True,
                    "valid": False,
                    "reason": "用户不存在"
                }
            
            user_data = response.data[0]
            
            # Check if user is active
            if not user_data.get('is_active', False):
                logger.warning("会话验证失败：用户已被禁用", {
                    "user_id": user_id
                })
                return {
                    "success": True,
                    "valid": False,
                    "reason": "用户已被禁用"
                }
            
            # Check if session token matches
            active_token = user_data.get('active_session_token')
            if not active_token:
                logger.info("会话验证失败：用户无活跃会话", {
                    "user_id": user_id
                })
                return {
                    "success": True,
                    "valid": False,
                    "reason": "无活跃会话"
                }
            
            if active_token != session_token:
                logger.warning("会话验证失败：会话令牌不匹配", {
                    "user_id": user_id,
                    "session_created_at": user_data.get('session_created_at'),
                    "reason": "另一台设备已登录"
                })
                return {
                    "success": True,
                    "valid": False,
                    "reason": "您的账号已在另一台设备上登录"
                }
            
            logger.debug("会话验证成功", {
                "user_id": user_id,
                "session_created_at": user_data.get('session_created_at')
            })
            
            return {
                "success": True,
                "valid": True,
                "message": "会话有效"
            }
            
        except Exception as e:
            error_msg = str(e)
            logger.error("会话验证异常", {
                "user_id": user_id,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "valid": False,
                "message": "会话验证异常",
                "error_code": "SESSION_VALIDATION_ERROR",
                "error_details": {"error": error_msg}
            }
    
    async def invalidate_session(self, user_id: str) -> Dict[str, Any]:
        """
        Invalidate a user's current session.
        
        Args:
            user_id: User ID
            
        Returns:
            Dict containing invalidation result
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "会话服务不可用",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.info("注销用户会话", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })
            
            # Clear session data
            update_data = {
                'active_session_token': None,
                'session_created_at': None,
                'session_device_info': None,
                'session_ip_address': None
            }
            
            response = self.client.table('users').update(update_data).eq('id', user_id).execute()
            
            if not response.data:
                logger.warning("会话注销未找到用户数据", {
                    "user_id": user_id
                })
            
            logger.info("用户会话已注销", {
                "user_id": user_id
            })
            
            return {
                "success": True,
                "message": "会话已注销"
            }
            
        except Exception as e:
            error_msg = str(e)
            logger.error("会话注销异常", {
                "user_id": user_id,
                "error": error_msg,
                "error_type": type(e).__name__
            })
            return {
                "success": False,
                "message": "会话注销异常",
                "error_code": "SESSION_INVALIDATION_ERROR",
                "error_details": {"error": error_msg}
            }


# Global session service instance
session_service = SessionService()

