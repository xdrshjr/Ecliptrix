"""并发语音合成：失败逐段归档，收集超时保留已确认成果。"""

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError, as_completed
from typing import Optional

from app.config import settings
from app.logger import get_logger
from app.models.tts_models import (
    BatchTTSRequest, BatchTTSResponse, BatchTTSSegmentResult,
)
from app.services.tts_errors import TTSServiceError, make_tts_error
from app.services.tts_service import TTSService

logger = get_logger(__name__)


def failed_segment(segment_id: str, failure: TTSServiceError,
                   processing_time: float = 0.0) -> BatchTTSSegmentResult:
    return BatchTTSSegmentResult(
        segment_id=segment_id, success=False, error=failure.message,
        error_code=failure.error_code, error_details=failure.error_details,
        processing_time=processing_time,
    )


def batch_response(request: BatchTTSRequest, results: dict,
                   elapsed: float) -> BatchTTSResponse:
    ordered = [results[segment.segment_id] for segment in request.segments]
    failures = [result for result in ordered if not result.success]
    successful = len(ordered) - len(failures)
    first = failures[0] if failures else None
    summary = f'批量语音转换完成，成功 {successful}/{len(ordered)} 个段落'
    return BatchTTSResponse(
        success=not failures,
        message=f'{summary}。{first.error}' if first else summary,
        total_segments=len(ordered), successful_segments=successful,
        failed_segments=len(failures), total_processing_time=elapsed,
        results=ordered, error_code=first.error_code if first else None,
        error_details=first.error_details if first else None,
    )


class BatchTTSService:
    """保留既有并发边界，不重试整批或取消工作线程。"""

    def __init__(self):
        self.tts_service = TTSService()
        self.config = settings.batch_tts

    def _validate_batch_request(self, request: BatchTTSRequest) -> None:
        limits = self.config.limits
        texts = [segment.text for segment in request.segments]
        identifiers = [segment.segment_id for segment in request.segments]
        invalid = (
            not texts or len(texts) > limits.max_segments_per_batch
            or len(identifiers) != len(set(identifiers))
            or sum(map(len, texts)) > limits.max_total_text_length
            or any(not text.strip() or len(text) > min(
                limits.max_text_length_per_segment, 5000,
            ) for text in texts)
        )
        if invalid:
            raise make_tts_error('TTS_INVALID_REQUEST', 'backend', 0)

    def _convert_single_segment(
        self, segment_text: str, segment_id: str,
        segment_title: Optional[str], voice_type: str,
        speed_ratio: float, task_id: Optional[str],
        storage_loop: Optional[asyncio.AbstractEventLoop] = None,
    ) -> BatchTTSSegmentResult:
        # 保留已存在的 worker 参数签名，避免影响既有调用者。
        started = time.monotonic()
        try:
            result = self.tts_service.convert_text_to_speech(
                text=segment_text, voice_type=voice_type,
                speed_ratio=speed_ratio, segment_id=segment_id,
                task_id=task_id, storage_loop=storage_loop,
            )
            return BatchTTSSegmentResult(
                segment_id=segment_id, success=True,
                audio_url=result['audio_url'], duration=result.get('duration'),
                file_size=result['file_size'],
                processing_time=time.monotonic() - started,
            )
        except TTSServiceError as error:
            failure = error
        except Exception:
            failure = make_tts_error('TTS_UNKNOWN_ERROR', 'backend')
        logger.warning('批量语音段落转换失败', {
            'error_code': failure.error_code,
            'attempts': failure.error_details.attempts,
        })
        return failed_segment(segment_id, failure,
                              time.monotonic() - started)

    @staticmethod
    def _read_future(future, segment_id: str) -> BatchTTSSegmentResult:
        try:
            result = future.result()
            if (not isinstance(result, BatchTTSSegmentResult)
                    or result.segment_id != segment_id):
                raise make_tts_error('TTS_INVALID_RESPONSE', 'backend')
            return result
        except TTSServiceError as error:
            return failed_segment(segment_id, error)
        except Exception:
            return failed_segment(segment_id, make_tts_error(
                'TTS_UNKNOWN_ERROR', 'backend',
            ))

    def _collect_results(self, futures: dict, results: dict) -> None:
        try:
            for future in as_completed(futures,
                                       timeout=self.config.batch_timeout):
                identifier = futures[future]
                results[identifier] = self._read_future(future, identifier)
            return
        except TimeoutError:
            failure = make_tts_error('TTS_BACKEND_TIMEOUT', 'backend')
        except Exception:
            failure = make_tts_error('TTS_UNKNOWN_ERROR', 'backend')
        # 退出前快照已完成项；线程池退出等待期间的新结果不再导入。
        completed = {future for future in futures if future.done()}
        for future, identifier in futures.items():
            if identifier in results:
                continue
            results[identifier] = (
                self._read_future(future, identifier) if future in completed
                else failed_segment(identifier, failure)
            )
        logger.warning('批量语音收集未完全确认', {
            'error_code': failure.error_code,
        })

    def convert_batch(
        self, request: BatchTTSRequest,
        storage_loop: Optional[asyncio.AbstractEventLoop] = None,
    ) -> BatchTTSResponse:
        started = time.monotonic()
        results = {}
        try:
            self._validate_batch_request(request)
            self.tts_service.validate_config()
            threads = min(
                request.concurrent_threads or self.config.concurrent_threads,
                self.config.max_concurrent_threads, len(request.segments),
            )
            with ThreadPoolExecutor(max_workers=threads) as executor:
                futures = {}
                try:
                    for segment in request.segments:
                        future = executor.submit(
                            self._convert_single_segment,
                            segment.text, segment.segment_id, segment.title,
                            segment.voice_type or request.voice_type,
                            request.speed_ratio, request.task_id,
                            storage_loop=storage_loop,
                        )
                        futures[future] = segment.segment_id
                finally:
                    self._collect_results(futures, results)
        except TTSServiceError as error:
            self._fill_missing(request, results, error)
        except Exception:
            self._fill_missing(request, results, make_tts_error(
                'TTS_UNKNOWN_ERROR', 'backend',
            ))
        return batch_response(request, results, time.monotonic() - started)

    @staticmethod
    def _fill_missing(request: BatchTTSRequest, results: dict,
                      failure: TTSServiceError) -> None:
        logger.warning('批量语音转换未全部完成', {
            'error_code': failure.error_code,
        })
        for segment in request.segments:
            if segment.segment_id not in results:
                results[segment.segment_id] = failed_segment(
                    segment.segment_id, failure,
                )
