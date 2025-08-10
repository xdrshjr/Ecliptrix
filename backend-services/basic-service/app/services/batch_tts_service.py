"""
Batch Text-to-Speech service for concurrent processing of multiple segments.
"""

import asyncio
import time
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.config import settings
from app.logger import get_logger
from app.models import (
    BatchTTSRequest,
    BatchTTSResponse,
    BatchTTSSegmentResult,
    VoiceType
)
from app.services.tts_service import TTSService

logger = get_logger(__name__)


class BatchTTSService:
    """Batch Text-to-Speech service for concurrent processing."""
    
    def __init__(self):
        self.tts_service = TTSService()
        self.config = settings.batch_tts
        logger.info("BatchTTSService初始化", {
            "concurrent_threads": self.config.concurrent_threads,
            "max_concurrent_threads": self.config.max_concurrent_threads,
            "request_timeout": self.config.request_timeout,
            "batch_timeout": self.config.batch_timeout
        })
    
    def _validate_batch_request(self, request: BatchTTSRequest) -> None:
        """验证批量TTS请求"""
        segments_count = len(request.segments)
        
        # 检查段落数量限制
        if segments_count > self.config.limits.max_segments_per_batch:
            raise ValueError(
                f"段落数量超过限制：{segments_count} > {self.config.limits.max_segments_per_batch}"
            )
        
        # 检查总文本长度
        total_text_length = sum(len(segment.text) for segment in request.segments)
        if total_text_length > self.config.limits.max_total_text_length:
            raise ValueError(
                f"总文本长度超过限制：{total_text_length} > {self.config.limits.max_total_text_length}"
            )
        
        # 检查单个段落文本长度
        for segment in request.segments:
            if len(segment.text) > self.config.limits.max_text_length_per_segment:
                raise ValueError(
                    f"段落 {segment.segment_id} 文本长度超过限制：{len(segment.text)} > {self.config.limits.max_text_length_per_segment}"
                )
        
        logger.info("批量TTS请求验证通过", {
            "segments_count": segments_count,
            "total_text_length": total_text_length,
            "task_id": request.task_id
        })
    
    def _convert_single_segment(
        self, 
        segment_text: str,
        segment_id: str,
        segment_title: Optional[str],
        voice_type: VoiceType,
        speed_ratio: float,
        task_id: Optional[str]
    ) -> BatchTTSSegmentResult:
        """转换单个段落"""
        start_time = time.time()
        
        try:
            logger.info(f"开始处理段落 {segment_id}", {
                "segment_id": segment_id,
                "segment_title": segment_title,
                "text_length": len(segment_text),
                "voice_type": voice_type.value,
                "task_id": task_id
            })
            
            # 调用TTS服务转换
            result = self.tts_service.convert_text_to_speech(
                text=segment_text,
                voice_type=voice_type,
                speed_ratio=speed_ratio,
                segment_id=segment_id,
                task_id=task_id
            )
            
            processing_time = time.time() - start_time
            
            logger.info(f"段落 {segment_id} 转换成功", {
                "segment_id": segment_id,
                "audio_url": result["audio_url"],
                "file_size": result["file_size"],
                "duration": result.get("duration"),
                "processing_time": processing_time,
                "task_id": task_id
            })
            
            return BatchTTSSegmentResult(
                segment_id=segment_id,
                success=True,
                audio_url=result["audio_url"],
                duration=result.get("duration"),
                file_size=result["file_size"],
                processing_time=processing_time
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = str(e)
            
            logger.error(f"段落 {segment_id} 转换失败", {
                "segment_id": segment_id,
                "error": error_msg,
                "processing_time": processing_time,
                "task_id": task_id
            })
            
            return BatchTTSSegmentResult(
                segment_id=segment_id,
                success=False,
                error=error_msg,
                processing_time=processing_time
            )
    
    def convert_batch(self, request: BatchTTSRequest) -> BatchTTSResponse:
        """批量转换文本为语音"""
        batch_start_time = time.time()
        
        logger.info("开始批量TTS转换", {
            "segments_count": len(request.segments),
            "voice_type": request.voice_type.value,
            "speed_ratio": request.speed_ratio,
            "task_id": request.task_id,
            "concurrent_threads": request.concurrent_threads or self.config.concurrent_threads
        })
        
        try:
            # 验证请求
            self._validate_batch_request(request)
            
            # 确定并发线程数
            concurrent_threads = request.concurrent_threads or self.config.concurrent_threads
            concurrent_threads = min(concurrent_threads, self.config.max_concurrent_threads)
            concurrent_threads = min(concurrent_threads, len(request.segments))  # 不超过段落数
            
            logger.info("开始并发处理", {
                "concurrent_threads": concurrent_threads,
                "segments_count": len(request.segments)
            })
            
            results = []
            
            # 使用ThreadPoolExecutor进行并发处理
            with ThreadPoolExecutor(max_workers=concurrent_threads) as executor:
                # 提交所有任务
                future_to_segment = {}
                for segment in request.segments:
                    future = executor.submit(
                        self._convert_single_segment,
                        segment.text,
                        segment.segment_id,
                        segment.title,
                        request.voice_type,
                        request.speed_ratio,
                        request.task_id
                    )
                    future_to_segment[future] = segment.segment_id
                
                # 收集结果
                processed_count = 0
                for future in as_completed(future_to_segment, timeout=self.config.batch_timeout):
                    segment_id = future_to_segment[future]
                    try:
                        result = future.result(timeout=self.config.request_timeout)
                        results.append(result)
                        processed_count += 1
                        
                        # 记录进度
                        if self.config.logging.enable_detailed_logs and \
                           processed_count % self.config.logging.log_progress_interval == 0:
                            logger.info("批量转换进度", {
                                "processed": processed_count,
                                "total": len(request.segments),
                                "progress_percent": round(processed_count / len(request.segments) * 100, 1),
                                "task_id": request.task_id
                            })
                            
                    except Exception as e:
                        logger.error(f"段落 {segment_id} 处理异常", {
                            "segment_id": segment_id,
                            "error": str(e),
                            "task_id": request.task_id
                        })
                        results.append(BatchTTSSegmentResult(
                            segment_id=segment_id,
                            success=False,
                            error=f"处理超时或异常: {str(e)}",
                            processing_time=self.config.request_timeout
                        ))
            
            # 统计结果
            total_processing_time = time.time() - batch_start_time
            successful_segments = sum(1 for r in results if r.success)
            failed_segments = len(results) - successful_segments
            
            # 按原始顺序排序结果
            segment_order = {seg.segment_id: i for i, seg in enumerate(request.segments)}
            results.sort(key=lambda r: segment_order.get(r.segment_id, 999))
            
            logger.info("批量TTS转换完成", {
                "total_segments": len(request.segments),
                "successful_segments": successful_segments,
                "failed_segments": failed_segments,
                "total_processing_time": total_processing_time,
                "success_rate": round(successful_segments / len(request.segments) * 100, 1),
                "task_id": request.task_id
            })
            
            return BatchTTSResponse(
                success=failed_segments == 0,
                message=f"批量语音转换完成，成功 {successful_segments}/{len(request.segments)} 个段落",
                total_segments=len(request.segments),
                successful_segments=successful_segments,
                failed_segments=failed_segments,
                total_processing_time=total_processing_time,
                results=results
            )
            
        except Exception as e:
            total_processing_time = time.time() - batch_start_time
            error_msg = str(e)
            
            logger.error("批量TTS转换失败", {
                "error": error_msg,
                "total_processing_time": total_processing_time,
                "task_id": request.task_id
            })
            
            return BatchTTSResponse(
                success=False,
                message=f"批量语音转换失败: {error_msg}",
                total_segments=len(request.segments),
                successful_segments=0,
                failed_segments=len(request.segments),
                total_processing_time=total_processing_time,
                results=[]
            ) 