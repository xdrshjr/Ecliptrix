"""
Sentence-level Text-to-Speech service for concurrent processing with audio concatenation.
"""

import os
import time
import uuid
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from fastapi import HTTPException

from app.config import settings
from app.logger import get_logger
from app.models import (
    SentenceBatchTTSRequest,
    SentenceBatchTTSResponse,
    SentenceTTSResult,
    SentenceTTSRequest
)
from app.services.local_media_resolver import audio_generated_dir
from app.services.tts_service import TTSService
from app.services.tts_errors import (
    TTSServiceError, make_tts_error, safe_identifier,
)

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
        # Generated audio lives under the persistent, writable STORAGE_ROOT (Bug B
        # / B1) — see local_media_resolver.audio_generated_dir.
        self.audio_dir = audio_generated_dir()
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
        self, sentence: SentenceTTSRequest, voice_type: str,
        speed_ratio: float, segment_id: str, task_id: Optional[str],
    ) -> SentenceTTSResult:
        # 保留线程池的既有位置参数签名；每次 local 调用仅尝试一次。
        started = time.monotonic()
        max_attempts = 3
        provider_attempts: Optional[int] = 0
        options = dict(voice_type=voice_type, speed_ratio=speed_ratio,
                       segment_id=segment_id, task_id=task_id)
        identifier = safe_identifier(
            sentence.sentence_id, (self.tts_service.api_key, sentence.text),
            True,
        )
        for attempt in range(1, max_attempts + 1):
            try:
                result = self._convert_sentence_attempt(sentence, options)
                elapsed = time.monotonic() - started
                logger.info(
                    '句子语音合成成功 sentence_id=%s worker_attempt=%s '
                    'file_size=%s processing_time=%s',
                    identifier, attempt, result.get('file_size'), elapsed,
                )
                return self._successful_sentence(sentence, result, elapsed)
            except TTSServiceError as error:
                failure = error
            except HTTPException as error:
                is_preflight = error.status_code in {400, 422}
                failure = make_tts_error(
                    'TTS_INVALID_REQUEST' if is_preflight else
                    'TTS_UNKNOWN_ERROR', 'local', 0 if is_preflight else None,
                )
            except Exception:
                failure = make_tts_error('TTS_UNKNOWN_ERROR', 'local', None)
            provider_attempts = self._accumulate_attempts(
                provider_attempts, failure.error_details.attempts,
            )
            failure = (failure.with_attempts(provider_attempts)
                       if provider_attempts is not None else TTSServiceError(
                           failure.error_code, failure.error_details.model_copy(
                               update={'attempts': None})))
            logger.warning(
                '句子语音合成失败 sentence_id=%s error_code=%s retryable=%s '
                'worker_attempt=%s provider_attempts=%s request_id=%s',
                identifier, failure.error_code, failure.error_details.retryable,
                attempt, provider_attempts, failure.error_details.request_id,
            )
            if not failure.error_details.retryable or attempt == max_attempts:
                break
            logger.info(
                '句子语音合成等待 sentence_id=%s retry_delay=%s next_attempt=%s',
                identifier, 2 * attempt, attempt + 1,
            )
            time.sleep(2 * attempt)
        return self._failed_sentence(
            sentence, failure, time.monotonic() - started,
        )

    def _convert_sentence_attempt(
        self, sentence: SentenceTTSRequest, options: dict,
    ) -> Dict[str, Any]:
        timestamp = int(time.time())
        segment_id = options['segment_id']
        filename = (
            f'{segment_id}_{sentence.sentence_id}_sentence_'
            f'{timestamp}_{uuid.uuid4().hex[:8]}.mp3'
        )
        return self.tts_service.convert_text_to_speech_local(
            text=sentence.text, voice_type=options['voice_type'],
            speed_ratio=options['speed_ratio'],
            output_path=str(self.audio_dir / filename),
            segment_id=f'{segment_id}_{sentence.sentence_id}',
            task_id=options['task_id'],
        )

    @staticmethod
    def _successful_sentence(
        sentence: SentenceTTSRequest, result: dict, elapsed: float,
    ) -> SentenceTTSResult:
        return SentenceTTSResult(
            sentence_id=sentence.sentence_id, order=sentence.order,
            success=True, audio_url=result['audio_url'],
            duration=result.get('duration'), file_size=result['file_size'],
            processing_time=elapsed,
        )

    @staticmethod
    def _failed_sentence(
        sentence: SentenceTTSRequest, failure: TTSServiceError,
        elapsed: Optional[float],
    ) -> SentenceTTSResult:
        return SentenceTTSResult(
            sentence_id=sentence.sentence_id, order=sentence.order,
            success=False, error=failure.message, error_code=failure.error_code,
            error_details=failure.error_details, processing_time=elapsed,
        )

    @staticmethod
    def _accumulate_attempts(
        total: Optional[int], current: Optional[int],
    ) -> Optional[int]:
        # 未知请求数不能用 worker 的循环次数代替。
        return None if total is None or current is None else total + current

    @staticmethod
    def _sentence_failure_summary(
        results: List[SentenceTTSResult],
    ) -> Optional[str]:
        failed = [result for result in results if not result.success]
        if not failed:
            return None
        first = min(failed, key=lambda result: result.order)
        return make_tts_error(first.error_code or 'TTS_UNKNOWN_ERROR').message
    
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
        
        # 直接使用本地URL（文件已保存在 static/audio/generated/ 目录，通过 FastAPI 静态文件挂载提供服务）
        audio_url = f"/api/audio/generated/{output_filename}"
        
        return {
            "audio_url": audio_url,
            "total_duration": result["total_duration"],
            "file_size": result["file_size"],
            "output_filename": output_filename
        }
    
    def convert_sentence_batch(self, request: SentenceBatchTTSRequest) -> SentenceBatchTTSResponse:
        """批量转换句子为语音并拼接"""
        # 既有批量调度超过行数限制；本轮仅修改结果汇总，保留拼接与清理流程。
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
                    future_to_sentence[future] = sentence
                
                # 收集结果
                processed_count = 0
                for future in as_completed(future_to_sentence, timeout=self.config.batch_timeout):
                    sentence = future_to_sentence[future]
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
                            
                    except Exception:
                        failure = make_tts_error('TTS_UNKNOWN_ERROR',
                                                 'local', None)
                        identifier = safe_identifier(
                            sentence.sentence_id,
                            (self.tts_service.api_key, sentence.text), True,
                        )
                        logger.error(
                            '句子处理异常 sentence_id=%s error_code=%s '
                            'retryable=%s provider_attempts=%s request_id=%s',
                            identifier, failure.error_code,
                            failure.error_details.retryable,
                            failure.error_details.attempts,
                            failure.error_details.request_id,
                        )
                        sentence_results.append(self._failed_sentence(
                            sentence, failure, None,
                        ))
            
            # 按顺序排序结果
            sentence_results.sort(key=lambda r: r.order)
            
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
            
            message = (
                '句子级语音转换完成，成功 '
                f'{successful_sentences}/{len(request.sentences)} 个句子'
            )
            failure_summary = self._sentence_failure_summary(sentence_results)
            if failure_summary:
                message += f'。{failure_summary}'
            return SentenceBatchTTSResponse(
                success=failed_sentences == 0 and concatenated_audio_url is not None,
                message=message,
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
