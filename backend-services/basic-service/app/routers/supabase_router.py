"""
Supabase audio upload API routes.
"""

import os
import tempfile
import shutil
from typing import Union
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form
from fastapi.responses import JSONResponse

from app.models.supabase_models import (
    AudioUploadRequest,
    AudioUploadResponse,
    SupabaseUploadResponse,
    SupabaseUploadErrorResponse,
    VideoUploadRequest,
    VideoUploadResponse,
    VideoUploadErrorResponse
)
from app.services.supabase_service import supabase_service
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/supabase", tags=["Supabase"])
logger = get_logger(__name__)


@router.post(
    "/upload-audio",
    response_model=Union[AudioUploadResponse, SupabaseUploadErrorResponse],
    summary="上传音频文件到Supabase",
    description="将本地音频文件上传到Supabase存储桶"
)
async def upload_audio_file(request: AudioUploadRequest) -> Union[AudioUploadResponse, SupabaseUploadErrorResponse]:
    """
    上传音频文件到Supabase存储桶
    
    Args:
        request: 音频上传请求，包含文件路径和相关信息
    
    Returns:
        AudioUploadResponse: 上传成功的响应
        SupabaseUploadErrorResponse: 上传失败的错误响应
    """
    try:
        logger.info("收到音频文件上传请求", {
            "audio_file_path": request.audio_file_path,
            "segment_id": request.segment_id,
            "task_id": request.task_id,
            "voice_type": request.voice_type,
            "custom_filename": request.custom_filename
        })

        # 检查文件是否存在
        if not os.path.exists(request.audio_file_path):
            logger.error("音频文件不存在", {
                "file_path": request.audio_file_path
            })
            return SupabaseUploadErrorResponse(
                success=False,
                message=f"音频文件不存在: {request.audio_file_path}",
                error_code="FILE_NOT_FOUND"
            )

        # 生成存储桶路径
        from datetime import datetime
        now = datetime.now()
        date_path = now.strftime("%Y/%m/%d")
        
        # 构建文件名
        if request.custom_filename:
            filename = request.custom_filename
        else:
            base_name = os.path.splitext(os.path.basename(request.audio_file_path))[0]
            extension = os.path.splitext(request.audio_file_path)[1]
            filename = f"{base_name}_{now.strftime('%Y%m%d_%H%M%S')}{extension}"

        # 构建完整的bucket路径
        if request.task_id:
            bucket_path = f"audio/generated/{date_path}/task-{request.task_id}/{filename}"
        else:
            bucket_path = f"audio/generated/{date_path}/{filename}"

        # 调用Supabase服务上传文件
        result = supabase_service.upload_file(
            local_file_path=request.audio_file_path,
            bucket_path=bucket_path
        )

        if not result["success"]:
            logger.error("音频文件上传失败", {
                "error": result["message"],
                "file_path": request.audio_file_path,
                "bucket_path": bucket_path
            })
            return SupabaseUploadErrorResponse(
                success=False,
                message=result["message"],
                error_code="UPLOAD_FAILED"
            )

        logger.info("音频文件上传成功", {
            "file_url": result["file_url"],
            "file_size": result["file_size"],
            "bucket_path": bucket_path
        })

        return AudioUploadResponse(
            success=True,
            message="音频文件上传成功",
            audio_url=result["file_url"],
            file_path=bucket_path,
            file_size=result["file_size"],
            segment_id=request.segment_id,
            task_id=request.task_id,
            upload_time=datetime.now()
        )

    except Exception as e:
        logger.error("音频文件上传异常", {
            "error": str(e),
            "file_path": request.audio_file_path
        })
        return SupabaseUploadErrorResponse(
            success=False,
            message=f"音频文件上传失败: {str(e)}",
            error_code="INTERNAL_ERROR"
        )



