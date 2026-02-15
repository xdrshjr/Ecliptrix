"""
Sentence-level Text-to-Speech service for concurrent processing with audio concatenation.
"""

import asyncio
import os
import time
import uuid
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from app.config import settings
from app.logger import get_logger
from app.models import (
    SentenceBatchTTSRequest,
    SentenceBatchTTSResponse,
    SentenceTTSResult,
    SentenceTTSRequest
)
from app.services.tts_service import TTSService

logger = get_logger(__name__)

try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
    logger.info("pydub库可用，将使用pydub进行音频拼接")
except ImportError:
    PYDUB_AVAILABLE = False
    logger.warning("pydub库不可用，将使用ffmpeg进行音频拼接")


class SentenceTTSService:
    """Sentence-level Text-to-Speech service for concurrent processing with audio concatenation."""
    
    def __init__(self):
        self.tts_service = TTSService()
        self.config = settings.batch_tts
        self.audio_dir = Path("static/audio/generated")
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info("SentenceTTSService初始化", {
            "concurrent_threads": self.config.concurrent_threads,
            "max_concurrent_threads": self.config.max_concurrent_threads,
            "audio_directory": str(self.audio_dir),
            "pydub_available": PYDUB_AVAILABLE
        })
    
    def _validate_sentence_batch_request(self, request: SentenceBatchTTSRequest) -> None:
        """验证句子级批量TTS请求"""
        sentences_count = len(request.sentences)
        
        # 检查句子数量限制
        if sentences_count > 20:  # 句子级别限制更严格
            raise ValueError(f"句子数量超过限制：{sentences_count} > 20")
        
        # 检查总文本长度
        total_text_length = sum(len(sentence.text) for sentence in request.sentences)
        if total_text_length > self.config.limits.max_total_text_length:
            raise ValueError(
                f"总文本长度超过限制：{total_text_length} > {self.config.limits.max_total_text_length}"
            )
        
        # 检查单个句子文本长度
        for sentence in request.sentences:
            if len(sentence.text) > 2000:  # 句子级别限制
                raise ValueError(
                    f"句子 {sentence.sentence_id} 文本长度超过限制：{len(sentence.text)} > 2000"
                )
        
        # 检查句子顺序是否连续且从0开始
        orders = [sentence.order for sentence in request.sentences]
        expected_orders = list(range(len(request.sentences)))
        if sorted(orders) != expected_orders:
            raise ValueError(
                f"句子顺序必须从0开始且连续，期望: {expected_orders}, 实际: {sorted(orders)}"
            )
        
        logger.info("句子级批量TTS请求验证通过", {
            "segment_id": request.segment_id,
            "sentences_count": sentences_count,
            "total_text_length": total_text_length,
            "task_id": request.task_id
        })
    
    def _convert_single_sentence(
        self, 
        sentence: SentenceTTSRequest,
        voice_type: str,
        speed_ratio: float,
        segment_id: str,
        task_id: Optional[str]
    ) -> SentenceTTSResult:
        """转换单个句子并保存到本地，支持重试机制"""
        start_time = time.time()
        max_retries = 3
        
        logger.info(f"开始处理句子 {sentence.sentence_id}", {
            "sentence_id": sentence.sentence_id,
            "segment_id": segment_id,
            "order": sentence.order,
            "text_length": len(sentence.text),
            "voice_type": voice_type,
            "max_retries": max_retries,
            "task_id": task_id
        })
        
        for attempt in range(max_retries):
            try:
                attempt_start_time = time.time()
                
                logger.info(f"句子 {sentence.sentence_id} 开始第 {attempt + 1}/{max_retries} 次尝试", {
                    "sentence_id": sentence.sentence_id,
                    "segment_id": segment_id,
                    "attempt": attempt + 1,
                    "max_retries": max_retries,
                    "task_id": task_id
                })
                
                # 生成本地文件名（每次尝试都生成新的文件名）
                timestamp = int(time.time())
                local_filename = f"{segment_id}_{sentence.sentence_id}_sentence_{timestamp}_{uuid.uuid4().hex[:8]}.mp3"
                local_audio_path = self.audio_dir / local_filename
                
                # 调用TTS服务转换并保存到本地
                result = self.tts_service.convert_text_to_speech_local(
                    text=sentence.text,
                    voice_type=voice_type,
                    speed_ratio=speed_ratio,
                    output_path=str(local_audio_path),
                    segment_id=f"{segment_id}_{sentence.sentence_id}",
                    task_id=task_id
                )
                
                # 验证本地文件是否存在
                if not local_audio_path.exists():
                    raise Exception(f"本地音频文件创建失败: {local_audio_path}")
                
                file_size = local_audio_path.stat().st_size
                if file_size == 0:
                    raise Exception(f"本地音频文件为空: {local_audio_path}")
                
                local_audio_url = f"/api/audio/generated/{local_filename}"
                attempt_processing_time = time.time() - attempt_start_time
                total_processing_time = time.time() - start_time
                
                logger.info(f"句子 {sentence.sentence_id} 第 {attempt + 1} 次尝试成功", {
                    "sentence_id": sentence.sentence_id,
                    "segment_id": segment_id,
                    "attempt": attempt + 1,
                    "local_path": str(local_audio_path),
                    "file_size": file_size,
                    "duration": result.get("duration"),
                    "attempt_processing_time": attempt_processing_time,
                    "total_processing_time": total_processing_time,
                    "task_id": task_id
                })
                
                return SentenceTTSResult(
                    sentence_id=sentence.sentence_id,
                    order=sentence.order,
                    success=True,
                    audio_url=local_audio_url,
                    duration=result.get("duration"),
                    file_size=file_size,
                    processing_time=total_processing_time
                    # start_time 和 end_time 将在音频拼接后设置
                )
                
            except Exception as e:
                attempt_processing_time = time.time() - attempt_start_time
                error_msg = str(e)
                
                logger.error(f"句子 {sentence.sentence_id} 第 {attempt + 1}/{max_retries} 次尝试失败", {
                    "sentence_id": sentence.sentence_id,
                    "segment_id": segment_id,
                    "attempt": attempt + 1,
                    "max_retries": max_retries,
                    "error": error_msg,
                    "attempt_processing_time": attempt_processing_time,
                    "task_id": task_id
                })
                
                # 清理失败的文件
                if 'local_audio_path' in locals() and local_audio_path.exists():
                    try:
                        if local_audio_path.stat().st_size == 0:
                            local_audio_path.unlink()
                            logger.debug(f"清理空文件: {local_audio_path}")
                    except Exception as cleanup_error:
                        logger.warning(f"清理失败文件异常: {cleanup_error}")
                
                # 如果不是最后一次尝试，等待后重试
                if attempt < max_retries - 1:
                    retry_delay = 2 * (attempt + 1)  # 递增延迟：2秒, 4秒, 6秒
                    logger.info(f"句子 {sentence.sentence_id} 等待 {retry_delay} 秒后重试", {
                        "sentence_id": sentence.sentence_id,
                        "segment_id": segment_id,
                        "retry_delay": retry_delay,
                        "next_attempt": attempt + 2,
                        "task_id": task_id
                    })
                    time.sleep(retry_delay)
                else:
                    # 最后一次尝试也失败了
                    total_processing_time = time.time() - start_time
                    
                    logger.error(f"句子 {sentence.sentence_id} 所有重试尝试均失败", {
                        "sentence_id": sentence.sentence_id,
                        "segment_id": segment_id,
                        "max_retries": max_retries,
                        "final_error": error_msg,
                        "total_processing_time": total_processing_time,
                        "task_id": task_id
                    })
                    
                    return SentenceTTSResult(
                        sentence_id=sentence.sentence_id,
                        order=sentence.order,
                        success=False,
                        error=f"重试{max_retries}次后失败: {error_msg}",
                        processing_time=total_processing_time
                    )
        
        # 这里不应该到达，但作为安全措施
        total_processing_time = time.time() - start_time
        return SentenceTTSResult(
            sentence_id=sentence.sentence_id,
            order=sentence.order,
            success=False,
            error="未知错误：重试循环异常退出",
            processing_time=total_processing_time
        )
    
    def _concatenate_audio_files_pydub(
        self, 
        sentence_results: List[SentenceTTSResult],
        output_filename: str
    ) -> Dict[str, Any]:
        """使用pydub拼接音频文件"""
        try:
            combined_audio = AudioSegment.empty()
            current_time = 0.0
            
            for result in sentence_results:
                if not result.success or not result.audio_url:
                    continue
                
                # 构建音频文件路径
                audio_filename = os.path.basename(result.audio_url)
                audio_path = self.audio_dir / audio_filename
                
                if not audio_path.exists():
                    logger.error(f"音频文件不存在: {audio_path}")
                    continue
                
                # 加载音频段
                audio_segment = AudioSegment.from_mp3(str(audio_path))
                
                # 设置时间信息
                result.start_time = current_time
                result.end_time = current_time + len(audio_segment) / 1000.0  # pydub以毫秒为单位
                current_time = result.end_time
                
                # 拼接音频
                combined_audio += audio_segment
                
                logger.debug(f"已拼接句子音频 {result.sentence_id}", {
                    "start_time": result.start_time,
                    "end_time": result.end_time,
                    "duration": result.end_time - result.start_time
                })
            
            # 保存拼接后的音频
            output_path = self.audio_dir / output_filename
            combined_audio.export(str(output_path), format="mp3")
            
            # 获取文件信息
            file_size = output_path.stat().st_size
            total_duration = len(combined_audio) / 1000.0
            
            logger.info("使用pydub拼接音频完成", {
                "output_file": output_filename,
                "total_duration": total_duration,
                "file_size": file_size,
                "segments_count": len([r for r in sentence_results if r.success])
            })
            
            return {
                "output_path": str(output_path),
                "total_duration": total_duration,
                "file_size": file_size
            }
            
        except Exception as e:
            logger.error("pydub音频拼接失败", {
                "error": str(e),
                "output_filename": output_filename
            })
            raise e
    
    def _concatenate_audio_files_ffmpeg(
        self, 
        sentence_results: List[SentenceTTSResult],
        output_filename: str
    ) -> Dict[str, Any]:
        """使用ffmpeg拼接音频文件"""
        try:
            import subprocess
            
            # 创建临时文件列表
            temp_list_file = self.audio_dir / f"temp_list_{uuid.uuid4().hex}.txt"
            output_path = self.audio_dir / output_filename
            
            # 生成ffmpeg输入文件列表
            with open(temp_list_file, 'w', encoding='utf-8') as f:
                current_time = 0.0
                for result in sentence_results:
                    if not result.success or not result.audio_url:
                        continue
                    
                    audio_filename = os.path.basename(result.audio_url)
                    audio_path = self.audio_dir / audio_filename
                    
                    if not audio_path.exists():
                        logger.error(f"音频文件不存在: {audio_path}")
                        continue
                    
                    f.write(f"file '{audio_path.absolute()}'\n")
                    
                    # 使用ffprobe获取音频时长
                    try:
                        probe_cmd = [
                            'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
                            '-of', 'csv=p=0', str(audio_path)
                        ]
                        duration_output = subprocess.run(
                            probe_cmd, capture_output=True, text=True, check=True
                        )
                        duration = float(duration_output.stdout.strip())
                        
                        # 设置时间信息
                        result.start_time = current_time
                        result.end_time = current_time + duration
                        current_time = result.end_time
                        
                    except Exception as probe_e:
                        logger.warning(f"获取音频时长失败 {result.sentence_id}: {probe_e}")
                        # 使用估算时长
                        estimated_duration = result.duration or len(result.sentence_id) * 0.5
                        result.start_time = current_time
                        result.end_time = current_time + estimated_duration
                        current_time = result.end_time
            
            # 使用ffmpeg拼接音频
            ffmpeg_cmd = [
                'ffmpeg', '-f', 'concat', '-safe', '0', '-i', str(temp_list_file),
                '-c', 'copy', str(output_path), '-y'
            ]
            
            logger.info("执行ffmpeg音频拼接", {
                "command": ' '.join(ffmpeg_cmd),
                "input_files": len([r for r in sentence_results if r.success])
            })
            
            subprocess.run(ffmpeg_cmd, check=True, capture_output=True)
            
            # 获取输出文件信息
            file_size = output_path.stat().st_size
            
            # 获取总时长
            probe_cmd = [
                'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
                '-of', 'csv=p=0', str(output_path)
            ]
            duration_output = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
            total_duration = float(duration_output.stdout.strip())
            
            # 清理临时文件
            temp_list_file.unlink()
            
            logger.info("使用ffmpeg拼接音频完成", {
                "output_file": output_filename,
                "total_duration": total_duration,
                "file_size": file_size,
                "segments_count": len([r for r in sentence_results if r.success])
            })
            
            return {
                "output_path": str(output_path),
                "total_duration": total_duration,
                "file_size": file_size
            }
            
        except subprocess.CalledProcessError as e:
            logger.error("ffmpeg音频拼接失败", {
                "error": str(e),
                "stderr": e.stderr.decode() if e.stderr else None,
                "output_filename": output_filename
            })
            raise e
        except Exception as e:
            logger.error("ffmpeg音频拼接异常", {
                "error": str(e),
                "output_filename": output_filename
            })
            raise e
        finally:
            # 确保清理临时文件
            if temp_list_file.exists():
                temp_list_file.unlink()
    
    def _concatenate_audio_files(
        self, 
        sentence_results: List[SentenceTTSResult],
        segment_id: str,
        task_id: Optional[str]
    ) -> Dict[str, Any]:
        """拼接音频文件并计算时间信息"""
        # 过滤出成功的结果并按顺序排序
        successful_results = [r for r in sentence_results if r.success]
        successful_results.sort(key=lambda x: x.order)
        
        if not successful_results:
            raise ValueError("没有成功的音频文件可供拼接")
        
        # 生成输出文件名
        timestamp = int(time.time())
        output_filename = f"{segment_id}_concatenated_{timestamp}_{uuid.uuid4().hex[:8]}.mp3"
        
        logger.info("开始音频拼接", {
            "segment_id": segment_id,
            "successful_sentences": len(successful_results),
            "output_filename": output_filename,
            "task_id": task_id
        })
        
        # 选择拼接方法
        if PYDUB_AVAILABLE:
            result = self._concatenate_audio_files_pydub(successful_results, output_filename)
        else:
            result = self._concatenate_audio_files_ffmpeg(successful_results, output_filename)
        
        # 上传拼接后的音频到存储服务
        try:
            from app.services.storage_service import storage_service
            import asyncio

            output_path = Path(result["output_path"])

            logger.info("开始上传拼接音频到存储服务", {
                "output_filename": output_filename,
                "file_size": result["file_size"],
                "segment_id": segment_id,
                "task_id": task_id
            })

            with open(output_path, "rb") as f:
                file_data = f.read()

            loop = asyncio.get_event_loop()
            upload_result = loop.run_until_complete(
                storage_service.upload_audio_file(
                    file_data=file_data,
                    filename=output_filename,
                    content_type="audio/mpeg",
                    user_id="anonymous",
                    task_id=task_id or "default-task",
                )
            )

            if upload_result["success"]:
                audio_url = upload_result["file_url"]
                logger.info("拼接音频上传到存储服务成功", {
                    "output_filename": output_filename,
                    "audio_url": audio_url,
                    "segment_id": segment_id,
                    "task_id": task_id
                })
            else:
                logger.error("拼接音频上传到存储服务失败", {
                    "output_filename": output_filename,
                    "error": upload_result.get("message"),
                    "segment_id": segment_id,
                    "task_id": task_id
                })
                # 使用本地URL作为备用
                audio_url = f"/api/audio/generated/{output_filename}"

            # 清理本地临时文件（保留单个句子的音频文件，只清理拼接文件）
            try:
                output_path.unlink()
                logger.debug(f"清理本地拼接音频文件: {output_path}")
            except Exception as cleanup_error:
                logger.warning(f"清理本地拼接文件失败: {cleanup_error}")

        except Exception as upload_error:
            logger.error("上传拼接音频到存储服务异常", {
                "output_filename": output_filename,
                "error": str(upload_error),
                "segment_id": segment_id,
                "task_id": task_id
            })
            # 使用本地URL作为备用
            audio_url = f"/api/audio/generated/{output_filename}"
        
        return {
            "audio_url": audio_url,
            "total_duration": result["total_duration"],
            "file_size": result["file_size"],
            "output_filename": output_filename
        }
    
    def convert_sentence_batch(self, request: SentenceBatchTTSRequest) -> SentenceBatchTTSResponse:
        """批量转换句子为语音并拼接"""
        batch_start_time = time.time()
        
        logger.info("开始句子级批量TTS转换", {
            "segment_id": request.segment_id,
            "sentences_count": len(request.sentences),
            "voice_type": request.voice_type,
            "speed_ratio": request.speed_ratio,
            "task_id": request.task_id,
            "concurrent_threads": request.concurrent_threads or self.config.concurrent_threads
        })
        
        try:
            # 验证请求
            self._validate_sentence_batch_request(request)
            
            # 确定并发线程数
            concurrent_threads = request.concurrent_threads or self.config.concurrent_threads
            concurrent_threads = min(concurrent_threads, self.config.max_concurrent_threads)
            concurrent_threads = min(concurrent_threads, len(request.sentences))
            
            logger.info("开始并发处理句子", {
                "concurrent_threads": concurrent_threads,
                "sentences_count": len(request.sentences),
                "segment_id": request.segment_id
            })
            
            sentence_results = []
            
            # 使用ThreadPoolExecutor进行并发处理
            with ThreadPoolExecutor(max_workers=concurrent_threads) as executor:
                # 提交所有任务
                future_to_sentence = {}
                for sentence in request.sentences:
                    future = executor.submit(
                        self._convert_single_sentence,
                        sentence,
                        request.voice_type,
                        request.speed_ratio,
                        request.segment_id,
                        request.task_id
                    )
                    future_to_sentence[future] = sentence.sentence_id
                
                # 收集结果
                processed_count = 0
                for future in as_completed(future_to_sentence, timeout=self.config.batch_timeout):
                    sentence_id = future_to_sentence[future]
                    try:
                        result = future.result(timeout=self.config.request_timeout)
                        sentence_results.append(result)
                        processed_count += 1
                        
                        # 记录进度
                        if processed_count % 2 == 0 or processed_count == len(request.sentences):
                            successful_so_far = sum(1 for r in sentence_results if r.success)
                            failed_so_far = processed_count - successful_so_far
                            
                            logger.info("句子转换进度", {
                                "processed": processed_count,
                                "total": len(request.sentences),
                                "successful": successful_so_far,
                                "failed": failed_so_far,
                                "progress_percent": round(processed_count / len(request.sentences) * 100, 1),
                                "success_rate": round(successful_so_far / processed_count * 100, 1) if processed_count > 0 else 0,
                                "segment_id": request.segment_id,
                                "task_id": request.task_id
                            })
                            
                    except Exception as e:
                        logger.error(f"句子 {sentence_id} 处理异常", {
                            "sentence_id": sentence_id,
                            "segment_id": request.segment_id,
                            "error": str(e),
                            "task_id": request.task_id
                        })
                        sentence_results.append(SentenceTTSResult(
                            sentence_id=sentence_id,
                            order=-1,  # 将在后续处理中修正
                            success=False,
                            error=f"处理超时或异常: {str(e)}",
                            processing_time=self.config.request_timeout
                        ))
            
            # 按顺序排序结果
            sentence_results.sort(key=lambda r: r.order if r.order >= 0 else 999)
            
            # 统计结果
            successful_sentences = sum(1 for r in sentence_results if r.success)
            failed_sentences = len(sentence_results) - successful_sentences
            
            # 拼接音频文件（仅对成功的句子）
            concatenated_audio_url = None
            total_duration = None
            concatenated_file_size = None
            
            if successful_sentences > 0:
                try:
                    concatenation_result = self._concatenate_audio_files(
                        sentence_results, 
                        request.segment_id, 
                        request.task_id
                    )
                    concatenated_audio_url = concatenation_result["audio_url"]
                    total_duration = concatenation_result["total_duration"]
                    concatenated_file_size = concatenation_result["file_size"]
                    
                except Exception as concat_e:
                    logger.error("音频拼接失败", {
                        "segment_id": request.segment_id,
                        "error": str(concat_e),
                        "task_id": request.task_id
                    })
                    # 拼接失败不影响整体成功状态，但会记录错误
            
            total_processing_time = time.time() - batch_start_time
            
            # 清理单个句子的临时音频文件（保留拼接后的最终文件）
            try:
                cleaned_count = 0
                for result in sentence_results:
                    if result.success and result.audio_url:
                        # 获取本地文件路径
                        audio_filename = os.path.basename(result.audio_url)
                        local_audio_path = self.audio_dir / audio_filename
                        
                        if local_audio_path.exists():
                            local_audio_path.unlink()
                            cleaned_count += 1
                            logger.debug(f"清理句子临时音频文件: {local_audio_path}")
                            
                logger.info("句子临时音频文件清理完成", {
                    "segment_id": request.segment_id,
                    "cleaned_files": cleaned_count,
                    "task_id": request.task_id
                })
            except Exception as cleanup_error:
                logger.warning("清理句子临时音频文件失败", {
                    "segment_id": request.segment_id,
                    "error": str(cleanup_error),
                    "task_id": request.task_id
                })

            logger.info("句子级批量TTS转换完成", {
                "segment_id": request.segment_id,
                "total_sentences": len(request.sentences),
                "successful_sentences": successful_sentences,
                "failed_sentences": failed_sentences,
                "total_processing_time": total_processing_time,
                "concatenated_audio_url": concatenated_audio_url,
                "total_duration": total_duration,
                "success_rate": round(successful_sentences / len(request.sentences) * 100, 1),
                "task_id": request.task_id
            })
            
            return SentenceBatchTTSResponse(
                success=failed_sentences == 0 and concatenated_audio_url is not None,
                message=f"句子级语音转换完成，成功 {successful_sentences}/{len(request.sentences)} 个句子",
                segment_id=request.segment_id,
                total_sentences=len(request.sentences),
                successful_sentences=successful_sentences,
                failed_sentences=failed_sentences,
                total_processing_time=total_processing_time,
                concatenated_audio_url=concatenated_audio_url,
                total_duration=total_duration,
                concatenated_file_size=concatenated_file_size,
                sentence_results=sentence_results
            )
            
        except Exception as e:
            total_processing_time = time.time() - batch_start_time
            error_msg = str(e)
            
            logger.error("句子级批量TTS转换失败", {
                "segment_id": request.segment_id,
                "error": error_msg,
                "total_processing_time": total_processing_time,
                "task_id": request.task_id
            })
            
            return SentenceBatchTTSResponse(
                success=False,
                message=f"句子级语音转换失败: {error_msg}",
                segment_id=request.segment_id,
                total_sentences=len(request.sentences),
                successful_sentences=0,
                failed_sentences=len(request.sentences),
                total_processing_time=total_processing_time,
                concatenated_audio_url=None,
                total_duration=None,
                concatenated_file_size=None,
                sentence_results=[]
            )