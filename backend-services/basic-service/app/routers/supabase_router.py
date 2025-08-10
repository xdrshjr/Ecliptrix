"""
Supabase audio upload API routes.
"""

import os
from typing import Union
from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form
from fastapi.responses import JSONResponse

from app.models.supabase_models import (
    AudioUploadRequest,
    AudioUploadResponse,
    SupabaseUploadResponse,
    SupabaseUploadErrorResponse
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
        
        # 调用Supabase服务上传文件
        result = supabase_service.upload_audio_file(
            audio_file_path=request.audio_file_path,
            segment_id=request.segment_id,
            task_id=request.task_id,
            voice_type=request.voice_type,
            custom_filename=request.custom_filename
        )
        
        if not result["success"]:
            logger.error("音频文件上传失败", {
                "error": result["message"],
                "audio_file_path": request.audio_file_path,
                "segment_id": request.segment_id,
                "task_id": request.task_id
            })
            return SupabaseUploadErrorResponse(
                success=False,
                message=result["message"],
                error_code="UPLOAD_FAILED"
            )
        
        logger.info("音频文件上传成功", {
            "audio_url": result["audio_url"],
            "file_size": result["file_size"],
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        
        return AudioUploadResponse(
            success=True,
            message="音频文件上传成功",
            audio_url=result["audio_url"],
            file_path=result["file_path"],
            file_size=result["file_size"],
            duration=result.get("duration"),
            segment_id=result.get("segment_id"),
            task_id=result.get("task_id"),
            upload_time=result["upload_time"]
        )
        
    except HTTPException as e:
        # FastAPI HTTPException，直接抛出
        logger.error("音频上传HTTP异常", {
            "status_code": e.status_code,
            "detail": e.detail,
            "audio_file_path": request.audio_file_path,
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        raise e
        
    except Exception as e:
        # 其他异常，包装为错误响应
        error_msg = str(e)
        logger.error("音频上传未知错误", {
            "error": error_msg,
            "audio_file_path": request.audio_file_path,
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        
        return SupabaseUploadErrorResponse(
            success=False,
            message=f"音频文件上传异常: {error_msg}",
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
    segment_id: str = Form(None, description="段落ID")
) -> Union[SupabaseUploadResponse, SupabaseUploadErrorResponse]:
    """
    上传文件到Supabase存储桶
    
    Args:
        file: 要上传的文件
        bucket_path: 存储桶中的目标路径
        task_id: 任务ID
        segment_id: 段落ID
    
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
            "segment_id": segment_id
        })
        
        # 创建临时文件
        import tempfile
        import shutil
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_file:
            # 保存上传的文件到临时位置
            shutil.copyfileobj(file.file, temp_file)
            temp_file_path = temp_file.name
        
        try:
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
                    "segment_id": segment_id
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
                "segment_id": segment_id
            })
            
            return SupabaseUploadResponse(
                success=True,
                message="文件上传成功",
                file_url=result["file_url"],
                file_path=result["file_path"],
                file_size=result["file_size"],
                upload_time=result["upload_time"],
                metadata={
                    "original_filename": file.filename,
                    "content_type": file.content_type,
                    "task_id": task_id,
                    "segment_id": segment_id
                }
            )
            
        finally:
            # 清理临时文件
            try:
                os.unlink(temp_file_path)
            except:
                pass
        
    except HTTPException as e:
        # FastAPI HTTPException，直接抛出
        logger.error("文件上传HTTP异常", {
            "status_code": e.status_code,
            "detail": e.detail,
            "filename": file.filename,
            "task_id": task_id,
            "segment_id": segment_id
        })
        raise e
        
    except Exception as e:
        # 其他异常，包装为错误响应
        error_msg = str(e)
        logger.error("文件上传未知错误", {
            "error": error_msg,
            "filename": file.filename,
            "task_id": task_id,
            "segment_id": segment_id
        })
        
        return SupabaseUploadErrorResponse(
            success=False,
            message=f"文件上传异常: {error_msg}",
            error_code="INTERNAL_ERROR"
        )


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