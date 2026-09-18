"""逐句重试、并发隔离及真实空帧解析链路的离线回归。"""

import base64
import json
import logging
import tempfile
from collections import Counter
from concurrent.futures import Future
from pathlib import Path
from threading import Event, Lock
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, call

import httpx
import pytest
import requests
from fastapi import FastAPI, HTTPException

from app.models.tts_models import (
    SentenceBatchTTSRequest, SentenceTTSRequest, SentenceTTSResult,
)
from app.services import sentence_tts_service as sentence_module
from app.services import tts_service as tts_module
from app.services.sentence_tts_service import SentenceTTSService
from app.services.tts_errors import (
    ProviderFailureContext, TTSServiceError, make_tts_error, provider_failure,
)
from app.services.tts_service import TTSService


@pytest.fixture
def synthesis(monkeypatch):
    monkeypatch.setattr(tts_module, 'MOCK_MODE', False)
    post = Mock(side_effect=AssertionError('未配置的供应商请求'))
    monkeypatch.setattr(tts_module.requests, 'post', post)
    monkeypatch.setattr(tts_module.time, 'sleep', Mock())
    for method in ('upload_file', 'upload_audio_file'):
        monkeypatch.setattr(tts_module.storage_service, method,
                            AsyncMock(side_effect=AssertionError('禁止存储')))
    local = TTSService.__new__(TTSService)
    local.api_key = 'invalid-' + 'fixture-credential'
    local.resource_id = 'seed-tts-1.0'
    monkeypatch.setattr(local, '_get_audio_duration_with_ffmpeg',
                        Mock(return_value=1.0))
    service = SentenceTTSService.__new__(SentenceTTSService)
    service.tts_service = local
    service.config = SimpleNamespace(
        concurrent_threads=2, max_concurrent_threads=2,
        batch_timeout=5, request_timeout=2,
        limits=SimpleNamespace(max_total_text_length=10000),
    )
    cache = Path(__file__).parents[1] / '.pytest_cache'
    cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as directory:
        local.audio_dir = directory
        service.audio_dir = Path(directory)
        yield service, post


def sentence(order=0, identifier=None):
    return SentenceTTSRequest(
        sentence_id=identifier or f'sentence-{order}',
        text=f'句子文本{order}', order=order,
    )


def convert(service, item=None):
    return service._convert_single_sentence(
        item or sentence(), 'voice', 1.0, 'segment', 'task',
    )


def response(status=200, payload=None):
    result = Mock(status_code=status, headers={'X-Tt-Logid': 'request-safe'})
    result.json.return_value = payload
    result.text = json.dumps(payload) if payload else ''
    return result


def null_audio_response(audio=b'audio'):
    result = response()
    result.text = '\n'.join(json.dumps(frame) for frame in [
        {'code': 0, 'data': base64.b64encode(audio).decode()},
        {'code': 0, 'data': None, 'sentence': {}},
        {'code': 20000000, 'data': None, 'message': 'OK'},
    ])
    return result


@pytest.mark.parametrize('code', [
    'TTS_INVALID_RESPONSE', 'TTS_AUTH_FAILED', 'TTS_INSUFFICIENT_BALANCE',
    'TTS_INVALID_REQUEST', 'TTS_LOCAL_IO_ERROR', 'TTS_CONFIG_MISSING',
    'TTS_PERMISSION_DENIED', 'TTS_QUOTA_EXHAUSTED', 'TTS_VOICE_UNAVAILABLE',
])
def test_non_retryable_sentence_failure_stops_immediately(
    synthesis, monkeypatch, code,
):
    service, _ = synthesis
    failure = make_tts_error(code, attempts=1)
    local = Mock(side_effect=failure)
    monkeypatch.setattr(service.tts_service, 'convert_text_to_speech_local',
                        local)
    result = convert(service)
    local.assert_called_once()
    tts_module.time.sleep.assert_not_called()
    assert result.error_code == code
    assert result.error == failure.message
    assert result.error_details.attempts == 1
    assert result.audio_url is None


