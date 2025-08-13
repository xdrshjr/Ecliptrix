"""
Supabase service for file upload and management.
"""

import os
import mimetypes
import requests
from typing import Optional, Dict, Any, Tuple
from datetime import datetime
from pathlib import Path

try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)


class SupabaseService:
    """Service for handling Supabase file operations."""
    
    def __init__(self):
        """Initialize Supabase service."""
        if not SUPABASE_AVAILABLE:
            logger.warning("Supabase client not available. Install with: pip install supabase")
            self.client = None
            return
            
        try:
            # Validate environment variables first
            if not settings.supabase.url:
                raise ValueError("SUPABASE_URL environment variable is not set or empty")
            if not settings.supabase.anon_key:
                raise ValueError("SUPABASE_ANON_KEY environment variable is not set or empty")
            if not settings.supabase.bucket:
                raise ValueError("SUPABASE_BUCKET environment variable is not set or empty")
            
            logger.info(f"Initializing Supabase client with URL: {settings.supabase.url[:50]}...")
            
            # Use direct Client instantiation to avoid version compatibility issues
            try:
                # Import the Client class directly
                from supabase import Client
                
                # Create client instance directly
                self.client: Optional[Client] = Client(
                    supabase_url=settings.supabase.url,
                    supabase_key=settings.supabase.anon_key
                )
                
            except Exception as client_error:
                logger.warning(f"Direct Client creation failed: {client_error}, trying create_client function")
                # Fallback to create_client function
                self.client: Optional[Client] = create_client(
                    settings.supabase.url,
                    settings.supabase.anon_key
                )
            
            self.bucket_name = settings.supabase.bucket
            self.environment = settings.supabase.environment
            
            logger.info("Supabase服务初始化成功", {
                "bucket": self.bucket_name,
                "environment": self.environment,
                "url": settings.supabase.url[:50] + "..." if len(settings.supabase.url) > 50 else settings.supabase.url
            })
        except Exception as e:
            logger.error(f"Supabase服务初始化失败: {str(e)}")
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"SUPABASE_URL: {'SET' if settings.supabase.url else 'NOT SET'}")
            logger.error(f"SUPABASE_ANON_KEY: {'SET' if settings.supabase.anon_key else 'NOT SET'}")
            logger.error(f"SUPABASE_BUCKET: {'SET' if settings.supabase.bucket else 'NOT SET'}")
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
    
    def _generate_bucket_path(self, 
                            filename: str, 
                            folder: str = "audio",
                            task_id: Optional[str] = None,
                            segment_id: Optional[str] = None) -> str:
        """Generate bucket path for file upload."""
        timestamp = datetime.now().strftime("%Y/%m/%d")
        path_parts = [self.environment, folder, timestamp]
        
        if task_id:
            path_parts.append(task_id)
        
        if segment_id:
            filename = f"{segment_id}_{filename}"
            
        path_parts.append(filename)
        return "/".join(path_parts)
    
    def _get_file_content_type(self, file_path: str) -> str:
        """Get MIME type for file."""
        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            # 默认音频文件类型
            if file_path.lower().endswith(('.mp3', '.wav', '.m4a', '.aac')):
                content_type = 'audio/mpeg'
            else:
                content_type = 'application/octet-stream'
        return content_type
    
    def upload_file(self, 
                   local_file_path: str,
                   bucket_path: Optional[str] = None,
                   content_type: Optional[str] = None) -> Dict[str, Any]:
        """
        Upload file to Supabase storage.
        
        Args:
            local_file_path: Path to the local file
            bucket_path: Target path in Supabase bucket (optional)
            content_type: MIME type of the file (optional)
            
        Returns:
            Dict containing upload result
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "Supabase客户端不可用"
            }
        
        try:
            # Validate file exists
            if not os.path.exists(local_file_path):
                logger.error("文件不存在", {"file_path": local_file_path})
                return {
                    "success": False,
                    "message": f"文件不存在: {local_file_path}"
                }
            
            # Get file info
            file_size = os.path.getsize(local_file_path)
            filename = os.path.basename(local_file_path)
            
            # Validate file is not empty
            if file_size == 0:
                logger.error("文件为空", {
                    "file_path": local_file_path,
                    "file_size": file_size
                })
                return {
                    "success": False,
                    "message": f"文件为空: {local_file_path}"
                }
            
            # Generate bucket path if not provided
            if not bucket_path:
                bucket_path = self._generate_bucket_path(filename)
            
            # Determine content type
            if not content_type:
                content_type = self._get_file_content_type(local_file_path)
            
            logger.info("开始上传文件到Supabase", {
                "local_path": local_file_path,
                "bucket_path": bucket_path,
                "file_size": file_size,
                "content_type": content_type
            })
            
            # Upload to Supabase using file path directly
            # This ensures the file is read properly by the Supabase client
            try:
                with open(local_file_path, 'rb') as file:
                    # Verify file can be read
                    file.seek(0, 2)  # Seek to end
                    actual_size = file.tell()
                    file.seek(0)  # Seek back to beginning
                    
                    if actual_size != file_size:
                        logger.error("文件大小不匹配", {
                            "expected_size": file_size,
                            "actual_size": actual_size,
                            "file_path": local_file_path
                        })
                        return {
                            "success": False,
                            "message": f"文件大小不匹配: 期望 {file_size}, 实际 {actual_size}"
                        }
                    
                    # Read file content
                    file_data = file.read()
                    
                    # Validate file data
                    if len(file_data) == 0:
                        logger.error("读取到的文件数据为空", {
                            "file_path": local_file_path,
                            "file_size": file_size
                        })
                        return {
                            "success": False,
                            "message": f"读取到的文件数据为空: {local_file_path}"
                        }
                    
                    logger.debug("文件数据读取成功", {
                        "file_path": local_file_path,
                        "data_length": len(file_data),
                        "first_bytes": file_data[:10].hex() if len(file_data) >= 10 else file_data.hex()
                    })
                    
            except Exception as read_error:
                logger.error("读取文件失败", {
                    "file_path": local_file_path,
                    "error": str(read_error)
                })
                return {
                    "success": False,
                    "message": f"读取文件失败: {str(read_error)}"
                }
            
            # Upload to Supabase
            response = self.client.storage.from_(self.bucket_name).upload(
                path=bucket_path,
                file=file_data,
                file_options={
                    "content-type": content_type,
                    "cache-control": "3600",
                    "upsert": "false"  # Prevent overwriting existing files
                }
            )
            
            if hasattr(response, 'error') and response.error:
                logger.error("Supabase上传失败", {
                    "error": response.error,
                    "bucket_path": bucket_path,
                    "file_size": len(file_data),
                    "content_type": content_type
                })
                return {
                    "success": False,
                    "message": f"上传失败: {response.error}"
                }
            
            logger.info("文件上传到Supabase成功", {
                "bucket_path": bucket_path,
                "file_size": len(file_data),
                "content_type": content_type
            })
            
            # 直接创建签名URL，不尝试公共URL
            try:
                logger.info("直接创建签名URL", {
                    "bucket_path": bucket_path,
                    "bucket_name": self.bucket_name
                })
                
                # 创建24小时有效的签名URL
                signed_url_response = self.client.storage.from_(self.bucket_name).create_signed_url(bucket_path, 86400)  # 24小时
                
                logger.info("签名URL响应", {
                    "response": signed_url_response,
                    "response_type": type(signed_url_response)
                })
                
                public_url = None
                if signed_url_response and 'signedURL' in signed_url_response:
                    public_url = signed_url_response['signedURL']
                    logger.info("从响应中提取签名URL", {
                        "signed_url": public_url,
                        "url_length": len(public_url),
                        "has_token": "token=" in public_url
                    })
                elif isinstance(signed_url_response, str):
                    # 如果直接返回字符串URL
                    public_url = signed_url_response
                    logger.info("直接获取签名URL字符串", {
                        "signed_url": public_url,
                        "url_length": len(public_url),
                        "has_token": "token=" in public_url
                    })
                else:
                    logger.error("创建签名URL失败 - 响应格式不正确", {
                        "response": signed_url_response,
                        "response_type": type(signed_url_response)
                    })
                    return {
                        "success": False,
                        "message": f"创建签名URL失败: 响应格式不正确"
                    }
                
                if not public_url:
                    logger.error("无法获取签名URL", {
                        "bucket_path": bucket_path
                    })
                    return {
                        "success": False,
                        "message": "无法获取签名URL"
                    }
                
                # 测试签名URL可访问性
                url_test_result = self._test_url_accessibility(public_url)
                logger.info("签名URL可访问性测试", {
                    "signed_url": public_url[:100] + "..." if len(public_url) > 100 else public_url,
                    "accessible": url_test_result["accessible"],
                    "status_code": url_test_result["status_code"]
                })
                
            except Exception as signed_url_error:
                logger.error("创建签名URL异常", {
                    "error": str(signed_url_error),
                    "bucket_path": bucket_path
                })
                return {
                    "success": False,
                    "message": f"文件上传成功但创建签名URL失败: {str(signed_url_error)}"
                }
            
            logger.info("文件上传成功，获取签名URL成功", {
                "bucket_path": bucket_path,
                "bucket_name": self.bucket_name,
                "signed_url": public_url,
                "file_size": file_size,
                "url_accessible": url_test_result["accessible"],
                "url_test_status": url_test_result["status_code"],
                "url_test_error": url_test_result.get("error"),
                "is_signed_url": True,
                "url_format_check": {
                    "starts_with_https": public_url.startswith("https://"),
                    "contains_supabase": "supabase.co" in public_url,
                    "url_length": len(public_url),
                    "has_token": "token=" in public_url
                }
            })
            
            return {
                "success": True,
                "message": "文件上传成功",
                "file_url": public_url,
                "file_path": bucket_path,
                "file_size": file_size,
                "upload_time": datetime.now(),
                "content_type": content_type
            }
            
        except Exception as e:
            error_msg = str(e)
            logger.error("文件上传异常", {
                "error": error_msg,
                "local_path": local_file_path,
                "bucket_path": bucket_path
            })
            return {
                "success": False,
                "message": f"文件上传异常: {error_msg}"
            }
    
    def upload_audio_file(self,
                         audio_file_path: str,
                         segment_id: Optional[str] = None,
                         task_id: Optional[str] = None,
                         voice_type: Optional[str] = None,
                         custom_filename: Optional[str] = None) -> Dict[str, Any]:
        """
        Upload audio file to Supabase storage.
        
        Args:
            audio_file_path: Path to the audio file
            segment_id: Segment ID associated with the audio
            task_id: Task ID associated with the audio
            voice_type: Voice type used for TTS
            custom_filename: Custom filename for the uploaded file
            
        Returns:
            Dict containing upload result
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "Supabase客户端不可用"
            }
        
        try:
            # Validate audio file
            if not os.path.exists(audio_file_path):
                return {
                    "success": False,
                    "message": f"音频文件不存在: {audio_file_path}"
                }
            
            # Get file info
            file_size = os.path.getsize(audio_file_path)
            original_filename = os.path.basename(audio_file_path)
            filename = custom_filename if custom_filename else original_filename
            
            # Generate bucket path for audio
            bucket_path = self._generate_bucket_path(
                filename=filename,
                folder="audio/generated",
                task_id=task_id,
                segment_id=segment_id
            )
            
            logger.info("开始上传音频文件到Supabase", {
                "audio_file": audio_file_path,
                "bucket_path": bucket_path,
                "segment_id": segment_id,
                "task_id": task_id,
                "voice_type": voice_type,
                "file_size": file_size
            })
            
            # Upload file
            upload_result = self.upload_file(
                local_file_path=audio_file_path,
                bucket_path=bucket_path,
                content_type="audio/mpeg"
            )
            
            if not upload_result["success"]:
                return upload_result
            
            # Get audio duration (optional)
            duration = self._get_audio_duration(audio_file_path)
            
            result = {
                "success": True,
                "message": "音频文件上传成功",
                "audio_url": upload_result["file_url"],
                "file_path": upload_result["file_path"],
                "file_size": upload_result["file_size"],
                "duration": duration,
                "segment_id": segment_id,
                "task_id": task_id,
                "voice_type": voice_type,
                "upload_time": upload_result["upload_time"]
            }
            
            logger.info("音频文件上传成功，Supabase公共URL可访问", {
                "audio_url": result["audio_url"],
                "file_size": result["file_size"],
                "duration": duration,
                "segment_id": segment_id,
                "task_id": task_id,
                "supabase_upload_success": True,
                "url_ready_for_access": True
            })
            
            return result
            
        except Exception as e:
            error_msg = str(e)
            logger.error("音频文件上传异常", {
                "error": error_msg,
                "audio_file": audio_file_path,
                "segment_id": segment_id,
                "task_id": task_id
            })
            return {
                "success": False,
                "message": f"音频文件上传异常: {error_msg}"
            }
    
    def _test_url_accessibility(self, url: str) -> Dict[str, Any]:
        """
        测试URL是否可以访问
        
        Args:
            url: 要测试的URL
            
        Returns:
            Dict: 包含可访问性测试结果
        """
        try:
            # 发送HEAD请求测试URL可访问性，避免下载整个文件
            response = requests.head(url, timeout=10, allow_redirects=True)
            
            return {
                "accessible": response.status_code == 200,
                "status_code": response.status_code,
                "content_length": response.headers.get('content-length'),
                "content_type": response.headers.get('content-type')
            }
        except requests.exceptions.RequestException as e:
            logger.error("URL可访问性测试失败", {
                "url": url,
                "error": str(e)
            })
            return {
                "accessible": False,
                "status_code": None,
                "error": str(e)
            }
    
    def _get_audio_duration(self, audio_file_path: str) -> Optional[float]:
        """Get audio file duration in seconds."""
        try:
            # 尝试使用mutagen获取音频时长
            try:
                from mutagen import File
                audio_file = File(audio_file_path)
                if audio_file and hasattr(audio_file, 'info'):
                    return float(audio_file.info.length)
            except ImportError:
                logger.debug("mutagen库不可用，无法获取音频时长")
            except Exception as e:
                logger.debug(f"获取音频时长失败: {e}")
            
            return None
        except Exception:
            return None
    
    def delete_file(self, bucket_path: str) -> Dict[str, Any]:
        """
        Delete file from Supabase storage.
        
        Args:
            bucket_path: Path to the file in Supabase bucket
            
        Returns:
            Dict containing deletion result
        """
        if not self._validate_client():
            return {
                "success": False,
                "message": "Supabase客户端不可用"
            }
        
        try:
            logger.info("删除Supabase文件", {"bucket_path": bucket_path})
            
            response = self.client.storage.from_(self.bucket_name).remove([bucket_path])
            
            if hasattr(response, 'error') and response.error:
                logger.error("文件删除失败", {
                    "error": response.error,
                    "bucket_path": bucket_path
                })
                return {
                    "success": False,
                    "message": f"文件删除失败: {response.error}"
                }
            
            logger.info("文件删除成功", {"bucket_path": bucket_path})
            return {
                "success": True,
                "message": "文件删除成功"
            }
            
        except Exception as e:
            error_msg = str(e)
            logger.error("文件删除异常", {
                "error": error_msg,
                "bucket_path": bucket_path
            })
            return {
                "success": False,
                "message": f"文件删除异常: {error_msg}"
            }
    
    def health_check(self) -> Dict[str, Any]:
        """Check Supabase service health."""
        if not self._validate_client():
            return {
                "service": "Supabase",
                "status": "unhealthy",
                "message": "Supabase客户端不可用"
            }
        
        try:
            # Try to list files in bucket (just to test connection)
            response = self.client.storage.from_(self.bucket_name).list(limit=1)
            
            return {
                "service": "Supabase",
                "status": "healthy",
                "bucket": self.bucket_name,
                "environment": self.environment,
                "message": "Supabase服务运行正常"
            }
            
        except Exception as e:
            logger.error("Supabase健康检查失败", {"error": str(e)})
            return {
                "service": "Supabase",
                "status": "unhealthy",
                "message": f"连接测试失败: {str(e)}"
            }


# Global Supabase service instance
supabase_service = SupabaseService() 