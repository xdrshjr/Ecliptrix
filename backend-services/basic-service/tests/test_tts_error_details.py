"""语音失败详情、真实调用次数和安全日志的行为回归。"""

import base64
import json
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, Mock, call

import pytest
import requests

from app.services import tts_service as service_module
from app.services.tts_service import TTSClient, TTSService


@pytest.fixture
def synthesis(monkeypatch):
    """所有上游响应均为模拟值，不访问真实付费服务。"""
    monkeypatch.setattr(service_module, 'MOCK_MODE', False)
    post = Mock()
    monkeypatch.setattr(service_module.requests, 'post', post)
    service = TTSService.__new__(TTSService)
    service.api_key = 'invalid-' + 'fixture-credential'
    service.resource_id = 'seed-tts-1.0'
    cache = Path(__file__).parents[1] / '.pytest_cache'
    cache.mkdir(exist_ok=True)
    monkeypatch.setattr(service, '_get_audio_duration_with_ffmpeg',
                        Mock(return_value=1.0))
    monkeypatch.setattr(service, '_get_ffmpeg_path', Mock(return_value=None))
    monkeypatch.setattr(service_module.time, 'sleep', Mock())
    monkeypatch.setattr(service_module.storage_service, 'upload_audio_file',
                        AsyncMock(return_value={'success': False}))
    with tempfile.TemporaryDirectory(dir=cache) as directory:
        service.audio_dir = directory
        yield service, post


def response(status=200, frames=None, payload=None):
    result = Mock(status_code=status, headers={})
    result.text = '\n'.join(json.dumps(frame) for frame in (frames or []))
    result.json.return_value = payload
    return result


def audio_frame(audio=b'first', code=0):
    return {'code': code, 'data': base64.b64encode(audio).decode()}


def test_audio_metadata_null_and_terminal_null_are_saved(synthesis):
    service, post = synthesis
    post.return_value = response(frames=[
        audio_frame(), audio_frame(b'second'),
        {'code': 0, 'data': None, 'sentence': {}},
        {'code': 20000000, 'message': 'OK', 'data': None},
    ])
    result = service.convert_text_to_speech_local('空帧回归')
    assert Path(result['file_path']).read_bytes() == b'firstsecond'
    post.assert_called_once()


@pytest.mark.parametrize('control', [
    {'code': 0}, {'code': 0, 'data': None}, {'code': 0, 'data': ''},
    {'code': '20000000', 'data': None},
])
def test_empty_control_frames_do_not_drop_adjacent_audio(synthesis, control):
    service, post = synthesis
    post.return_value = response(frames=[
        control, audio_frame(), control, audio_frame(b'second'), control,
    ])
    post.return_value.text = '\n \n' + post.return_value.text + '\n\t\n'
    result = service.convert_text_to_speech_local('空帧回归')
    assert Path(result['file_path']).read_bytes() == b'firstsecond'
    post.assert_called_once()


def test_null_only_response_is_not_audio(synthesis):
    service, post = synthesis
    post.return_value = response(frames=[
        {'code': 0, 'data': None, 'sentence': {}},
        {'code': 20000000, 'data': None},
    ])
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech_local('空帧回归')
    assert error.value.error_code == 'TTS_INVALID_RESPONSE'
    assert error.value.error_details.attempts == 1
    assert error.value.error_details.retryable is False
    assert not list(Path(service.audio_dir).iterdir())
    post.assert_called_once()


@pytest.mark.parametrize('tail', [
    'broken-json', '[]', 'null', '{}',
    *[json.dumps({'code': code}) for code in
      [None, True, 0.0, '', ' 0', '0x0', '0.0']],
    *[json.dumps({'code': 0, 'data': data}) for data in
      [False, 0, [], {}, '@@@', 'Y Q==']],
    *[json.dumps({'code': 0, 'message': message})
      for message in [None, {}]],
])
def test_invalid_frame_after_audio_discards_response(synthesis, tail):
    service, post = synthesis
    post.return_value = response(frames=[audio_frame()])
    post.return_value.text += '\n' + tail
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech_local('坏帧回归')
    assert error.value.error_code == 'TTS_INVALID_RESPONSE'
    assert error.value.error_details.retryable is False
    assert not list(Path(service.audio_dir).iterdir())
    post.assert_called_once()


@pytest.mark.parametrize('terminal', [False, True])
def test_business_error_with_null_data_preserves_reason(synthesis, terminal):
    service, post = synthesis
    frames = [audio_frame()]
    if terminal:
        frames.append({'code': 20000000, 'data': None})
    frames.append({'code': 45000000, 'data': None,
                   'message': 'insufficient balance'})
    post.return_value = response(frames=frames)
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech_local('业务错误回归')
    assert error.value.error_code == 'TTS_INSUFFICIENT_BALANCE'
    assert not list(Path(service.audio_dir).iterdir())
    post.assert_called_once()