@pytest.mark.parametrize('code', [
    'TTS_TIMEOUT', 'TTS_NETWORK_ERROR', 'TTS_RATE_LIMITED',
    'TTS_PROVIDER_ERROR',
])
def test_transient_sentence_failure_uses_three_attempt_budget(
    synthesis, monkeypatch, code,
):
    service, _ = synthesis
    failure = (provider_failure({}, ProviderFailureContext(502))
               if code == 'TTS_PROVIDER_ERROR'
               else make_tts_error(code, 'provider', 1))
    local = Mock(side_effect=failure)
    monkeypatch.setattr(service.tts_service, 'convert_text_to_speech_local',
                        local)
    result = convert(service)
    assert local.call_count == 3
    assert tts_module.time.sleep.call_args_list == [call(2), call(4)]
    assert result.error_code == code
    assert result.error_details.attempts == 3
    assert failure.error_details.attempts == 1


def test_second_attempt_success_stops_retrying(synthesis, monkeypatch):
    service, post = synthesis
    post.side_effect = [requests.Timeout(), null_audio_response()]
    monkeypatch.setattr(sentence_module.time, 'monotonic',
                        Mock(side_effect=[10.0, 12.5]))
    result = convert(service)
    assert result.success is True
    assert result.error is result.error_code is result.error_details is None
    assert result.processing_time == 2.5
    assert result.duration == 1.0
    assert result.file_size == 5
    assert (service.audio_dir / Path(result.audio_url).name).read_bytes() == (
        b'audio'
    )
    assert post.call_count == 2
    assert tts_module.time.sleep.call_args_list == [call(2)]


def test_last_error_controls_retry_and_diagnostics(synthesis):
    service, post = synthesis
    denied = response(401, {'code': 45000000, 'message': 'invalid API key'})
    denied.headers['X-Tt-Logid'] = 'request-final'
    post.side_effect = [requests.Timeout(), denied]
    result = convert(service)
    assert post.call_count == 2
    assert tts_module.time.sleep.call_args_list == [call(2)]
    assert result.error_code == 'TTS_AUTH_FAILED'
    assert result.error_details.request_id == 'request-final'
    assert result.error_details.provider_code == '45000000'
    assert result.error_details.attempts == 2
    assert result.error_details.retryable is False


@pytest.mark.parametrize('configured', [False, True])
def test_preflight_failure_does_not_count_provider_request(
    synthesis, monkeypatch, configured,
):
    service, post = synthesis
    if configured:
        # 固定命名输入，确保预检确实遇到已有文件。
        monkeypatch.setattr(sentence_module.time, 'time', lambda: 100)
        monkeypatch.setattr(sentence_module.uuid, 'uuid4',
                            lambda: SimpleNamespace(hex='abcdefgh'))
        target = (service.audio_dir /
                  'segment_sentence-0_sentence_100_abcdefgh.mp3')
        target.write_bytes(b'keep')
    else:
        service.tts_service.api_key = ''
    result = convert(service)
    expected = 'TTS_LOCAL_IO_ERROR' if configured else 'TTS_CONFIG_MISSING'
    assert result.error_code == expected
    assert result.error_details.attempts == 0
    post.assert_not_called()
    tts_module.time.sleep.assert_not_called()
    if configured:
        assert target.read_bytes() == b'keep'


@pytest.mark.parametrize('attempts,expected', [
    ([1, 0], 1), ([None, 1], None), ([1, None, 1], None),
])
def test_attempt_aggregation_does_not_mutate_original_error(
    synthesis, monkeypatch, attempts, expected,
):
    service, _ = synthesis
    failures = [make_tts_error('TTS_TIMEOUT', 'provider', count)
                for count in attempts]
    failures[-1] = make_tts_error('TTS_LOCAL_IO_ERROR', attempts=attempts[-1])
    local = Mock(side_effect=failures)
    monkeypatch.setattr(service.tts_service, 'convert_text_to_speech_local',
                        local)
    result = convert(service)
    assert result.error_details.attempts == expected
    assert [failure.error_details.attempts for failure in failures] == attempts
    assert result.error_details is not failures[-1].error_details
    assert local.call_count == len(attempts)


