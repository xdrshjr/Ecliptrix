"""Post-fix offline proof: real video search, cache, transfer, FFprobe and local export.

Vendor HTTP uses fixtures. General-web robots refusals remain expected policy.
This does not claim live-vendor, packaged-desktop or editor-timeline E2E coverage.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'backend-services/basic-service'))
sys.stdout.reconfigure(encoding='utf-8')

# Isolate imports from saved credentials, real databases and log files.
_SCRATCH = tempfile.TemporaryDirectory(prefix='pexels-repro-', dir=ROOT / '.agentmesh')
_FIXTURE_ENV = {name: value for name, value in os.environ.items()
    if name.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE',
                        'COMSPEC', 'TEMP', 'TMP', 'PATHEXT'}}
_FIXTURE_ENV.update(PYTHON_DOTENV_DISABLED='1', LLM_API_KEY='fixture-llm-key',
    LLM_API_URL='https://llm.invalid/v1', DATABASE_URL='sqlite+aiosqlite:///:memory:',
    STORAGE_ROOT=str(Path(_SCRATCH.name) / 'import-storage'))
logging.disable(logging.CRITICAL)
with patch.dict(os.environ, _FIXTURE_ENV, clear=True), \
        patch('logging.FileHandler', side_effect=lambda *args, **kwargs: logging.NullHandler()):
    import httpx
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.config import settings
    from app.database import _install_sqlite_pg_type_shims
    from app.models.agent_host_models import AgentHostError
    from app.models.db_models import Base, CachedMaterial
    from app.services.agent_host import egress
    from app.services.material_download_service import MaterialDownloadService
    from app.services.skillrouter import client as router_client, search_adapter
    from app.services.skillrouter.config import RouterSnapshot
    from app.services import video_library_service as library, video_library_transfer as transfer
    from app.services.video_search_service import VideoSearchService
    from app.services.web_research.safe_http_client import (
        FetchPolicy, HttpResult, RequestSpec, SafeHttpClient)

_install_sqlite_pg_type_shims()
VIDEO_URLS = [
    'https://videos.pexels.com/video-files/10814082/10814082-hd_720_1280_25fps.mp4',
    'https://videos.pexels.com/video-files/9137111/9137111-hd_720_1280_30fps.mp4',
]
GATEWAY = 'https://gateway.invalid'
DIRECT_SETTINGS = {'proxy_mode': 'direct', 'mode': 'direct', 'proxy_url': '',
    'respect_robots': True, 'egress_mode': 'balanced', 'concurrency': 3}


def config_for(mode):
    routed = mode == 'router'
    snapshot = RouterSnapshot(mode, mode, GATEWAY,
        api_key='ar-offline-fixture' if routed else '', revision=f'{mode}-snapshot',
        credential_revision='offline-gateway-account' if routed else '')
    return library.VideoConfig(routed, f'{mode}-fixture-revision', snapshot,
                               '' if routed else 'fixture-key')


def gateway_response(request, calls, video_bytes=b''):
    assert str(request.url).startswith(GATEWAY + '/'), 'Unexpected gateway origin'
    assert request.headers.get('x-api-key') == 'ar-offline-fixture'
    path = request.url.path
    calls.append({'method': request.method, 'path': path,
                  'gateway_authentication_present': True})
    if request.method == 'POST' and path == '/api/v1/media/search/videos':
        return httpx.Response(200, json={'data': {'items': [
            {'id': '10814082', 'downloadUrl': VIDEO_URLS[0], 'width': 720,
             'height': 1280, 'durationMs': 12000, 'author': {'name': 'Offline creator'}}],
            'total': 1, 'hasMore': False}})
    if request.method == 'POST' and path == '/api/v1/media/ingest':
        body = json.loads(request.content)
        assert body['sourceUrl'] == VIDEO_URLS[0]
        assert body['attribution']['text'] == 'Video by Offline creator'
        return httpx.Response(201, json={'data': {'asset': {
            'id': 'offline-asset-1', 'url': '/api/v1/media/assets/offline-asset-1'}}})
    if request.method == 'GET' and path == '/api/v1/media/assets/offline-asset-1':
        assert video_bytes
        return httpx.Response(200, content=video_bytes, headers={'content-type': 'video/mp4'})
    raise AssertionError(f'Unexpected gateway request: {request.method} {path}')


def search_with_fixtures(mode, svc, calls):
    """Real search wrapper/adapter registers trusted candidates through fixture HTTP."""
    config = config_for(mode)

    class ApiReply:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {'videos': [{'id': 10814082, 'duration': 12, 'width': 720,
                'height': 1280, 'user': {'name': 'Offline creator'}, 'video_files': [
                    {'width': 720, 'height': 1280, 'link': VIDEO_URLS[0]}]}]}

    def api_get(url, **kwargs):
        assert url == 'https://api.pexels.com/videos/search'
        assert kwargs['headers']['Authorization'] == 'fixture-key'
        calls.append({'method': 'GET', 'url': url, 'pexels_authentication_present': True})
        return ApiReply()

    def no_manual_key(*args):
        raise AssertionError('Routed video search must not read a manual Pexels key')

    def sync_client(timeout, **kwargs):
        return httpx.Client(transport=httpx.MockTransport(
            lambda request: gateway_response(request, calls)), timeout=timeout)

    with patch.object(library, 'capture_config', return_value=config), \
            patch.object(library, 'get_video_library_service', return_value=svc), \
            patch('app.services.video_search_service.is_routed', return_value=config.routed), \
            patch.object(VideoSearchService, 'api_keys', ['fixture-key'] if mode == 'manual' else []), \
            patch('app.services.video_search_service.requests.get', side_effect=api_get), \
            patch.object(library.integration_credentials, 'values', side_effect=no_manual_key), \
            patch.object(search_adapter, 'require_ready', return_value=config.router), \
            patch.object(search_adapter, 'blocking_limits', return_value={'perPage': {'max': 30}}), \
            patch.object(router_client, '_sync_client_factory', side_effect=sync_client):
        result = VideoSearchService().search_videos('cockapoo puppy cute', 1, 'portrait')
    assert result.success and len(result.videos) == 1
    video = result.videos[0]
    assert video.video_url == VIDEO_URLS[0] and video.candidate_ref
    assert video.download_mode == mode and video.config_revision == config.revision
    return result


def observe_searches():
    """Preserve independently reproducible observations for both search APIs."""
    observations = []
    for mode in ('manual', 'router'):
        calls = []
        result = search_with_fixtures(mode, library.VideoLibraryService(), calls)
        observations.append({'case': f'search-{mode}', 'requests': calls,
            'video_url': result.videos[0].video_url, 'trusted_candidate_issued': True})
    return observations


async def observe_downloads():
    """The general webpage tool must still reject cached robots HTTP 403."""
    observations = []
    for mode in ('manual', 'router'):
        requests, commits = [], []

        async def transport(policy, request):
            requests.append(request.url)
            status = 403 if request.url.endswith('/robots.txt') else 200
            return HttpResult(request.url, status, {}, b'fixture-media-available')

        client = SafeHttpClient(transport=transport, proxy_settings=DIRECT_SETTINGS)

        async def commit(*args, **kwargs):
            commits.append(True)
            raise AssertionError('A rejected web fetch must not commit a material')

        outcomes = []
        with patch.object(egress, '_settings', return_value={'enabled': True,
                'egress_enabled': True, 'respect_robots': True}), \
                patch('app.services.system_settings_service.research_settings',
                      return_value={'downloads_enabled': True}), \
                patch.object(egress, 'get_safe_http_client', return_value=client), \
                patch.object(egress.audit, 'record_egress'), \
                patch.object(egress, '_commit_download', side_effect=commit), \
                patch('app.services.skillrouter.config.is_routed',
                      return_value=(mode == 'router')) as route_gate:
            egress._rate_hits.clear()
            for url in VIDEO_URLS:
                try:
                    await egress.download(url, kind='media', name='Offline sample')
                    raise AssertionError('The web tool must preserve robots refusals')
                except AgentHostError as error:
                    assert error.error_code == 'robots_disallowed'
                    assert error.details['upstream_status'] == 403
                    outcomes.append({'error_code': error.error_code, **error.details})
            assert route_gate.call_count == 0
        assert requests == ['https://videos.pexels.com/robots.txt'] and not commits
        assert [item['robots_cache_hit'] for item in outcomes] == [False, True]
        observations.append({'case': f'general-web-policy-{mode}',
            'expected_preserved_policy': True, 'errors': outcomes,
            'requests': list(requests), 'video_byte_requests': 0, 'commits': 0})
        # Diagnostic control only; production uses a trusted candidate identity.
        control = await client.fetch(FetchPolicy(respect_robots=False, document=False),
                                     RequestSpec(VIDEO_URLS[0]))
        assert control.status == 200
        observations[-1]['fixture_file_control_http_status'] = control.status
    return observations


def run_ffmpeg(arguments):
    completed = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', *arguments],
        capture_output=True, timeout=15,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    assert completed.returncode == 0, completed.stderr.decode(errors='replace')


async def observe_materialization(root, video_bytes):
    observations = []
    for mode in ('manual', 'router'):
        config = config_for(mode)
        storage_root = root / mode / 'storage'
        with patch.object(settings.storage, 'root', str(storage_root)):
            cache = MaterialDownloadService()
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        # The real dispatcher and this isolated engine share this event loop.
        cache._loop = asyncio.get_running_loop()
        cache._engine = engine
        cache._session_factory = async_sessionmaker(engine, expire_on_commit=False)
        svc = library.VideoLibraryService(cache)
        search_calls, cdn_calls, gateway_calls = [], [], []

        async def cdn_request(client, policy, request):
            assert mode == 'manual', 'Routed downloads must not contact the Pexels CDN'
            assert request.url == VIDEO_URLS[0]
            assert policy.document is False and request.headers is None
            cdn_calls.append({'url': request.url, 'authorization_present': False})
            return HttpResult(request.url, 200,
                {'content-length': str(len(video_bytes)), 'content-type': 'video/mp4'}, video_bytes)

        def async_gateway_client(timeout, **kwargs):
            return httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: gateway_response(request, gateway_calls, video_bytes)), timeout=timeout)

        def no_manual_key(*args):
            raise AssertionError('Materialization must use its captured configuration')

        try:
            result = search_with_fixtures(mode, svc, search_calls)
            ref = result.videos[0].candidate_ref
            with patch.object(library, 'capture_config', return_value=config), \
                    patch.object(library, 'research_settings', return_value={'downloads_enabled': True}), \
                    patch.object(library.integration_credentials, 'values', side_effect=no_manual_key), \
                    patch.object(transfer, 'default_proxy_settings', return_value=DIRECT_SETTINGS.copy()), \
                    patch.object(SafeHttpClient, '_request', new=cdn_request), \
                    patch.object(router_client, '_async_client_factory', side_effect=async_gateway_client):
                first = await svc.materialize('pexels-10814082', ref)
                renewed = search_with_fixtures(mode, svc, search_calls)
                assert renewed.videos[0].candidate_ref == ref
                second = await svc.materialize('pexels-10814082', ref)
            assert first == second and first['success']
            assert first['size'] == len(video_bytes) > 0
            assert first['width'] == 32 and first['height'] == 48 and first['duration'] == 0.5
            assert first['material_id'] == 'pexels-10814082' and first['download_mode'] == mode
            async with cache._session_factory() as session:
                row = (await session.execute(select(CachedMaterial))).scalar_one()
                assert row.status == 'ready' and row.file_size == len(video_bytes)
                assert Path(row.local_path).read_bytes() == video_bytes
            # Save/reload the local reference, then export through real FFmpeg.
            # This is a filesystem/codec smoke check, not editor project-store E2E.
            saved_path = root / mode / 'saved-material.json'
            saved_path.write_text(json.dumps(first), encoding='utf-8')
            restored = json.loads(saved_path.read_text(encoding='utf-8'))
            restored_path = storage_root / restored['storage_key']
            assert restored_path.resolve() == Path(row.local_path).resolve()
            assert restored['local_url'] == '/api/storage/files/' + restored['storage_key']
            exported = root / mode / 'local-export.mp4'
            run_ffmpeg(['-i', str(restored_path), '-map', '0:v:0', '-c:v', 'copy', '-an', str(exported)])
            export_metadata = await transfer.validate_video(exported)
            assert export_metadata['duration'] == first['duration']
            assert export_metadata['width'] == 32 and export_metadata['height'] == 48
            post_count = sum(call['method'] == 'POST' for call in gateway_calls)
            get_count = sum(call['method'] == 'GET' for call in gateway_calls)
            assert post_count == get_count == (1 if mode == 'router' else 0)
            assert len(cdn_calls) == (1 if mode == 'manual' else 0)
            receipt = svc._read_receipt('10814082') if mode == 'router' else None
            if receipt:
                assert receipt['state'] == 'asset'
                assert config.router.api_key not in json.dumps(receipt)
            observations.append({'case': f'provider-materialization-{mode}',
                'search_requests': search_calls, 'cdn_requests': cdn_calls,
                'gateway_requests': gateway_calls, 'receipt': first,
                'cache_status': row.status, 'cache_file_size': row.file_size,
                'renewed_candidate_ref_unchanged': True, 'second_download_reused_cache': True,
                'robots_requests': 0, 'paid_ingest_posts': post_count,
                'authenticated_asset_gets': get_count,
                'durable_asset_receipt_saved': bool(receipt),
                'local_reference_saved_and_reloaded': True,
                'real_ffmpeg_local_export': export_metadata})
        finally:
            await engine.dispose()
    return observations


async def main():
    root = Path(_SCRATCH.name)
    sample = root / 'sample.mp4'
    print('Running offline post-fix search, materialization and local-export proof...', flush=True)
    run_ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=32x48:r=10', '-t', '0.5',
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(sample)])
    video_bytes = sample.read_bytes()
    report = {'description': 'Post-fix offline verification; vendor HTTP uses fixtures.',
        'real_media_fixture': await transfer.validate_video(sample),
        'observations': observe_searches() + await observe_downloads()
                        + await observe_materialization(root, video_bytes),
        'limitations': [
            'No live vendor request, saved user credential, or application database was used.',
            'General-web robots refusals are expected preserved policy.',
            'Saved local receipt and FFmpeg copy export are filesystem/codec smoke checks.',
            'Packaged desktop UI, editor project save/reopen and full timeline export were not exercised.',
            'Temporary media and the in-memory cache database are removed after the run.']}
    output = Path(__file__).with_name('backend-results.json')
    serialized = json.dumps(report, ensure_ascii=False, indent=2)
    assert 'ar-offline-fixture' not in serialized and 'fixture-key' not in serialized
    output.write_text(serialized + '\n', encoding='utf-8')
    print(serialized)


if __name__ == '__main__':
    try:
        with patch.dict(os.environ, _FIXTURE_ENV, clear=True):
            asyncio.run(main())
    finally:
        _SCRATCH.cleanup()