@pytest.mark.parametrize('terminal_audio', [False, True])
def test_audio_without_terminal_keeps_existing_compatibility(
    synthesis, terminal_audio,
):
    service, post = synthesis
    frames = [audio_frame(code='0')]
    if terminal_audio:
        frames.append(audio_frame(b'second', code='20000000'))
    post.return_value = response(frames=frames)
    result = service.convert_text_to_speech_local('兼容性回归')
    expected = b'firstsecond' if terminal_audio else b'first'
    assert Path(result['file_path']).read_bytes() == expected


@pytest.mark.parametrize('status,message,expected', [
    (403, 'insufficient balance', 'TTS_INSUFFICIENT_BALANCE'),
    (403, 'resource access denied', 'TTS_PERMISSION_DENIED'),
    (200, 'account in arrears', 'TTS_INSUFFICIENT_BALANCE'),
])
def test_provider_failure_preserves_specific_reason(
    synthesis, status, message, expected,
):
    service, post = synthesis
    post.return_value = response(status, [{'code': 45000000,
                                         'message': message}],
                                 {'code': 45000000, 'message': message})
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('测试语音')
    assert getattr(error.value, 'error_code', None) == expected
    assert error.value.error_details.attempts == 1
    assert post.call_count == 1


def test_success_control_frame_accepts_strict_decimal_code(synthesis):
    service, post = synthesis
    post.return_value = response(frames=[
        {'code': '0', 'data': base64.b64encode(b'audio').decode()},
        {'code': '20000000', 'message': 'ok'},
    ])
    result = service.convert_text_to_speech_local('测试语音')
    assert Path(result['file_path']).read_bytes() == b'audio'


@pytest.mark.parametrize('status,message,code,retries', [
    (429, 'quota exceeded for types: lifetime', 'TTS_QUOTA_EXHAUSTED', 1),
    (403, 'quota exceeded for types: concurrency', 'TTS_RATE_LIMITED', 3),
    (200, 'quota exceeded', 'TTS_PROVIDER_ERROR', 1),
    (402, '', 'TTS_PROVIDER_ERROR', 1),
    (401, '', 'TTS_AUTH_FAILED', 1),
    (403, '', 'TTS_PERMISSION_DENIED', 1),
    (429, '', 'TTS_RATE_LIMITED', 3),
    (422, '', 'TTS_INVALID_REQUEST', 1),
    (502, '', 'TTS_PROVIDER_ERROR', 3),
    (502, 'quota exceeded', 'TTS_PROVIDER_ERROR', 1),
    (401, 'voice not found', 'TTS_VOICE_UNAVAILABLE', 1),
    (200, 'invalid API key', 'TTS_AUTH_FAILED', 1),
    (200, 'invalid parameter', 'TTS_INVALID_REQUEST', 1),
    (200, 'something unexpected', 'TTS_PROVIDER_ERROR', 1),
    (200, '余额不足且鉴权失败', 'TTS_PROVIDER_ERROR', 1),
])
def test_semantic_priority_and_actual_retry_count(
    synthesis, status, message, code, retries,
):
    service, post = synthesis
    payload = {'code': 45000000, 'message': message}
    post.return_value = response(status, [payload], payload)
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('不可回显的语音文本')
    assert error.value.error_code == code
    assert error.value.error_details.attempts == retries
    assert post.call_count == retries
    assert service_module.time.sleep.call_args_list == (
        [call(2), call(4)] if retries == 3 else []
    )


@pytest.mark.parametrize('frame', [
    [], None, 5, {}, {'code': False}, {'code': 0.0}, {'code': ' 0'},
    {'code': '0x0'}, {'code': '0.0'}, {'code': '0', 'message': {}},
    {'code': 0, 'data': 7}, {'code': 0, 'data': None},
    {'code': 0, 'data': '@@@'}, {'code': 0, 'data': 'Y Q=='},
    {'code': 0, 'data': ''}, {'code': 20000000, 'message': 'ok'},
])
def test_invalid_ndjson_never_produces_audio(synthesis, frame):
    service, post = synthesis
    post.return_value = response(frames=[frame])
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert error.value.error_code == 'TTS_INVALID_RESPONSE'
    assert not list(Path(service.audio_dir).iterdir())
    assert post.call_count == 1