def test_unknown_failure_is_safe_and_not_retried(synthesis, monkeypatch,
                                               caplog):
    service, _ = synthesis
    private = service.tts_service.api_key + ' 私人全文 C:/private/audio.mp3'
    local = Mock(side_effect=RuntimeError(private))
    monkeypatch.setattr(service.tts_service, 'convert_text_to_speech_local',
                        local)
    with caplog.at_level(logging.DEBUG):
        result = convert(service)
    local.assert_called_once()
    tts_module.time.sleep.assert_not_called()
    assert result.error_code == 'TTS_UNKNOWN_ERROR'
    assert result.error_details.attempts is None
    assert result.error_details.retryable is False
    assert private not in result.model_dump_json() + caplog.text


@pytest.mark.parametrize('status,code,attempts', [
    (400, 'TTS_INVALID_REQUEST', 0), (422, 'TTS_INVALID_REQUEST', 0),
    (500, 'TTS_UNKNOWN_ERROR', None), (403, 'TTS_UNKNOWN_ERROR', None),
])
def test_http_exception_preflight_and_unknown_paths_are_not_retried(
    synthesis, monkeypatch, caplog, status, code, attempts,
):
    # pytest 参数列与夹具需分别注入，保留测试签名以便失败定位。
    service, _ = synthesis
    private = service.tts_service.api_key
    local = Mock(side_effect=HTTPException(status, detail=private))
    monkeypatch.setattr(service.tts_service, 'convert_text_to_speech_local',
                        local)
    with caplog.at_level(logging.DEBUG):
        result = convert(service)
    local.assert_called_once()
    tts_module.time.sleep.assert_not_called()
    assert result.error_code == code
    assert result.error_details.attempts == attempts
    assert result.error_details.retryable is False
    assert private not in result.model_dump_json() + caplog.text


@pytest.mark.parametrize('transient', [False, True])
def test_real_local_path_never_multiplies_sentence_retries(synthesis,
                                                         transient):
    service, post = synthesis
    post.side_effect = (requests.Timeout() if transient else None)
    post.return_value = response(403, {'message': 'insufficient balance'})
    result = convert(service)
    assert post.call_count == (3 if transient else 1)
    assert result.error_details.attempts == post.call_count
    assert tts_module.time.sleep.call_args_list == (
        [call(2), call(4)] if transient else []
    )


def batch_request():
    return SentenceBatchTTSRequest(
        segment_id='segment', sentences=[sentence(1), sentence(0)],
        voice_type='voice', speed_ratio=1.0,
    )


@pytest.mark.parametrize('both_fail', [False, True])
def test_sentence_failures_are_isolated_and_ordered(
    synthesis, monkeypatch, both_fail,
):
    # 真实线程 + 按文本分配响应；释放事件由已完成 future 的收集驱动。
    service, post = synthesis
    counts, lock, release = Counter(), Lock(), Event()
    completed = []
    original = sentence_module.as_completed
    def collect(futures, timeout):
        for future in original(futures, timeout=timeout):
            completed.append(future.result().order)
            yield future
            release.set()
    def provider(*args, **kwargs):
        text = json.loads(kwargs['data'])['req_params']['text']
        with lock:
            counts[text] += 1
        if text == sentence(0).text:
            assert release.wait(2), '收集线程未释放第零句'
            if not both_fail:
                return null_audio_response()
            if counts[text] == 1:
                raise requests.Timeout()
            result = response(401, {'message': 'invalid API key'})
            result.headers['X-Tt-Logid'] = 'request-zero'
            return result
        result = response(403, {'message': 'insufficient balance'})
        result.headers['X-Tt-Logid'] = 'request-one'
        return result
    post.side_effect = provider
    monkeypatch.setattr(sentence_module, 'as_completed', collect)
    monkeypatch.setattr(service, '_concatenate_audio_files', Mock(return_value={
        'audio_url': '/api/audio/generated/combined.mp3',
        'total_duration': 1.0, 'file_size': 5,
    }))
    try:
        result = service.convert_sentence_batch(batch_request())
    finally:
        release.set()
    first, second = result.sentence_results
    assert completed == [1, 0]
    assert [first.order, second.order] == [0, 1]
    assert result.success is False
    assert second.error_code == 'TTS_INSUFFICIENT_BALANCE'
    assert second.error_details.request_id == 'request-one'
    assert second.error_details.attempts == 1
    assert counts[sentence(1).text] == 1
    if both_fail:
        assert first.error_code == 'TTS_AUTH_FAILED'
        assert first.error_details.request_id == 'request-zero'
        assert first.error_details.attempts == counts[sentence(0).text] == 2
        assert make_tts_error('TTS_AUTH_FAILED').message in result.message
    else:
        assert first.success is True
        assert first.error_details is None
        assert counts[sentence(0).text] == 1


