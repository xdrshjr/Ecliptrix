"""
Text-to-Speech API routes.
"""

from typing import Union
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from app.models.tts_models import (
    TTSRequest, 
    TTSResponse, 
    TTSErrorResponse,
    VoiceTypesResponse
)
from app.services.tts_service import tts_service
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/tts", tags=["Text-to-Speech"])
logger = get_logger(__name__)


@router.post(
    "/convert",
    response_model=Union[TTSResponse, TTSErrorResponse],
    summary="文本转语音",
    description="将文本转换为语音文件，支持多种音色和语速调节"
)
async def convert_text_to_speech(request: TTSRequest) -> Union[TTSResponse, TTSErrorResponse]:
    """
    将文本转换为语音文件
    
    Args:
        request: TTS转换请求，包含文本内容、音色类型等参数
    
    Returns:
        TTSResponse: 转换成功的响应，包含音频文件URL等信息
        TTSErrorResponse: 转换失败的错误响应
    """
    try:
        logger.info("收到TTS转换请求", {
            "text_length": len(request.text),
            "voice_type": request.voice_type.value,
            "speed_ratio": request.speed_ratio,
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        
        # 调用TTS服务进行转换
        result = tts_service.convert_text_to_speech(
            text=request.text,
            voice_type=request.voice_type,
            speed_ratio=request.speed_ratio,
            segment_id=request.segment_id,
            task_id=request.task_id
        )
        
        logger.info("TTS转换请求处理成功", {
            "audio_url": result["audio_url"],
            "file_size": result["file_size"],
            "voice_type": result["voice_type"],
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        
        return TTSResponse(
            success=True,
            message="语音转换成功",
            data=result
        )
        
    except HTTPException as e:
        # FastAPI HTTPException，直接抛出
        logger.error("TTS转换HTTP异常", {
            "status_code": e.status_code,
            "detail": e.detail,
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        raise e
        
    except Exception as e:
        # 其他异常，包装为TTSErrorResponse
        error_msg = str(e)
        logger.error("TTS转换未知错误", {
            "error": error_msg,
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        
        return TTSErrorResponse(
            success=False,
            message=f"语音转换失败: {error_msg}",
            error_code="CONVERSION_FAILED",
            details={
                "segment_id": request.segment_id,
                "task_id": request.task_id,
                "voice_type": request.voice_type.value
            }
        )


@router.get(
    "/voice-types",
    response_model=VoiceTypesResponse,
    summary="获取可用音色列表",
    description="获取所有可用的TTS音色类型及其详细信息"
)
async def get_voice_types() -> VoiceTypesResponse:
    """
    获取可用的TTS音色类型列表
    
    Returns:
        VoiceTypesResponse: 包含所有可用音色信息的响应
    """
    try:
        logger.info("收到获取音色列表请求")
        
        voice_types = tts_service.get_available_voice_types()
        
        logger.info("获取音色列表成功", {
            "voice_types_count": len(voice_types)
        })
        
        return VoiceTypesResponse(
            success=True,
            message="获取音色列表成功",
            data=voice_types
        )
        
    except Exception as e:
        error_msg = str(e)
        logger.error("获取音色列表失败", {
            "error": error_msg
        })
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取音色列表失败: {error_msg}"
        )


@router.get(
    "/health",
    summary="TTS服务健康检查",
    description="检查TTS服务的配置和可用性状态"
)
async def tts_health_check():
    """
    TTS服务健康检查
    
    Returns:
        Dict: 服务健康状态信息
    """
    try:
        logger.info("收到TTS健康检查请求")
        
        # 验证配置
        tts_service.validate_config()
        
        health_info = {
            "service": "TTS",
            "status": "healthy",
            "config_valid": True,
            "available_voice_types": len(tts_service.get_available_voice_types()),
            "message": "TTS服务运行正常"
        }
        
        logger.info("TTS健康检查通过", health_info)
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=health_info
        )
        
    except HTTPException as e:
        # 配置验证失败
        error_info = {
            "service": "TTS",
            "status": "unhealthy",
            "config_valid": False,
            "message": e.detail
        }
        
        logger.error("TTS健康检查失败", error_info)
        
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=error_info
        )
        
    except Exception as e:
        error_msg = str(e)
        error_info = {
            "service": "TTS",
            "status": "error",
            "message": f"健康检查异常: {error_msg}"
        }
        
        logger.error("TTS健康检查异常", error_info)
        
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=error_info
        ) 