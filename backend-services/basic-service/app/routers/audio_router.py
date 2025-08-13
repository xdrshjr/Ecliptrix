"""
Audio transcription API routes.
"""

import os
from typing import Union
from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse

from app.models.audio_models import (
    AudioTranscriptionRequest,
    AudioTranscriptionResponse,
    AudioTranscriptionErrorResponse,
    AudioTranscriptionStatus
)
from app.services.audio_transcription_service import audio_transcription_service
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/audio", tags=["Audio Transcription"])
logger = get_logger(__name__)


@router.post(
    "/transcribe",
    response_model=Union[AudioTranscriptionResponse, AudioTranscriptionErrorResponse],
    summary="音频转字幕",
    description="将音频文件转换为字幕，支持多种语言和格式选项"
)
async def transcribe_audio(
    file: UploadFile = File(..., description="音频文件（支持MP3、WAV等格式）"),
    language: str = Form(default="zh-CN", description="语言代码"),
    use_itn: bool = Form(default=True, description="是否使用逆文本规范化"),
    use_punc: bool = Form(default=False, description="是否使用标点符号"),
    max_lines: int = Form(default=2, description="最大行数"),
    words_per_line: int = Form(default=15, description="每行最大字数"),
    generate_srt_file: bool = Form(default=True, description="是否生成SRT字幕文件")
) -> Union[AudioTranscriptionResponse, AudioTranscriptionErrorResponse]:
    """
    将音频文件转换为字幕
    
    Args:
        file: 上传的音频文件
        language: 语言代码，默认中文
        use_itn: 是否使用逆文本规范化
        use_punc: 是否使用标点符号
        max_lines: 最大行数
        words_per_line: 每行最大字数
        generate_srt_file: 是否生成SRT字幕文件
    
    Returns:
        AudioTranscriptionResponse: 转换成功的响应
        AudioTranscriptionErrorResponse: 转换失败的错误响应
    """
    temp_file_path = None
    
    try:
        logger.info("收到音频转字幕请求", {
            "filename": file.filename,
            "content_type": file.content_type,
            "language": language,
            "use_itn": use_itn,
            "use_punc": use_punc,
            "max_lines": max_lines,
            "words_per_line": words_per_line,
            "generate_srt_file": generate_srt_file
        })

        # 验证文件类型
        if not file.content_type or not file.content_type.startswith('audio/'):
            logger.error(f"不支持的文件类型: {file.content_type}")
            return AudioTranscriptionErrorResponse(
                error="不支持的文件类型，请上传音频文件",
                error_code="INVALID_FILE_TYPE"
            )

        # 验证文件大小（限制为100MB）
        file_size = 0
        content = await file.read()
        file_size = len(content)
        
        if file_size > 100 * 1024 * 1024:  # 100MB
            logger.error(f"文件过大: {file_size} bytes")
            return AudioTranscriptionErrorResponse(
                error="文件过大，请上传小于100MB的音频文件",
                error_code="FILE_TOO_LARGE"
            )

        # 保存临时文件
        import tempfile
        import time
        
        # 确保临时目录存在
        temp_dir = os.path.join("temp", "audio")
        os.makedirs(temp_dir, exist_ok=True)
        
        # 生成临时文件名
        file_extension = os.path.splitext(file.filename)[1] if file.filename else '.mp3'
        temp_filename = f"audio_{int(time.time())}_{hash(file.filename or 'unknown')}{file_extension}"
        temp_file_path = os.path.join(temp_dir, temp_filename)
        
        # 写入临时文件
        with open(temp_file_path, 'wb') as temp_file:
            temp_file.write(content)
        
        logger.info(f"临时文件保存成功: {temp_file_path}, 大小: {file_size} bytes")

        # 处理音频转字幕
        result = audio_transcription_service.process_audio_file(
            audio_path=temp_file_path,
            language=language,
            use_itn=use_itn,
            use_punc=use_punc,
            max_lines=max_lines,
            words_per_line=words_per_line,
            generate_srt_file=generate_srt_file
        )

        if result["success"]:
            logger.info("音频转字幕成功", {
                "job_id": result["job_id"],
                "subtitle_count": result.get("subtitle_count", 0),
                "processing_time": result["processing_time"]
            })
            
            return AudioTranscriptionResponse(
                job_id=result["job_id"],
                subtitles=result["subtitles"],
                srt_content=result.get("srt_content"),
                srt_file_path=result.get("srt_file_path"),
                srt_file_url=result.get("srt_file_url"),
                processing_time=result["processing_time"],
                audio_duration=result.get("audio_duration")
            )
        else:
            logger.error("音频转字幕失败", {
                "error": result["error"],
                "processing_time": result["processing_time"]
            })
            
            return AudioTranscriptionErrorResponse(
                error=result["error"],
                error_code="TRANSCRIPTION_FAILED",
                details={
                    "processing_time": result["processing_time"]
                }
            )

    except Exception as e:
        logger.error(f"音频转字幕异常: {str(e)}")
        return AudioTranscriptionErrorResponse(
            error=f"音频转字幕处理异常: {str(e)}",
            error_code="INTERNAL_ERROR"
        )
    
    finally:
        # 清理临时文件
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"临时文件清理成功: {temp_file_path}")
            except Exception as e:
                logger.warning(f"临时文件清理失败: {temp_file_path}, 错误: {str(e)}")