async def route_response(service, monkeypatch, request):
    from app.routers import tts_router
    monkeypatch.setattr(tts_router, 'sentence_tts_service', service)
    app = FastAPI()
    app.include_router(tts_router.router, prefix='/api')
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url='http://local.test',
    ) as api:
        return await api.post('/api/tts/convert-sentences',
                              json=request.model_dump())


@pytest.mark.asyncio
async def test_sentence_route_preserves_error_details(synthesis, monkeypatch):
    service, post = synthesis
    post.side_effect = None
    post.return_value = response(403, {'code': 45000000,
                                      'message': 'insufficient balance'})
    result = await route_response(service, monkeypatch, batch_request())
    body = result.json()
    assert result.status_code == 200
    assert body['success'] is False
    assert body['failed_sentences'] == 2
    assert make_tts_error('TTS_INSUFFICIENT_BALANCE').message in body['message']
    assert [item['order'] for item in body['sentence_results']] == [0, 1]
    for item in body['sentence_results']:
        assert item['error_code'] == 'TTS_INSUFFICIENT_BALANCE'
        assert item['error_details']['attempts'] == 1
        assert item['error_details']['retryable'] is False
        assert item['error_details']['request_id'] == 'request-safe'
    assert post.call_count == 2


@pytest.mark.asyncio
async def test_null_frame_sequence_reaches_sentence_batch_success(
    synthesis, monkeypatch,
):
    service, post = synthesis
    calls, inputs = Counter(), []
    def provider(*args, **kwargs):
        text = json.loads(kwargs['data'])['req_params']['text']
        calls[text] += 1
        return null_audio_response(text.encode())
    def concatenate(results, segment_id, task_id):
        for item in results:
            audio = service.audio_dir / Path(item.audio_url).name
            assert audio.read_bytes() == sentence(item.order).text.encode()
            inputs.append(item.order)
            item.start_time, item.end_time = item.order, item.order + 1
        output = service.audio_dir / 'combined.mp3'
        output.write_bytes(b''.join(sentence(i).text.encode() for i in inputs))
        return dict(audio_url='/api/audio/generated/combined.mp3',
                    total_duration=2.0, file_size=output.stat().st_size)
    post.side_effect = provider
    monkeypatch.setattr(service, '_concatenate_audio_files', concatenate)
    result = await route_response(service, monkeypatch, batch_request())
    body = result.json()
    assert result.status_code == 200
    assert body['success'] is True
    assert body['successful_sentences'] == 2
    assert body['failed_sentences'] == 0
    assert inputs == [0, 1]
    assert calls == {sentence(0).text: 1, sentence(1).text: 1}
    assert body['total_duration'] == 2.0
    assert body['concatenated_file_size'] > 0
    assert [(item['start_time'], item['end_time'])
            for item in body['sentence_results']] == [(0, 1), (1, 2)]
    assert (service.audio_dir / 'combined.mp3').read_bytes()
    tts_module.time.sleep.assert_not_called()
    for method in ('upload_file', 'upload_audio_file'):
        getattr(tts_module.storage_service, method).assert_not_called()


