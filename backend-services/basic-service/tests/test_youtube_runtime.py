"""方案 A 的更新、隔离、合并、取消及预览会话回归；不依赖 YouTube。"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import subprocess
import threading
import time
import zipfile

import httpx
import pytest
import yt_dlp

from app.models.youtube_models import YoutubeVideoDownloadRequest
from app.services.youtube_runtime import YoutubeRuntime, RuntimeLease, YoutubeOperationError, Version
from app.services.youtube_service import YouTubeService, YoutubePreviewError
from app.services.youtube_worker import dispatch, format_selector, media_probe, normalize_media


def wheel(package, version, requirements=""):
    name = package.replace('-', '_')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as archive:
        archive.writestr(f'{name}/__init__.py', 'from . import version' if name == 'yt_dlp' else '')
        archive.writestr(f'{name}/version.py', f'__version__ = "{version}"')
        if name == 'yt_dlp_ejs':
            archive.writestr(f'{name}/yt/__init__.py', '')
            archive.writestr(f'{name}/yt/solver/__init__.py', '''def lib(): return 'var lib = {};'
def core(): return 'var jsc = d => { const r = {}; Function("_result", d.preprocessed_player)(r); return {responses: d.requests.map(q => ({data: Object.fromEntries(q.challenges.map(v => [v, r[q.type](v)]))}))}; };'
''')
        archive.writestr(f'{name}-{version}.dist-info/METADATA',
                         f'Name: {package}\nVersion: {version}\n{requirements}')
    return buf.getvalue()


def official_source(monkeypatch, *, broken=False, python='>=3.11', offline=False):
    real_client = httpx.Client
    packages = {
        'yt-dlp': ('2099.1.1', wheel('yt-dlp', '2099.1.1', 'Requires-Dist: yt-dlp-ejs==9.0.0; extra == "default"\n')),
        'yt-dlp-ejs': ('9.0.0', wheel('yt-dlp-ejs', '9.0.0')),
    }
    calls = []
    def serve(request):
        calls.append(request.url.path)
        if offline:
            raise httpx.ConnectError('secret-proxy-password', request=request)
        if request.url.host == 'pypi.org':
            package = request.url.path.split('/')[2]
            version, data = packages[package]
            return httpx.Response(200, json={'info': {'version': version}, 'urls': [{
                'filename': f'{package.replace("-", "_")}-{version}-py3-none-any.whl',
                'url': f'https://files.pythonhosted.org/{package}.whl', 'requires_python': python,
                'digests': {'sha256': '0' * 64 if broken else hashlib.sha256(data).hexdigest()},
            }]})
        return httpx.Response(200, content=packages[request.url.path[1:-4]][1])
    monkeypatch.setattr('app.services.youtube_runtime.httpx.Client',
                        lambda **kwargs: real_client(transport=httpx.MockTransport(serve)))
    return calls


def test_update_activation_worker_lease_and_restart(tmp_path, monkeypatch):
    official_source(monkeypatch)
    runtime = YoutubeRuntime(tmp_path)
    before = runtime.status()['active_version']
    with runtime.lease() as old:
        result = runtime.check(True)
        assert result['status'] == 'ready', result
        assert result['last_result'] == 'activated'
        assert runtime.run('selftest')['version'] == '2099.1.1'
        assert Version(runtime.run('selftest', lease=old)['version']) == Version(before)
        assert runtime._leases[old] == 1
    restarted = YoutubeRuntime(tmp_path)
    assert restarted.status()['active_version'] == '2099.1.1'
    assert restarted.status()['last_updated_at'] == result['last_updated_at']
    assert restarted.check(True)['last_result'] == 'no_update'
    assert not list(tmp_path.glob('staging-*'))


@pytest.mark.parametrize('mode', ['offline', 'broken', 'incompatible'])
def test_failed_update_preserves_baseline_without_secrets(tmp_path, monkeypatch, mode):
    official_source(monkeypatch, offline=mode == 'offline', broken=mode == 'broken',
                    python='>=999' if mode == 'incompatible' else '>=3.11')
    runtime = YoutubeRuntime(tmp_path)
    before = runtime.status()['active_version']
    result = runtime.check(True)
    assert result['status'] == 'error'
    assert result['active_version'] == before
    assert 'secret-proxy-password' not in json.dumps(result)
    assert Version(runtime.run('selftest')['version']) == Version(before)
    assert not list(tmp_path.glob('staging-*'))
    assert YoutubeRuntime(tmp_path).status()['active_version'] == before


def test_activation_failure_keeps_previous_version(tmp_path, monkeypatch):
    official_source(monkeypatch)
    runtime = YoutubeRuntime(tmp_path)
    before = runtime.status()['active_version']
    persist = runtime._persist
    def reject_activation():
        if runtime._state['active_version'] != before:
            raise OSError('disk full')
        persist()
    monkeypatch.setattr(runtime, '_persist', reject_activation)
    result = runtime.check(True)
    assert result['active_version'] == before
    assert result['last_result'] == 'activation_failed'
    assert Version(runtime.run('selftest')['version']) == Version(before)


def test_concurrent_check_is_deduplicated(tmp_path, monkeypatch):
    official_source(monkeypatch)
    runtime = YoutubeRuntime(tmp_path)
    entered, release = threading.Event(), threading.Event()
    metadata = runtime._metadata
    def blocked(*args):
        entered.set()
        assert release.wait(10)
        return metadata(*args)
    monkeypatch.setattr(runtime, '_metadata', blocked)
    with ThreadPoolExecutor(1) as executor:
        future = executor.submit(runtime.check, True)
        assert entered.wait(5)
        assert runtime.check(True)['status'] == 'checking'
        release.set()
        assert future.result(20)['last_result'] == 'activated'


def test_interrupted_install_restores_last_usable_worker(tmp_path):
    runtime = YoutubeRuntime(tmp_path)
    runtime._state.update(status='installing', last_checked_at='2026-11-20T00:00:00+00:00')
    runtime._persist()
    restored = YoutubeRuntime(tmp_path)
    assert restored.status()['status'] == 'error'
    assert restored.status()['last_result'] == 'interrupted'
    assert Version(restored.run('selftest')['version']) == Version(runtime.status()['active_version'])


def test_worker_cancellation_reaps_process_tree(tmp_path):
    package = tmp_path / 'yt_dlp'
    package.mkdir()
    (package / '__init__.py').write_text('''import subprocess, sys, time
class YoutubeDL:
    def __init__(self, opts): self.opts = opts
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def extract_info(self, url, download=False):
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])
        from pathlib import Path
        Path(self.opts['pid_file']).write_text(str(child.pid))
        time.sleep(120)
''', encoding='utf-8')
    runtime = YoutubeRuntime(tmp_path / 'runtime')
    cancel = threading.Event()
    pid_file = tmp_path / 'child.pid'
    with ThreadPoolExecutor(1) as executor:
        future = executor.submit(runtime.run, 'extract', {'url': 'unused', 'options': {'pid_file': str(pid_file)}},
                                 lease=RuntimeLease('test', str(tmp_path)), cancel=cancel)
        deadline = time.monotonic() + 10
        while not pid_file.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        try:
            assert pid_file.exists()
        finally:
            cancel.set()
        with pytest.raises(YoutubeOperationError, match='CANCELLED'):
            future.result(15)
    import os
    pid = int(pid_file.read_text())
    if os.name == 'nt':
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if handle:
            code = ctypes.c_ulong()
            ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            ctypes.windll.kernel32.CloseHandle(handle)
            assert code.value != 259
    else:
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)


def test_format_selection_accepts_separate_tracks_and_height():
    formats = [dict(format_id='v', ext='mp4', vcodec='avc1', acodec='none', height=360, url='https://g/v'),
               dict(format_id='a', ext='m4a', vcodec='none', acodec='mp4a', url='https://g/a')]
    with yt_dlp.YoutubeDL({'quiet': True}) as ydl:
        for quality in ['best', 'worst', '720p']:
            result = list(ydl.build_format_selector(format_selector(quality))({'formats': formats, 'incomplete_formats': False}))
            assert len(result) == 1
            assert len(result[0]['requested_formats']) == 2


@pytest.fixture
def small_media(tmp_path):
    def ffmpeg(*args):
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *args], check=True, capture_output=True, timeout=20)
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10', '-t', '1', '-c:v', 'libx264', str(tmp_path / 'v.mp4'))
    ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:a', 'aac', str(tmp_path / 'a.m4a'))
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(tmp_path), **kwargs)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield tmp_path, f'http://127.0.0.1:{server.server_port}'
    server.shutdown()
    thread.join(5)


def test_real_separate_download_merge_exact_output_and_audio(small_media, monkeypatch):
    root, origin = small_media
    # 仅替换站点抽取器；真实 yt-dlp HTTP 下载、选择器、合并及 FFmpeg 校验。
    def extract(self, url, download=False, **kwargs):
        return self.process_ie_result(dict(id='test', title='test', duration=1, extractor='generic',
            webpage_url=origin, formats=[
                dict(format_id='v', ext='mp4', protocol='http', url=origin + '/v.mp4', height=64,
                     vcodec='avc1', acodec='none'),
                dict(format_id='a', ext='m4a', protocol='http', url=origin + '/a.m4a', vcodec='none', acodec='mp4a')]), download=download)
    monkeypatch.setattr(yt_dlp.YoutubeDL, 'extract_info', extract)
    for operation in ('preview', 'download'):
        output = root / operation
        data = dispatch(dict(operation=operation, url=origin, output_dir=str(output), options={}, request={'format_type': 'mp4'}))
        path = Path(data['file_path'])
        assert path == output / 'media.mp4'
        assert path.stat().st_size > 0
        probe = media_probe(path)
        assert {s['codec_type'] for s in probe['streams']} == {'video', 'audio'}
        assert {s['codec_name'] for s in probe['streams']} == {'h264', 'aac'}
        assert not list(output.glob('source.*'))


@pytest.mark.parametrize('container', ['mp4', 'webm', 'mkv'])
def test_container_crop_and_explicit_silent_source(small_media, container):
    root, _ = small_media
    final = root / ('cropped.' + container)
    result = normalize_media(root / 'v.mp4', final, expected_audio=False, start='0.2', duration='0.5')
    probe = media_probe(final)
    assert result['has_audio'] is False
    assert 0.3 <= float(probe['format']['duration']) <= 0.8
    assert all(s['codec_type'] != 'audio' for s in probe['streams'])
    with pytest.raises(ValueError, match='MERGE_FAILED'):
        normalize_media(root / 'v.mp4', root / 'invalid.mp4', expected_audio=True)


@pytest.mark.asyncio
async def test_preparation_deduplicates_retry_and_preserves_reason(tmp_path, monkeypatch):
    service = YouTubeService(str(tmp_path))
    calls = []
    def blocked(video_id, retry=False):
        calls.append(video_id)
        raise YoutubePreviewError('SIGN_IN_REQUIRED')
    monkeypatch.setattr(service, 'resolve_preview_stream', blocked)
    a = service.prepare_preview('abcdefghijk')
    b = service.prepare_preview('abcdefghijk')
    assert service._preview_sessions[a['session']]['job'] is service._preview_sessions[b['session']]['job']
    task = service._preview_sessions[a['session']]['job']['task']
    await task
    assert len(calls) == 1
    assert service.preview_status(a['session'])['code'] == 'SIGN_IN_REQUIRED'
    retry = service.prepare_preview('abcdefghijk', True)
    await service._preview_sessions[retry['session']]['job']['task']
    assert len(calls) == 2


@pytest.mark.parametrize('field,value', [('format_type', 'avi'), ('video_quality', '720];bad'), ('audio_quality', '-1k'), ('url', 'https://youtube.com.evil.test/v')])
def test_invalid_parameters_fail_before_worker(field, value):
    payload = dict(url='https://www.youtube.com/watch?v=abcdefghijk')
    payload[field] = value
    with pytest.raises(ValueError):
        YoutubeVideoDownloadRequest(**payload)


def test_fixed_youtube_target_does_not_depend_on_fake_ip_dns(monkeypatch):
    def no_dns(*args):
        raise AssertionError('规范化视频 ID 不应调用通用 DNS guard')
    monkeypatch.setattr('socket.getaddrinfo', no_dns)
    request = YoutubeVideoDownloadRequest(url='https://youtu.be/abcdefghijk?t=5')
    assert request.url == 'https://www.youtube.com/watch?v=abcdefghijk'
    for url in ['https://youtube.com/redirect?q=http://127.0.0.1', 'https://youtube.com:8000/watch?v=abcdefghijk',
                'https://youtube.com@localhost/watch?v=abcdefghijk', 'file:///etc/passwd']:
        with pytest.raises(ValueError):
            YoutubeVideoDownloadRequest(url=url)


def test_download_does_not_lose_classified_worker_error(tmp_path, monkeypatch):
    service = YouTubeService(str(tmp_path))
    def denied(*args, **kwargs):
        raise YoutubeOperationError('SIGN_IN_REQUIRED')
    monkeypatch.setattr(service.runtime, 'run', denied)
    result = service.download_video(YoutubeVideoDownloadRequest(url='https://youtu.be/abcdefghijk'))
    assert not result.success
    assert 'SIGN_IN_REQUIRED' in result.error
