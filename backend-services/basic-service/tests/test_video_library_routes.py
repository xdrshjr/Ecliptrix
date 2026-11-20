"""Public video materialization and legacy cache route regressions."""
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.db_models import Base
from app.models.video_models import VideoInfo, VideoSearchResponse
from app.routers import material_router
from app.services import video_library_service as library
from app.services import video_library_transfer as transfer
from app.services.material_download_service import MaterialDownloadService
from app.services.skillrouter.config import RouterSnapshot
from app.services.skillrouter.errors import RouterError


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(material_router.router, prefix='/api')
    return TestClient(app)


def selected_service(monkeypatch, **kwargs):
    service = SimpleNamespace(materialize=AsyncMock(**kwargs))
    monkeypatch.setattr(library, 'get_video_library_service', lambda: service)
    return service


def test_materialize_route_preserves_stable_identity_and_local_receipt(client, monkeypatch):
    receipt = {'success': True, 'material_id': 'pexels-123', 'source': 'pexels',
               'source_id': '123', 'size': 4096, 'width': 64, 'height': 64,
               'duration': 1., 'format': 'mp4', 'download_mode': 'router',
               'local_url': '/api/storage/files/cached_materials/pexels/123.mp4',
               'storage_key': 'cached_materials/pexels/123.mp4'}
    service = selected_service(monkeypatch, return_value=receipt)
    response = client.post('/api/material/materialize-video', json={
        'material_id': 'pexels-123', 'candidate_ref': 'trusted-reference'})
    assert response.status_code == 200
    assert response.json() == receipt
    service.materialize.assert_awaited_once_with('pexels-123', 'trusted-reference')


@pytest.mark.parametrize('payload', [
    {'material_id': 'pexels-123', 'url': 'https://example.invalid/forged.mp4'},
    {'material_id': 'pexels-123', 'source': 'pexels'},
    {'material_id': 'pexels-123', 'source_id': '123'},
    {'material_id': 'pexels-0'}, {'material_id': 'url-123'},
    {'material_id': 'pexels-../../private'},
])
def test_materialize_route_rejects_client_urls_sources_and_invalid_ids(client, monkeypatch, payload):
    service = selected_service(monkeypatch)
    assert client.post('/api/material/materialize-video', json=payload).status_code == 422
    service.materialize.assert_not_awaited()


@pytest.mark.parametrize('code,status', [
    ('downloads_disabled', 403), ('video_configuration_changed', 409),
    ('video_ingest_outcome_unknown', 409), ('video_too_large', 413),
])
def test_materialize_route_preserves_public_error_contract(client, monkeypatch, code, status):
    selected_service(monkeypatch, side_effect=library.VideoLibraryError(code, status, 'Safe diagnostic.'))
    response = client.post('/api/material/materialize-video', json={'material_id': 'pexels-123'})
    assert response.status_code == status
    assert response.json() == {
        'success': False, 'error_code': code, 'message': 'Safe diagnostic.',
        'retryable': False,
        'next_step': 'Resolve the reported issue or search again before explicitly retrying materialize_video.',
    }


def test_materialize_route_preserves_backoff_and_sanitizes_gateway_message(client, monkeypatch):
    selected_service(monkeypatch, side_effect=RouterError(
        'upstream_rate_limited', 429, 'Do not expose reflected ar-private-key.', retry_after=75))
    response = client.post('/api/material/materialize-video', json={'material_id': 'pexels-123'})
    assert response.status_code == 429
    assert response.headers['retry-after'] == '75'
    assert response.json()['retry_after_seconds'] == 75
    assert response.json()['retryable'] is True
    assert 'ar-private-key' not in response.text


def cache_service(monkeypatch, tmp_path, *, content=b'corrupt', outside=False):
    service = MaterialDownloadService()
    service.cache_dir = tmp_path / 'cached_materials'
    directory = tmp_path / 'outside' if outside else service.cache_dir / 'pexels'
    directory.mkdir(parents=True)
    path = directory / '123.mp4'
    if content is not None:
        path.write_bytes(content)
    row = SimpleNamespace(id='cache-uuid', source='pexels', source_id='123',
        source_url='https://videos.pexels.com/video-files/123/clip.mp4',
        status='ready', local_path=str(path), error_message=None,
        file_size=9000, width=1920, height=1080, duration=99.)
    service.lookup_async = AsyncMock(return_value=row)
    service.enqueue = AsyncMock(return_value={
        'material_id': 'cache-uuid', 'status': 'ready', 'local_path': str(path)})
    monkeypatch.setattr(material_router, 'get_material_download_service', lambda: service)
    return service, row


@pytest.mark.parametrize('action', ['lookup', 'ingest'])
@pytest.mark.parametrize('content,outside', [(b'', False), (b'corrupt', False),
                                            (None, False), (b'outside', True)])