@pytest.mark.parametrize('identifier', ['credential', 'text', 'path'])
@pytest.mark.parametrize('outcome', ['success', 'permanent', 'transient'])
def test_rendered_tts_logs_include_retry_decision(
    synthesis, monkeypatch, caplog, identifier, outcome,
):
    service, _ = synthesis
    private = {'credential': service.tts_service.api_key,
               'text': sentence().text, 'path': 'C:/private/audio.mp3'}
    item = sentence(identifier=private[identifier])
    # 成功替身遵守 local 返回契约，避免恶意标识进入测试文件名。
    local = Mock(return_value=dict(audio_url='/api/audio/generated/safe.mp3',
                                   duration=1.0, file_size=5))
    if outcome != 'success':
        code = 'TTS_TIMEOUT' if outcome == 'transient' else 'TTS_AUTH_FAILED'
        failure = make_tts_error(code, 'provider', 1)
        local.side_effect = TTSServiceError(code,
            failure.error_details.model_copy(update={'request_id': 'safe-id'}))
    monkeypatch.setattr(service.tts_service, 'convert_text_to_speech_local',
                        local)
    with caplog.at_level(logging.DEBUG):
        result = convert(service, item)
    rendered = '\n'.join(record.getMessage() for record in caplog.records)
    assert private[identifier] not in rendered
    assert 'sentence_id=None' in rendered
    assert 'worker_attempt=1' in rendered
    if outcome == 'success':
        assert result.success is True
        assert 'file_size=5' in rendered
    else:
        assert f'error_code={code}' in rendered
        assert f'retryable={outcome == "transient"}' in rendered
        assert 'request_id=safe-id' in rendered
        assert f'provider_attempts={local.call_count}' in rendered
        if outcome == 'transient':
            assert 'retry_delay=2' in rendered
            assert 'retry_delay=4' in rendered


def test_lower_failure_log_renders_safe_diagnostics(synthesis, caplog):
    service, post = synthesis
    post.side_effect = None
    post.return_value = response(401, {'message': 'invalid API key'})
    with caplog.at_level(logging.DEBUG):
        convert(service)
    rendered = '\n'.join(record.getMessage() for record in caplog.records
                         if record.funcName == '_synthesize_with_retries')
    assert 'error_code=TTS_AUTH_FAILED' in rendered
    assert 'retryable=False' in rendered
    assert 'attempts=1' in rendered
    assert 'request_id=request-safe' in rendered
    assert service.tts_service.api_key not in rendered


def test_future_exception_and_summary_do_not_expose_raw_error(
    synthesis, monkeypatch, caplog,
):
    service, post = synthesis
    private = service.tts_service.api_key + ' C:/private/audio.mp3'
    def submit(*args):
        future = Future()
        future.set_exception(RuntimeError(private))
        return future
    executor = Mock()
    executor.__enter__ = Mock(return_value=SimpleNamespace(submit=submit))
    executor.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(sentence_module, 'ThreadPoolExecutor',
                        Mock(return_value=executor))
    with caplog.at_level(logging.DEBUG):
        result = service.convert_sentence_batch(batch_request())
    assert [item.order for item in result.sentence_results] == [0, 1]
    for item in result.sentence_results:
        assert item.sentence_id == sentence(item.order).sentence_id
        assert item.error_code == 'TTS_UNKNOWN_ERROR'
        assert item.error_details.attempts is None
        assert item.error_details.retryable is False
        assert item.processing_time is None
    assert private not in result.model_dump_json() + caplog.text
    assert 'error_code=TTS_UNKNOWN_ERROR' in caplog.text
    post.assert_not_called()
    tts_module.time.sleep.assert_not_called()
    unknown = SentenceTTSResult(sentence_id='zero', order=0, success=False,
                                error=private, error_code='UNKNOWN_CODE')
    known = SentenceTTSResult(sentence_id='one', order=1, success=False,
                              error=private, error_code='TTS_AUTH_FAILED')
    assert service._sentence_failure_summary([known, unknown]) == (
        make_tts_error('TTS_UNKNOWN_ERROR').message
    )
    assert service._sentence_failure_summary([known]) == (
        make_tts_error('TTS_AUTH_FAILED').message
    )
    assert service._sentence_failure_summary([]) is None
