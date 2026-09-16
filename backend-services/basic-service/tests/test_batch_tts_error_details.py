"""批量失败来源、逐段音色与超时快照回归。"""

from concurrent.futures import Future, TimeoutError
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.models.tts_models import BatchTTSRequest, BatchTTSSegmentResult
from app.services import batch_tts_service as batch_module
from app.services.batch_tts_service import BatchTTSService


@pytest.fixture
def batch_service():
    service = BatchTTSService.__new__(BatchTTSService)
    service.tts_service = Mock()
    service.config = SimpleNamespace(
        concurrent_threads=2, max_concurrent_threads=10,
        request_timeout=30, batch_timeout=300,
        limits=SimpleNamespace(max_segments_per_batch=50,
                               max_total_text_length=100000,
                               max_text_length_per_segment=5000),
        logging=SimpleNamespace(enable_detailed_logs=False),
    )
    return service


def batch_request(**overrides):
    return BatchTTSRequest(**{
        'segments': [{'segment_id': 'first', 'text': '第一段',
                      'voice_type': 'first-voice'},
                     {'segment_id': 'second', 'text': '第二段'}],
        'voice_type': 'default-voice', **overrides,
    })


def test_each_segment_uses_its_own_voice(batch_service):
    batch_service.tts_service.convert_text_to_speech.return_value = {
        'audio_url': '/api/audio/generated/result.mp3', 'file_size': 5,
        'duration': 1.0,
    }
    result = batch_service.convert_batch(batch_request())
    voices = {call.kwargs['segment_id']: call.kwargs['voice_type']
              for call in batch_service.tts_service
              .convert_text_to_speech.call_args_list}
    assert voices == {'first': 'first-voice', 'second': 'default-voice'}
    assert result.success is True


def test_blank_segment_rejects_entire_request_before_synthesis(batch_service):
    request = batch_request(segments=[{'segment_id': 'blank', 'text': '  '}])
    result = batch_service.convert_batch(request)
    assert result.success is False
    assert result.error_code == 'TTS_INVALID_REQUEST'
    assert result.error_details.attempts == 0
    batch_service.tts_service.convert_text_to_speech.assert_not_called()


def test_collection_timeout_preserves_success_snapshot(
    batch_service, monkeypatch,
):
    first, second = Future(), Future()
    first.set_result(BatchTTSSegmentResult(
        segment_id='first', success=True,
        audio_url='/api/audio/generated/first.mp3', duration=1,
    ))
    executor = Mock()
    executor.submit.side_effect = [first, second]
    manager = Mock()
    manager.__enter__ = Mock(return_value=executor)
    def finish_late(*args):
        second.set_result(BatchTTSSegmentResult(
            segment_id='second', success=True,
            audio_url='/api/audio/generated/late.mp3',
        ))
    manager.__exit__ = Mock(side_effect=finish_late)
    monkeypatch.setattr(batch_module, 'ThreadPoolExecutor',
                        Mock(return_value=manager))
    def timeout_after_first(*args, **kwargs):
        yield first
        raise TimeoutError()
    monkeypatch.setattr(batch_module, 'as_completed', timeout_after_first)
    result = batch_service.convert_batch(batch_request())
    assert [segment.success for segment in result.results] == [True, False]
    assert result.successful_segments == 1
    assert result.failed_segments == 1
    assert result.results[1].error_code == 'TTS_BACKEND_TIMEOUT'
    assert result.results[1].error_details.attempts is None


def test_concurrent_failures_keep_independent_diagnostics(batch_service):
    import threading
    from app.services.tts_errors import (
        ProviderFailureContext, provider_failure,
    )
    barrier = threading.Barrier(2)
    def fail_for_segment(**kwargs):
        identifier = kwargs['segment_id']
        failure = provider_failure(
            {'code': 45000001 if identifier == 'first' else 45000002,
             'message': ('insufficient balance' if identifier == 'first'
                         else 'permission denied')},
            ProviderFailureContext(403, f'request-{identifier}'),
        )
        barrier.wait(timeout=3)
        raise failure
    batch_service.tts_service.convert_text_to_speech.side_effect = fail_for_segment
    result = batch_service.convert_batch(batch_request())
    assert [item.error_details.request_id for item in result.results] == [
        'request-first', 'request-second',
    ]
    assert result.error_code == 'TTS_INSUFFICIENT_BALANCE'
    assert result.error_details.provider_code == '45000001'
    assert result.failed_segments == 2


def test_configuration_failure_fills_every_segment_without_workers(batch_service):
    from app.services.tts_errors import make_tts_error
    batch_service.tts_service.validate_config.side_effect = make_tts_error(
        'TTS_CONFIG_MISSING', attempts=0,
    )
    result = batch_service.convert_batch(batch_request())
    assert len(result.results) == 2
    assert all(item.error_code == 'TTS_CONFIG_MISSING'
               and item.error_details.attempts == 0 for item in result.results)
    batch_service.tts_service.convert_text_to_speech.assert_not_called()


@pytest.mark.parametrize('segments', [
    [{'segment_id': 'same', 'text': '一'},
     {'segment_id': 'same', 'text': '二'}],
    [{'segment_id': 'one', 'text': '一', 'voice_type': ' '}],
    [{'segment_id': 'one', 'text': '长' * 5001}],
])
def test_invalid_batch_models_fail_before_provider_call(segments):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        batch_request(segments=segments)


def test_completed_future_not_yet_yielded_survives_collection_failure(
    batch_service, monkeypatch,
):
    first, second = Future(), Future()
    for future, identifier in [(first, 'first'), (second, 'second')]:
        future.set_result(BatchTTSSegmentResult(
            segment_id=identifier, success=True,
            audio_url=f'/api/audio/generated/{identifier}.mp3',
        ))
    monkeypatch.setattr(batch_module, 'as_completed',
                        Mock(side_effect=RuntimeError('private stack')))
    results = {}
    batch_service._collect_results({first: 'first', second: 'second'}, results)
    assert len(results) == 2
    assert all(result.success for result in results.values())