def test_legacy_routes_withhold_invalid_ready_video_files(client, monkeypatch, tmp_path,
                                                         action, content, outside):
    service, row = cache_service(monkeypatch, tmp_path, content=content, outside=outside)
    if action == 'lookup':
        response = client.get('/api/material/lookup', params={'source': 'pexels', 'source_id': '123'})
        body = response.json()
    else:
        response = client.post('/api/material/ingest', json={'items': [{
            'source': 'pexels', 'source_id': '123', 'url': row.source_url}]})
        body = response.json()['items'][0]
    assert response.status_code == 200
    assert body['status'] == 'failed'
    assert body['local_url'] is None and body['local_path'] is None
    assert body['error_message'] == 'cached_video_invalid'
    service.lookup_async.assert_awaited_once()


@pytest.mark.parametrize('action', ['lookup', 'ingest'])
def test_legacy_routes_return_probed_metadata_instead_of_stale_database_fields(
        client, monkeypatch, tmp_path, action):
    content = b'\x00\x00\x00\x18ftypisomfixture'
    _, row = cache_service(monkeypatch, tmp_path, content=content)
    probe = AsyncMock(return_value={'type': 'video', 'format': 'mp4',
                                   'width': 64, 'height': 32, 'duration': 2.5})
    monkeypatch.setattr(transfer, 'probe_async', probe)
    if action == 'lookup':
        response = client.get('/api/material/lookup', params={'source': 'pexels', 'source_id': '123'})
        body = response.json()
    else:
        response = client.post('/api/material/ingest', json={'items': [{
            'source': 'pexels', 'source_id': '123', 'url': row.source_url}]})
        body = response.json()['items'][0]
    assert response.status_code == 200
    assert body['status'] == 'ready'
    assert body['local_url'] == '/api/storage/files/cached_materials/pexels/123.mp4'
    assert (body['file_size'], body['width'], body['height'], body['duration']) == (
        len(content), 64, 32, 2.5)
    probe.assert_awaited_once()


def test_search_route_exposes_configuration_conflict(monkeypatch):
    from app.routers import video_router
    app = FastAPI()
    app.include_router(video_router.router, prefix='/api')
    monkeypatch.setattr(video_router, 'require_configured', lambda _: None)
    def changed(*args, **kwargs):
        raise library.VideoLibraryError('video_configuration_changed', 409,
                                        'Video library configuration changed; search again.')
    monkeypatch.setattr(video_router.video_search_service, 'search_videos', changed)
    response = TestClient(app).post('/api/video/search', json={'query': 'fixture'})
    assert response.status_code == 409
    assert response.json()['error_code'] == 'video_configuration_changed'
    assert 'search again' in response.json()['message']


@pytest_asyncio.fixture
async def routed_library(tmp_path, monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    cache = MaterialDownloadService()
    cache.cache_dir = tmp_path / 'cached_materials'
    cache._session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async def dispatch(coro):
        return await coro
    monkeypatch.setattr(cache, '_dispatch', dispatch)
    config = library.VideoConfig(True, 'first-revision', RouterSnapshot(
        'router', 'router', 'https://gateway.invalid', api_key='ar-invalid-fixture',
        credential_revision='old-account', revision='first'))
    current = [config]
    monkeypatch.setattr(library, 'capture_config', lambda: current[0])
    monkeypatch.setattr(library, 'research_settings', lambda: {'downloads_enabled': True})
    yield library.VideoLibraryService(cache), current
    await engine.dispose()


@pytest.mark.asyncio
async def test_definitive_ingest_rejection_allows_corrected_credentials(routed_library, monkeypatch):
    service, current = routed_library
    def register():
        result = VideoSearchResponse(success=True, message='found', videos=[VideoInfo(
            id=123, title='API video', author='Creator', duration=1,
            video_url='https://videos.pexels.com/video-files/123/clip.mp4',
            thumbnail='', width=64, height=64)])
        service.register_results(result, current[0])
        return result.videos[0].candidate_ref
    post = AsyncMock(side_effect=[
        RouterError('authentication_error', 401, 'Invalid fixture key.', details={'request_sent': False}),
        {'asset': {'id': 'asset-1', 'url': '/api/v1/media/assets/asset-1'}},
    ])
    monkeypatch.setattr(library.AsyncRouterClient, 'post', post)
    with pytest.raises(RouterError):
        await service.materialize('pexels-123', register())
    assert service._read_receipt('123')['state'] == 'rejected'
    current[0] = replace(current[0], revision='corrected-revision', router=replace(
        current[0].router, api_key='ar-valid-fixture', credential_revision='new-account'))
    metadata = {'size': 13, 'format': 'mp4', 'width': 64, 'height': 64, 'duration': 1.}
    async def asset_download(snapshot, url, destination, **kwargs):
        assert snapshot.credential_revision == 'new-account'
        destination.write_bytes(b'fixture-video')
        return 13
    monkeypatch.setattr(library, 'download_asset', asset_download)
    monkeypatch.setattr(library, 'validate_video', AsyncMock(return_value=metadata))
    result = await service.materialize('pexels-123', register())
    assert result['success'] is True
    assert post.await_count == 2
    assert service._read_receipt('123')['credential_revision'] == 'new-account'