def test_audio_followed_by_business_failure_discards_partial_file(synthesis):
    service, post = synthesis
    post.return_value = response(frames=[
        {'code': 0, 'data': base64.b64encode(b'partial').decode()},
        {'code': 45000000, 'message': 'insufficient balance'},
    ])
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert error.value.error_code == 'TTS_INSUFFICIENT_BALANCE'
    assert not list(Path(service.audio_dir).iterdir())


@pytest.mark.parametrize('exception,code', [
    (requests.Timeout, 'TTS_TIMEOUT'),
    (requests.ConnectionError, 'TTS_NETWORK_ERROR'),
])
def test_transport_errors_retry_three_times_without_leaking(
    synthesis, exception, code,
):
    service, post = synthesis
    post.side_effect = exception(service.api_key)
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert error.value.error_code == code
    assert error.value.error_details.attempts == 3
    assert post.call_count == 3
    assert service.api_key not in str(error.value)


def test_final_attempt_retains_last_business_code_and_request_id(synthesis):
    service, post = synthesis
    responses = []
    for index in range(3):
        result = response(502, payload={'code': 500 + index})
        result.headers = {'X-Tt-Logid': f'request-{index}'}
        responses.append(result)
    post.side_effect = responses
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    details = error.value.error_details
    assert (details.provider_code, details.request_id, details.attempts) == (
        '502', 'request-2', 3,
    )


@pytest.mark.parametrize('message', [
    '<html>insufficient balance</html>',
    'permission denied: C:/private/audio.mp3',
    'authentication failed; Bearer placeholder',
    'permission denied; api_key=placeholder',
    'permission denied; token=placeholder',
    'Traceback: private stack',
])
def test_unsafe_provider_message_is_not_published(synthesis, message):
    service, post = synthesis
    post.return_value = response(frames=[{'code': 45000000,
                                         'message': message}])
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert error.value.error_details.provider_message is None


def test_all_free_fields_and_logs_remove_known_credentials(
    synthesis, monkeypatch,
):
    service, post = synthesis
    safe_text = '私人请求全文'
    fake_log = Mock()
    monkeypatch.setattr(service_module, 'logger', fake_log)
    payload = {'code': service.api_key,
               'message': f'insufficient balance {service.api_key} {safe_text}'}
    # 非成功 JSON 的 code 接受受限字符串，不将未知业务码当成欠费证据。
    post.return_value = response(403, payload=payload)
    post.return_value.headers = {'X-Tt-Logid': service.api_key}
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech(safe_text)
    public = error.value.error_details.model_dump_json() + str(fake_log.mock_calls)
    assert service.api_key not in public
    assert safe_text not in public
    assert error.value.error_details.provider_code is None
    assert error.value.error_details.request_id is None


def test_non_json_http_error_does_not_publish_body(synthesis):
    service, post = synthesis
    post.return_value = response(403)
    post.return_value.text = '<html>insufficient balance secret</html>'
    post.return_value.json.side_effect = ValueError()
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert error.value.error_code == 'TTS_PERMISSION_DENIED'
    assert error.value.error_details.provider_message is None
    post.return_value.json.assert_called_once()


@pytest.mark.parametrize('local', [False, True])
def test_file_validation_failure_does_not_resynthesize(
    synthesis, monkeypatch, local,
):
    service, post = synthesis
    synthesize = Mock(return_value=True)
    monkeypatch.setattr(TTSClient, 'synthesize_speech', synthesize)
    method = (service.convert_text_to_speech_local if local
              else service.convert_text_to_speech)
    with pytest.raises(RuntimeError) as error:
        method('安全测试')
    assert error.value.error_code == 'TTS_LOCAL_IO_ERROR'
    assert error.value.error_details.attempts == 1
    synthesize.assert_called_once()


def test_failed_write_cleans_only_new_file(synthesis, monkeypatch):
    service, post = synthesis
    post.return_value = response(frames=[{'code': 0,
        'data': base64.b64encode(b'audio').decode()}])
    unrelated = Path(service.audio_dir) / 'success.mp3'
    unrelated.write_bytes(b'keep')
    monkeypatch.setattr(service_module.os, 'fsync',
                        Mock(side_effect=PermissionError('private path')))
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert error.value.error_code == 'TTS_LOCAL_IO_ERROR'
    assert list(Path(service.audio_dir).iterdir()) == [unrelated]
    assert unrelated.read_bytes() == b'keep'
    assert post.call_count == 1


