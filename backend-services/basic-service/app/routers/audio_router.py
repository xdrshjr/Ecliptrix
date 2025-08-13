"""
Audio transcription API routes.
"""

import os
import glob
from typing import Union
from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse

from app.models.audio_models import (
    AudioTranscriptionRequest,
    AudioTranscriptionResponse,
    AudioTranscriptionErrorResponse,
    AudioTranscriptionStatus,
    BatchAudioTranscriptionRequest,
    BatchAudioTranscriptionResponse,
    BatchAudioTranscriptionErrorResponse
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

        # 检查文件是否存在，支持通配符模式
        actual_file_path = file_path
        
        # 如果路径包含通配符，尝试查找匹配的文件
        if '*' in file_path:
            logger.info(f"检测到通配符路径，开始查找匹配文件: {file_path}")
            
            # 确保使用绝对路径进行通配符匹配
            if not os.path.isabs(file_path):
                # 如果是相对路径，转换为绝对路径
                abs_pattern = os.path.abspath(file_path)
                logger.info(f"转换为绝对路径: {abs_pattern}")
                matching_files = glob.glob(abs_pattern)
            else:
                matching_files = glob.glob(file_path)
            
            if not matching_files:
                logger.error(f"未找到匹配的文件: {file_path}")
                return AudioTranscriptionErrorResponse(
                    error=f"未找到匹配的文件: {file_path}",
                    error_code="FILE_NOT_FOUND"
                )
            
            # 使用最新的文件（按修改时间排序）
            matching_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
            actual_file_path = matching_files[0]
            logger.info(f"找到匹配文件: {actual_file_path}")
            
        elif not os.path.exists(file_path):
            logger.error(f"文件不存在: {file_path}")
            return AudioTranscriptionErrorResponse(
                error=f"文件不存在: {file_path}",
                error_code="FILE_NOT_FOUND"
            )

        # 处理音频转字幕
        result = audio_transcription_service.process_audio_file(
            audio_path=actual_file_path,
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


@router.post(
    "/batch-transcribe",
    response_model=Union[BatchAudioTranscriptionResponse, BatchAudioTranscriptionErrorResponse],
    summary="批量音频转字幕",
    description="批量将时间轴上的音频项目转换为字幕，支持多个音频文件同时处理"
)
async def batch_transcribe_audio(
    request: BatchAudioTranscriptionRequest
) -> Union[BatchAudioTranscriptionResponse, BatchAudioTranscriptionErrorResponse]:
    """
    批量将时间轴上的音频项目转换为字幕
    
    Args:
        request: 批量音频转录请求，包含音频项目列表和转录参数
    
    Returns:
        BatchAudioTranscriptionResponse: 批量转录成功的响应
        BatchAudioTranscriptionErrorResponse: 批量转录失败的错误响应
    """
    try:
        logger.info(f"收到批量音频转录请求，共{len(request.audio_items)}个音频项目")
        
        if not request.audio_items:
            logger.warning("批量音频转录请求中没有音频项目")
            return BatchAudioTranscriptionErrorResponse(
                error="请求中没有音频项目",
                error_code="NO_AUDIO_ITEMS",
                details={"audio_items_count": 0}
            )
        
        # 转换请求数据为服务层需要的格式
        audio_items_data = []
        for item in request.audio_items:
            audio_item_data = {
                'id': item.id,
                'name': item.name,
                'url': item.url,
                'start_time': item.start_time,
                'duration': item.duration,
                'track_id': item.track_id,
                'clip_start': item.clip_start or 0.0,
                'clip_end': item.clip_end
            }
            audio_items_data.append(audio_item_data)
        
        logger.info(f"开始批量音频转录处理，参数: language={request.language}, use_itn={request.use_itn}, use_punc={request.use_punc}")
        
        # 调用服务层进行批量转录
        transcription_results = audio_transcription_service.transcribe_audio_urls(
            audio_items=audio_items_data,
            language=request.language,
            use_itn=request.use_itn,
            use_punc=request.use_punc,
            max_lines=request.max_lines,
            words_per_line=request.words_per_line
        )
        
        # 统计结果
        total_items = len(transcription_results)
        successful_items = sum(1 for result in transcription_results if result.get('success', False))
        failed_items = total_items - successful_items
        total_processing_time = sum(result.get('processing_time', 0) for result in transcription_results)
        
        logger.info(f"批量音频转录完成，总计: {total_items}，成功: {successful_items}，失败: {failed_items}，总耗时: {total_processing_time:.2f}秒")
        
        # 构建响应
        response = BatchAudioTranscriptionResponse(
            success=True,
            message=f"批量音频转录完成，成功处理{successful_items}个项目",
            total_items=total_items,
            successful_items=successful_items,
            failed_items=failed_items,
            transcriptions=transcription_results,
            total_processing_time=total_processing_time
        )
        
        return response
        
    except Exception as e:
        error_message = f"批量音频转录失败: {str(e)}"
        logger.error(error_message)
        
        return BatchAudioTranscriptionErrorResponse(
            error=error_message,
            error_code="BATCH_TRANSCRIPTION_FAILED",
            details={
                "exception_type": type(e).__name__,
                "exception_message": str(e)
            }
        ) 