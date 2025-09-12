"""
Text-to-Speech API routes.
"""

import os
from typing import Union
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse, FileResponse

from app.models.tts_models import (
    TTSRequest, 
    TTSResponse, 
    TTSErrorResponse,
    VoiceTypesResponse,
    BatchTTSRequest,
    BatchTTSResponse,
    SentenceBatchTTSRequest,
    SentenceBatchTTSResponse
)
from app.services.tts_service import tts_service
from app.services.batch_tts_service import BatchTTSService
from app.services.sentence_tts_service import SentenceTTSService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/tts", tags=["Text-to-Speech"])
logger = get_logger(__name__)

# Initialize batch TTS services
batch_tts_service = BatchTTSService()
sentence_tts_service = SentenceTTSService()


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
            "voice_type": request.voice_type,
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
            error_code="CONVERSION_FAILED"
        )


@router.post(
    "/convert-batch",
    response_model=BatchTTSResponse,
    summary="批量文本转语音",
    description="批量将多个文本段落转换为语音文件，支持并发处理"
)
async def convert_batch_text_to_speech(request: BatchTTSRequest) -> BatchTTSResponse:
    """
    批量将文本转换为语音文件
    
    Args:
        request: 批量TTS转换请求，包含多个文本段落和配置参数
    
    Returns:
        BatchTTSResponse: 批量转换响应，包含每个段落的处理结果
    """
    try:
        logger.info("收到批量TTS转换请求", {
            "segments_count": len(request.segments),
            "voice_type": request.voice_type,
            "speed_ratio": request.speed_ratio,
            "task_id": request.task_id,
            "concurrent_threads": request.concurrent_threads,
            "total_text_length": sum(len(seg.text) for seg in request.segments)
        })
        
        # 调用批量TTS服务进行转换
        result = batch_tts_service.convert_batch(request)
        
        logger.info("批量TTS转换请求处理完成", {
            "success": result.success,
            "total_segments": result.total_segments,
            "successful_segments": result.successful_segments,
            "failed_segments": result.failed_segments,
            "total_processing_time": result.total_processing_time,
            "task_id": request.task_id
        })
        
        return result
        
    except HTTPException as e:
        # FastAPI HTTPException，直接抛出
        logger.error("批量TTS转换HTTP异常", {
            "status_code": e.status_code,
            "detail": e.detail,
            "task_id": request.task_id
        })
        raise e
        
    except Exception as e:
        # 其他异常，包装为BatchTTSResponse
        error_msg = str(e)
        logger.error("批量TTS转换未知错误", {
            "error": error_msg,
            "task_id": request.task_id
        })
        
        return BatchTTSResponse(
            success=False,
            message=f"批量语音转换失败: {error_msg}",
            total_segments=len(request.segments),
            successful_segments=0,
            failed_segments=len(request.segments),
            total_processing_time=0.0,
            results=[]
        )