def test_existing_local_file_is_not_deleted_or_overwritten(synthesis):
    service, post = synthesis
    existing = Path(service.audio_dir) / 'success.mp3'
    existing.write_bytes(b'keep')
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech_local('安全测试',
                                             output_path=str(existing))
    assert error.value.error_code == 'TTS_LOCAL_IO_ERROR'
    assert error.value.error_details.attempts == 0
    assert existing.read_bytes() == b'keep'
    post.assert_not_called()


@pytest.mark.parametrize('field,value', [
    ('attempts', True), ('attempts', -1), ('attempts', '1'),
    ('http_status', True), ('http_status', 600), ('http_status', '200'),
    ('retryable', 'false'), ('provider_code', {'code': 2}),
    ('request_id', 'id.with.dot'),
])
def test_error_model_rejects_invalid_diagnostic_values(field, value):
    from pydantic import ValidationError
    from app.models.tts_models import TTSErrorDetails
    with pytest.raises(ValidationError):
        TTSErrorDetails(**{'source': 'provider', 'retryable': False,
                           field: value})


def test_config_and_oversized_input_have_zero_provider_attempts(synthesis):
    service, post = synthesis
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('测' * 5001)
    assert error.value.error_code == 'TTS_INVALID_REQUEST'
    assert error.value.error_details.attempts == 0
    service.api_key = ''
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert error.value.error_code == 'TTS_CONFIG_MISSING'
    assert error.value.error_details.attempts == 0
    post.assert_not_called()


def test_output_created_by_another_call_is_not_removed(synthesis, monkeypatch):
    service, post = synthesis
    target = Path(service.audio_dir) / 'shared.mp3'
    def provider_response(*args, **kwargs):
        target.write_bytes(b'existing successful material')
        return response(frames=[{'code': 0,
            'data': base64.b64encode(b'new audio').decode()}])
    post.side_effect = provider_response
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech_local('安全测试',
                                             output_path=str(target))
    assert error.value.error_code == 'TTS_LOCAL_IO_ERROR'
    assert target.read_bytes() == b'existing successful material'


def test_cleanup_failure_does_not_replace_primary_error(synthesis, monkeypatch):
    service, post = synthesis
    post.return_value = response(frames=[{'code': 0,
        'data': base64.b64encode(b'audio').decode()}])
    monkeypatch.setattr(service_module.os, 'fsync',
                        Mock(side_effect=PermissionError('private write')))
    with monkeypatch.context() as cleanup:
        cleanup.setattr(Path, 'unlink',
                        Mock(side_effect=PermissionError('private cleanup')))
        with pytest.raises(RuntimeError) as error:
            service.convert_text_to_speech('安全测试')
    assert error.value.error_code == 'TTS_LOCAL_IO_ERROR'
    assert error.value.error_details.attempts == 1
    assert 'private' not in str(error.value)


def test_mock_false_is_local_failure_without_provider_attempt(synthesis,
                                                             monkeypatch):
    service, post = synthesis
    monkeypatch.setattr(service_module, 'MOCK_MODE', True)
    monkeypatch.setattr(TTSClient, '_create_mock_audio_file',
                        Mock(return_value=False))
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert error.value.error_code == 'TTS_LOCAL_IO_ERROR'
    assert error.value.error_details.attempts == 0
    post.assert_not_called()


def test_safe_unknown_message_is_bounded_and_query_is_removed(synthesis):
    service, post = synthesis
    payload = {'error': {'code': 'UNKNOWN_CODE', 'message':
        '服务暂时不可用 https://provider.test/error?token=private ' + '错误' * 200}}
    post.return_value = response(400, payload=payload)
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    # token 键是可疑凭据，整体原文丢弃，仍保留受限业务码。
    assert error.value.error_details.provider_message is None
    assert error.value.error_details.provider_code == 'UNKNOWN_CODE'
    payload['error']['message'] = '未知业务原因。' * 80
    with pytest.raises(RuntimeError) as error:
        service.convert_text_to_speech('安全测试')
    assert len(error.value.error_details.provider_message) == 240


def test_provider_message_removes_unicode_control_characters():
    from app.services.tts_errors import safe_provider_message
    assert safe_provider_message('服务\u202e返回\u200b错误') == '服务返回错误'


@pytest.mark.parametrize('message', [
    'permission denied /private.mp3',
    'permission denied temp\\private.mp3',
    'permission denied api_\u200bkey=private',
])
def test_paths_and_obfuscated_credential_names_are_not_public(message):
    from app.services.tts_errors import safe_provider_message
    assert safe_provider_message(message) is None