@router.post(
    "/transcribe-local",
    response_model=Union[AudioTranscriptionResponse, AudioTranscriptionErrorResponse],
    summary="本地音频转字幕",
    description="处理服务器本地的音频文件转换为字幕（用于测试）"
)
async def transcribe_local_audio(
    file_path: str = Form(..., description="服务器本地音频文件路径"),
    language: str = Form(default="zh-CN", description="语言代码"),
    use_itn: bool = Form(default=True, description="是否使用逆文本规范化"),
    use_punc: bool = Form(default=False, description="是否使用标点符号"),
    max_lines: int = Form(default=2, description="最大行数"),
    words_per_line: int = Form(default=15, description="每行最大字数"),
    generate_srt_file: bool = Form(default=True, description="是否生成SRT字幕文件")
) -> Union[AudioTranscriptionResponse, AudioTranscriptionErrorResponse]:
    """
    处理服务器本地的音频文件转换为字幕
    
    Args:
        file_path: 服务器本地音频文件路径
        language: 语言代码
        use_itn: 是否使用逆文本规范化
        use_punc: 是否使用标点符号
        max_lines: 最大行数
        words_per_line: 每行最大字数
        generate_srt_file: 是否生成SRT字幕文件
    
    Returns:
        AudioTranscriptionResponse: 转换成功的响应
        AudioTranscriptionErrorResponse: 转换失败的错误响应
    """
    try:
        logger.info("收到本地音频转字幕请求", {
            "file_path": file_path,
            "language": language,
            "use_itn": use_itn,
            "use_punc": use_punc,
            "max_lines": max_lines,
            "words_per_line": words_per_line,
            "generate_srt_file": generate_srt_file
        })

        # 检查文件是否存在
        if not os.path.exists(file_path):
            logger.error(f"文件不存在: {file_path}")
            return AudioTranscriptionErrorResponse(
                error=f"文件不存在: {file_path}",
                error_code="FILE_NOT_FOUND"
            )

        # 处理音频转字幕
        result = audio_transcription_service.process_audio_file(
            audio_path=file_path,
            language=language,
            use_itn=use_itn,
            use_punc=use_punc,
            max_lines=max_lines,
            words_per_line=words_per_line,
            generate_srt_file=generate_srt_file
        )

        if result["success"]:
            logger.info("本地音频转字幕成功", {
                "job_id": result["job_id"],
                "subtitle_count": result.get("subtitle_count", 0),
                "processing_time": result["processing_time"]
            })
            
            return AudioTranscriptionResponse(
                job_id=result["job_id"],
                subtitles=result["subtitles"],
                srt_content=result.get("srt_content"),
                srt_file_path=result.get("srt_file_path"),
                srt_file_url=result.get("srt_file_url"),
                processing_time=result["processing_time"],
                audio_duration=result.get("audio_duration")
            )
        else:
            logger.error("本地音频转字幕失败", {
                "error": result["error"],
                "processing_time": result["processing_time"]
            })
            
            return AudioTranscriptionErrorResponse(
                error=result["error"],
                error_code="TRANSCRIPTION_FAILED",
                details={
                    "processing_time": result["processing_time"]
                }
            )

    except Exception as e:
        logger.error(f"本地音频转字幕异常: {str(e)}")
        return AudioTranscriptionErrorResponse(
            error=f"本地音频转字幕处理异常: {str(e)}",
            error_code="INTERNAL_ERROR"
        )


@router.get(
    "/health",
    summary="音频转字幕服务健康检查",
    description="检查音频转字幕服务的健康状态"
)
async def health_check():
    """
    音频转字幕服务健康检查
    
    Returns:
        服务健康状态信息
    """
    try:
        # 检查服务配置
        from datetime import datetime
        service_status = {
            "service": "audio_transcription",
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "config": {
                "appid_configured": bool(audio_transcription_service.appid),
                "access_token_configured": bool(audio_transcription_service.access_token),
                "secret_key_configured": bool(audio_transcription_service.secret_key),
                "base_url": audio_transcription_service.base_url
            }
        }
        
        logger.info("音频转字幕服务健康检查", service_status)
        return service_status
        
    except Exception as e:
        logger.error(f"音频转字幕服务健康检查失败: {str(e)}")
        return {
            "service": "audio_transcription",
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        } 