@router.post(
    "/convert-sentences",
    response_model=SentenceBatchTTSResponse,
    summary="句子级批量文本转语音",
    description="将多个句子并发转换为语音文件并拼接，返回每个句子的时间信息"
)
async def convert_sentence_batch_text_to_speech(request: SentenceBatchTTSRequest) -> SentenceBatchTTSResponse:
    """
    句子级批量将文本转换为语音文件并拼接
    
    Args:
        request: 句子级批量TTS转换请求，包含多个句子和配置参数
    
    Returns:
        SentenceBatchTTSResponse: 句子级批量转换响应，包含拼接后的音频和每个句子的时间信息
    """
    try:
        logger.info("收到句子级批量TTS转换请求", {
            "segment_id": request.segment_id,
            "sentences_count": len(request.sentences),
            "voice_type": request.voice_type,
            "speed_ratio": request.speed_ratio,
            "task_id": request.task_id,
            "concurrent_threads": request.concurrent_threads,
            "total_text_length": sum(len(sentence.text) for sentence in request.sentences)
        })
        
        # 调用句子级批量TTS服务进行转换
        result = sentence_tts_service.convert_sentence_batch(request)
        
        logger.info("句子级批量TTS转换请求处理完成", {
            "success": result.success,
            "segment_id": result.segment_id,
            "total_sentences": result.total_sentences,
            "successful_sentences": result.successful_sentences,
            "failed_sentences": result.failed_sentences,
            "total_processing_time": result.total_processing_time,
            "concatenated_audio_url": result.concatenated_audio_url,
            "total_duration": result.total_duration,
            "task_id": request.task_id
        })
        
        return result
        
    except HTTPException as e:
        # FastAPI HTTPException，直接抛出
        logger.error("句子级批量TTS转换HTTP异常", {
            "status_code": e.status_code,
            "detail": e.detail,
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        raise e
        
    except Exception as e:
        # 其他异常，包装为SentenceBatchTTSResponse
        error_msg = str(e)
        logger.error("句子级批量TTS转换未知错误", {
            "error": error_msg,
            "segment_id": request.segment_id,
            "task_id": request.task_id
        })
        
        return SentenceBatchTTSResponse(
            success=False,
            message=f"句子级语音转换失败: {error_msg}",
            segment_id=request.segment_id,
            total_sentences=len(request.sentences),
            successful_sentences=0,
            failed_sentences=len(request.sentences),
            total_processing_time=0.0,
            concatenated_audio_url=None,
            total_duration=None,
            concatenated_file_size=None,
            sentence_results=[]
        )


@router.get(
    "/voice-types",
    response_model=VoiceTypesResponse,
    summary="获取可用音色列表",
    description="获取所有可用的TTS音色类型及其详细信息"
)
async def get_voice_types(locale: str = "zh-CN") -> VoiceTypesResponse:
    """
    获取可用的TTS音色类型列表
    
    Returns:
        VoiceTypesResponse: 包含所有可用音色信息的响应
    """
    try:
        logger.info("收到获取音色列表请求", {
            "locale": locale
        })
        
        voice_types = tts_service.get_available_voice_types(locale=locale)
        
        logger.info("获取音色列表成功", {
            "voice_types_count": len(voice_types),
            "locale": locale
        })
        
        return VoiceTypesResponse(
            success=True,
            message="获取音色列表成功" if locale == "zh-CN" else "Voice types retrieved successfully",
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


@router.get(
    "/download/{file_name}",
    summary="下载音频文件",
    description="下载指定的音频文件到客户端本地",
    responses={
        200: {"description": "音频文件下载成功", "content": {"audio/mpeg": {}}},
        404: {"description": "音频文件不存在"},
        500: {"description": "下载失败"}
    }
)
async def download_audio_file(file_name: str):
    """
    下载音频文件到客户端本地
    
    Args:
        file_name: 音频文件名（包含扩展名）
    
    Returns:
        FileResponse: 音频文件的二进制流
    """
    try:
        logger.info("收到音频文件下载请求", {
            "file_name": file_name,
            "request_type": "download"
        })
        
        # 构建文件路径
        audio_dir = "static/audio/generated"
        file_path = os.path.join(audio_dir, file_name)
        
        # 检查文件是否存在
        if not os.path.exists(file_path):
            logger.error("音频文件不存在", {
                "file_name": file_name,
                "file_path": file_path
            })
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"音频文件不存在: {file_name}"
            )
        
        # 检查文件是否为空
        file_size = os.path.getsize(file_path)
        if file_size == 0:
            logger.error("音频文件为空", {
                "file_name": file_name,
                "file_path": file_path,
                "file_size": file_size
            })
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"音频文件已损坏: {file_name}"
            )
        
        logger.info("音频文件下载成功", {
            "file_name": file_name,
            "file_size": file_size,
            "file_path": file_path
        })
        
        # 返回文件响应
        return FileResponse(
            path=file_path,
            media_type="audio/mpeg",
            filename=file_name,
            headers={
                "Content-Disposition": f"attachment; filename={file_name}",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
        
    except HTTPException as e:
        # FastAPI HTTPException，直接抛出
        raise e
        
    except Exception as e:
        error_msg = str(e)
        logger.error("音频文件下载异常", {
            "file_name": file_name,
            "error": error_msg
        })
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"音频文件下载失败: {error_msg}"
        ) 