@router.post(
    "/upload-file",
    response_model=Union[SupabaseUploadResponse, SupabaseUploadErrorResponse],
    summary="上传文件到Supabase",
    description="上传任意文件到Supabase存储桶"
)
async def upload_file(
    file: UploadFile = File(..., description="要上传的文件"),
    bucket_path: str = Form(None, description="存储桶中的目标路径"),
    task_id: str = Form(None, description="任务ID"),
    segment_id: str = Form(None, description="段落ID"),
    user_id: str = Form(None, description="用户ID")
) -> Union[SupabaseUploadResponse, SupabaseUploadErrorResponse]:
    """
    上传文件到Supabase存储桶
    
    Args:
        file: 要上传的文件
        bucket_path: 存储桶中的目标路径
        task_id: 任务ID
        segment_id: 段落ID
        user_id: 用户ID
    
    Returns:
        SupabaseUploadResponse: 上传成功的响应
        SupabaseUploadErrorResponse: 上传失败的错误响应
    """
    try:
        logger.info("收到文件上传请求", {
            "filename": file.filename,
            "content_type": file.content_type,
            "bucket_path": bucket_path,
            "task_id": task_id,
            "segment_id": segment_id,
            "user_id": user_id
        })
        
        # 创建临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_file:
            # 保存上传的文件到临时位置
            shutil.copyfileobj(file.file, temp_file)
            temp_file_path = temp_file.name
        
        try:
            # 如果没有提供bucket_path，则根据文件类型和user_id生成
            if not bucket_path:
                # 确定文件类型文件夹
                content_type = file.content_type or ''
                if content_type.startswith('video/'):
                    folder = 'video'
                elif content_type.startswith('audio/'):
                    folder = 'audio'
                elif content_type.startswith('image/'):
                    folder = 'images'
                else:
                    folder = 'files'
                
                bucket_path = supabase_service._generate_bucket_path(
                    filename=file.filename,
                    folder=folder,
                    task_id=task_id,
                    segment_id=segment_id,
                    user_id=user_id
                )
            
            # 调用Supabase服务上传文件
            result = supabase_service.upload_file(
                local_file_path=temp_file_path,
                bucket_path=bucket_path,
                content_type=file.content_type
            )
            
            if not result["success"]:
                logger.error("文件上传失败", {
                    "error": result["message"],
                    "filename": file.filename,
                    "task_id": task_id,
                    "segment_id": segment_id,
                    "user_id": user_id
                })
                return SupabaseUploadErrorResponse(
                    success=False,
                    message=result["message"],
                    error_code="UPLOAD_FAILED"
                )
            
            logger.info("文件上传成功", {
                "file_url": result["file_url"],
                "file_size": result["file_size"],
                "filename": file.filename,
                "task_id": task_id,
                "segment_id": segment_id,
                "user_id": user_id
            })
            
            return SupabaseUploadResponse(
                success=True,
                message="文件上传成功",
                file_url=result["file_url"],
                file_path=result.get("file_path", bucket_path),
                file_size=result["file_size"],
                upload_time=datetime.now()
            )
            
        finally:
            # 清理临时文件
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
        
    except Exception as e:
        logger.error("文件上传异常", {
            "error": str(e),
            "filename": file.filename,
            "task_id": task_id,
            "segment_id": segment_id,
            "user_id": user_id
        })
        return SupabaseUploadErrorResponse(
            success=False,
            message=f"文件上传失败: {str(e)}",
            error_code="INTERNAL_ERROR"
        )