@pytest.mark.parametrize('message', [
    'permission denied; {"api_key": "invalid-fixture"}',
    'permission denied; {"token": "invalid-fixture"}',
    "permission denied; {'secret': 'invalid-fixture'}",
    'permission denied; {"text": "private fixture"}',
    "permission denied; {'input': 'private fixture'}",
    'permission denied; {"prompt": "private fixture"}',
    "permission denied; {'headers': 'private fixture'}",
    'permission denied: "/private/audio.mp3"',
    "permission denied: '/private/audio.mp3'",
])
def test_quoted_credentials_and_paths_are_not_public(message):
    from app.services.tts_errors import safe_provider_message
    assert safe_provider_message(message) is None


def test_control_character_removal_cannot_restore_known_credentials():
    from app.services.tts_errors import safe_provider_message
    credential = 'invalid-' + 'fixture-credential'
    message = 'insufficient balance invalid-\u200bfixture-credential'
    cleaned = safe_provider_message(message, (credential,))
    assert cleaned is None or credential not in cleaned


@pytest.fixture
def waveform_queue(monkeypatch):
    import asyncio
    from app.services import queue_manager as queue_module
    from app.services import waveform_service as waveform_module
    from app.services.storage_service import StorageService

    queue = queue_module.QueueManager()
    monkeypatch.setattr(queue_module, 'queue_manager', queue)
    storage = service_module.storage_service
    monkeypatch.setattr(storage, 'upload_audio_file',
                        StorageService.upload_audio_file.__get__(storage))
    monkeypatch.setattr(storage, 'upload_file', AsyncMock(return_value={
        'success': True, 'file_url': '/api/storage/files/audio/test.mp3',
        'file_path': 'audio/test.mp3',
    }))
    loops = []
    release, completed = asyncio.Event(), asyncio.Event()
    async def generate(*args):
        loops.append(asyncio.get_running_loop())
        await release.wait()
        completed.set()
        return {'status': 'ready'}
    monkeypatch.setattr(waveform_module.waveform_service, 'generate', generate)
    return queue, loops, release, completed


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint', ['convert', 'convert-batch',
                                     'ai-audio-synthesize'])
async def test_tts_storage_keeps_shared_waveform_queue_on_request_loop(
    synthesis, waveform_queue, monkeypatch, endpoint,
):
    import asyncio
    import httpx
    from fastapi import FastAPI
    from app.routers import tts_router

    service, post = synthesis
    queue, loops, release, completed = waveform_queue
    post.return_value = response(frames=[{
        'code': 0, 'data': base64.b64encode(b'audio').decode(),
    }])
    monkeypatch.setattr(tts_router, 'tts_service', service)
    monkeypatch.setattr(tts_router.batch_tts_service, 'tts_service', service)
    app = FastAPI()
    app.include_router(tts_router.router, prefix='/api')
    payload = {'text': '测试语音', 'voice_type': 'voice',
               'is_cloned_voice': False}
    if endpoint == 'convert-batch':
        payload = {'segments': [{'segment_id': 'one', 'text': '测试语音'}]}
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url='http://local.test',
        ) as api:
            result = await api.post('/api/tts/' + endpoint, json=payload)
        assert result.json()['success'] is True
        assert len(queue._tasks) == 1
        release.set()
        await asyncio.wait_for(completed.wait(), timeout=1)
        assert loops == [asyncio.get_running_loop()]
        assert all(task.status.value == 'completed'
                   for task in queue._tasks.values())
    finally:
        release.set()


@pytest.mark.asyncio
async def test_sync_tts_call_on_storage_loop_never_waits_for_itself(
    synthesis, waveform_queue, monkeypatch,
):
    import asyncio
    service, post = synthesis
    post.return_value = response(frames=[{
        'code': 0, 'data': base64.b64encode(b'audio').decode(),
    }])
    schedule = Mock(side_effect=AssertionError('would deadlock'))
    monkeypatch.setattr(asyncio, 'run_coroutine_threadsafe', schedule)
    result = service.convert_text_to_speech(
        '测试语音', storage_loop=asyncio.get_running_loop(),
    )
    assert result['storage_upload'] is False
    assert Path(result['file_path']).read_bytes() == b'audio'
    schedule.assert_not_called()


def test_sync_tts_storage_does_not_enqueue_on_a_temporary_loop(
    synthesis, waveform_queue,
):
    service, post = synthesis
    post.return_value = response(frames=[{
        'code': 0, 'data': base64.b64encode(b'audio').decode(),
    }])
    result = service.convert_text_to_speech('测试语音')
    queue, loops, _, _ = waveform_queue
    assert result['storage_upload'] is True
    assert result['audio_url'] == '/api/storage/files/audio/test.mp3'
    assert not queue._tasks
    assert loops == []