@router.post(
    "/upload-video",
    response_model=Union[VideoUploadResponse, VideoUploadErrorResponse],
    summary="上传视频文件到Supabase",
    description="上传视频文件到Supabase存储桶并生成缩略图"
)
async def upload_video_file(
    file: UploadFile = File(..., description="要上传的视频文件"),
    task_id: str = Form(None, description="任务ID"),
    custom_filename: str = Form(None, description="自定义文件名"),
    generate_thumbnail: bool = Form(True, description="是否生成缩略图"),
    user_id: str = Form(None, description="用户ID")
) -> Union[VideoUploadResponse, VideoUploadErrorResponse]:
    """
    上传视频文件到Supabase存储桶
    
    Args:
        file: 要上传的视频文件
        task_id: 任务ID
        custom_filename: 自定义文件名
        generate_thumbnail: 是否生成缩略图
    
    Returns:
        VideoUploadResponse: 上传成功的响应
        VideoUploadErrorResponse: 上传失败的错误响应
    """
    temp_file_path = None
    thumbnail_path = None
    
    try:
        logger.info("收到视频文件上传请求", {
            "filename": file.filename,
            "content_type": file.content_type,
            "task_id": task_id,
            "custom_filename": custom_filename,
            "generate_thumbnail": generate_thumbnail,
            "user_id": user_id
        })
        
        # 验证文件类型
        if not file.content_type or not file.content_type.startswith('video/'):
            logger.error("不支持的文件类型", {
                "content_type": file.content_type,
                "filename": file.filename
            })
            return VideoUploadErrorResponse(
                success=False,
                message=f"不支持的文件类型: {file.content_type}",
                error_code="INVALID_FILE_TYPE"
            )
        
        # 创建临时文件
        file_extension = os.path.splitext(file.filename)[1] if file.filename else '.mp4'
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as temp_file:
            shutil.copyfileobj(file.file, temp_file)
            temp_file_path = temp_file.name
        
        # 获取文件大小
        file_size = os.path.getsize(temp_file_path)
        
        # 生成存储桶路径
        now = datetime.now()
        date_path = now.strftime("%Y/%m/%d")
        
        # 构建文件名
        if custom_filename:
            filename = custom_filename
            if not filename.endswith(file_extension):
                filename += file_extension
        else:
            base_name = os.path.splitext(file.filename)[0] if file.filename else "video"
            filename = f"{base_name}_{now.strftime('%Y%m%d_%H%M%S')}{file_extension}"
        
        # 构建完整的bucket路径（包含user_id）
        bucket_path = supabase_service._generate_bucket_path(
            filename=filename,
            folder='video',
            task_id=task_id,
            user_id=user_id
        )
        
        # 初始化视频元数据
        video_metadata = {
            "original_filename": file.filename,
            "upload_time": now.isoformat(),
            "file_size": file_size
        }
        
        # 尝试获取视频元数据（可选，需要ffmpeg）
        duration = None
        width = None
        height = None
        
        try:
            import subprocess
            import json
            
            # 使用ffprobe获取视频信息
            cmd = [
                'ffprobe', '-v', 'quiet', '-print_format', 'json',
                '-show_format', '-show_streams', temp_file_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                probe_data = json.loads(result.stdout)
                
                # 查找视频流
                for stream in probe_data.get('streams', []):
                    if stream.get('codec_type') == 'video':
                        width = stream.get('width')
                        height = stream.get('height')
                        break
                
                # 获取时长
                format_data = probe_data.get('format', {})
                duration_str = format_data.get('duration')
                if duration_str:
                    duration = float(duration_str)
                
                video_metadata.update({
                    "width": width,
                    "height": height,
                    "duration": duration,
                    "ffprobe_success": True
                })
                
                logger.info("成功获取视频元数据", {
                    "filename": filename,
                    "duration": duration,
                    "width": width,
                    "height": height
                })
            else:
                logger.warning("无法获取视频元数据", {
                    "filename": filename,
                    "ffprobe_error": result.stderr
                })
                video_metadata["ffprobe_success"] = False
                
        except Exception as probe_error:
            logger.warning("获取视频元数据时出错", {
                "filename": filename,
                "error": str(probe_error)
            })
            video_metadata["ffprobe_error"] = str(probe_error)
        
        # 上传视频文件到Supabase
        upload_result = supabase_service.upload_file(
            local_file_path=temp_file_path,
            bucket_path=bucket_path,
            content_type=file.content_type
        )
        
        if not upload_result["success"]:
            logger.error("视频文件上传失败", {
                "error": upload_result["message"],
                "filename": filename,
                "bucket_path": bucket_path
            })
            return VideoUploadErrorResponse(
                success=False,
                message=upload_result["message"],
                error_code="UPLOAD_FAILED"
            )
        
        # 生成缩略图（如果需要）
        thumbnail_url = None
        if generate_thumbnail and duration is not None:
            try:
                # 生成缩略图
                thumbnail_filename = f"thumb_{os.path.splitext(filename)[0]}.jpg"
                thumbnail_bucket_path = bucket_path.replace(filename, thumbnail_filename)
                
                with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as thumb_file:
                    thumbnail_path = thumb_file.name
                
                # 使用ffmpeg生成缩略图（在视频中间位置）
                thumbnail_time = duration / 2 if duration > 2 else 1
                
                cmd = [
                    'ffmpeg', '-i', temp_file_path, '-ss', str(thumbnail_time),
                    '-vframes', '1', '-q:v', '2', '-y', thumbnail_path
                ]
                
                result = subprocess.run(cmd, capture_output=True, timeout=30)
                
                if result.returncode == 0 and os.path.exists(thumbnail_path):
                    # 上传缩略图到Supabase
                    thumb_result = supabase_service.upload_file(
                        local_file_path=thumbnail_path,
                        bucket_path=thumbnail_bucket_path,
                        content_type="image/jpeg"
                    )
                    
                    if thumb_result["success"]:
                        thumbnail_url = thumb_result["file_url"]
                        logger.info("缩略图生成并上传成功", {
                            "thumbnail_url": thumbnail_url,
                            "filename": filename
                        })
                    else:
                        logger.warning("缩略图上传失败", {
                            "error": thumb_result["message"],
                            "filename": filename
                        })
                else:
                    logger.warning("缩略图生成失败", {
                        "filename": filename,
                        "ffmpeg_error": result.stderr.decode() if result.stderr else "Unknown error"
                    })
                    
            except Exception as thumb_error:
                logger.warning("生成缩略图时出错", {
                    "filename": filename,
                    "error": str(thumb_error)
                })
        
        logger.info("视频文件上传成功", {
            "file_url": upload_result["file_url"],
            "file_size": file_size,
            "filename": filename,
            "thumbnail_url": thumbnail_url,
            "task_id": task_id
        })
        
        return VideoUploadResponse(
            success=True,
            message="视频文件上传成功",
            video_url=upload_result["file_url"],
            file_path=bucket_path,
            file_size=file_size,
            duration=duration,
            width=width,
            height=height,
            thumbnail_url=thumbnail_url,
            task_id=task_id,
            upload_time=now,
            metadata=video_metadata
        )
        
    except Exception as e:
        logger.error("视频文件上传异常", {
            "error": str(e),
            "filename": file.filename if file else "unknown",
            "task_id": task_id
        })
        return VideoUploadErrorResponse(
            success=False,
            message=f"视频文件上传失败: {str(e)}",
            error_code="INTERNAL_ERROR"
        )
    
    finally:
        # 清理临时文件
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except Exception as e:
                logger.warning("清理临时视频文件失败", {"error": str(e)})
        
        if thumbnail_path and os.path.exists(thumbnail_path):
            try:
                os.unlink(thumbnail_path)
            except Exception as e:
                logger.warning("清理临时缩略图文件失败", {"error": str(e)})


@router.get(
    "/health",
    summary="Supabase服务健康检查",
    description="检查Supabase服务的连接状态和可用性"
)
async def supabase_health_check():
    """
    Supabase服务健康检查
    
    Returns:
        Dict: 服务健康状态信息
    """
    try:
        logger.info("收到Supabase健康检查请求")
        
        # 调用Supabase服务健康检查
        health_info = supabase_service.health_check()
        
        if health_info["status"] == "healthy":
            logger.info("Supabase健康检查通过", health_info)
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=health_info
            )
        else:
            logger.error("Supabase健康检查失败", health_info)
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content=health_info
            )
        
    except Exception as e:
        error_msg = str(e)
        error_info = {
            "service": "Supabase",
            "status": "error",
            "message": f"健康检查异常: {error_msg}"
        }
        
        logger.error("Supabase健康检查异常", error_info)
        
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=error_info
        )


@router.get(
    "/user-materials",
    summary="获取用户上传的所有素材",
    description="查询当前用户上传到Supabase的所有素材，支持分页和类型筛选"
)
async def get_user_materials(
    user_id: str,
    page: int = 1,
    page_size: int = 20,
    material_type: str = None
):
    """
    获取用户上传的所有素材列表
    
    Args:
        user_id: 用户ID
        page: 页码（从1开始）
        page_size: 每页数量
        material_type: 素材类型筛选（video, audio, image），为空则返回所有类型
    
    Returns:
        包含素材列表和分页信息的响应
    """
    try:
        logger.info("收到用户素材查询请求", {
            "user_id": user_id,
            "page": page,
            "page_size": page_size,
            "material_type": material_type
        })
        
        # 调用Supabase服务查询用户素材
        result = supabase_service.list_user_materials(
            user_id=user_id,
            page=page,
            page_size=page_size,
            material_type=material_type
        )
        
        if not result["success"]:
            logger.error("查询用户素材失败", {
                "error": result.get("message"),
                "user_id": user_id
            })
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "success": False,
                    "message": result.get("message", "查询素材失败"),
                    "materials": [],
                    "total": 0,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": 0
                }
            )
        
        logger.info("用户素材查询成功", {
            "user_id": user_id,
            "total": result["total"],
            "page": result["page"],
            "returned": len(result["materials"])
        })
        
        return {
            "success": True,
            "materials": result["materials"],
            "total": result["total"],
            "page": result["page"],
            "page_size": result["page_size"],
            "total_pages": result["total_pages"]
        }
        
    except Exception as e:
        logger.error("查询用户素材异常", {
            "error": str(e),
            "user_id": user_id,
            "page": page,
            "page_size": page_size
        })
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "message": f"查询素材异常: {str(e)}",
                "materials": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "total_pages": 0
            }
        ) 