"""Video-library routing and durable ingest recovery, with no real credentials."""
import asyncio
from dataclasses import replace
import json
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.db_models import Base, CachedMaterial
from app.models.video_models import VideoInfo, VideoSearchResponse
from app.services.material_download_service import MaterialDownloadService
from app.services.skillrouter.config import RouterSnapshot
from app.services.skillrouter.errors import RouterError
from app.services import video_library_service as library


@pytest_asyncio.fixture
async def setup_library(tmp_path, monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    cache = MaterialDownloadService()
    cache.cache_dir = tmp_path / 'cached_materials'
    cache._session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def dispatch(coro):
        return await coro

    monkeypatch.setattr(cache, '_dispatch', dispatch)
    config = library.VideoConfig(False, 'manual-revision',
        RouterSnapshot('manual', 'manual', 'https://gateway.invalid', revision='r'), 'fixture-key')
    monkeypatch.setattr(library, 'capture_config', lambda: config)
    monkeypatch.setattr(library, 'research_settings', lambda: {'downloads_enabled': True})
    svc = library.VideoLibraryService(cache)
    yield svc, config
    await engine.dispose()


def candidate(svc, config, identifier=123):
    result = VideoSearchResponse(success=True, message='found', videos=[VideoInfo(
        id=identifier, title='API video', author='Creator', duration=1,
        video_url=f'https://videos.pexels.com/video-files/{identifier}/clip.mp4',
        thumbnail='', width=64, height=64)])
    svc.register_results(result, config)
    return result.videos[0].candidate_ref


def fake_transfer(monkeypatch):
    metadata = dict(size=len(b'fixture-video'), width=64, height=64, duration=1., format='mp4')

    async def download(url, path, **kwargs):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture-video')
        return metadata

    transfer = AsyncMock(side_effect=download)
    monkeypatch.setattr(library, 'download_video', transfer)
    monkeypatch.setattr(library, 'validate_video', AsyncMock(return_value=metadata))
    return transfer


@pytest.mark.asyncio
async def test_manual_materializes_once_and_preserves_identity(setup_library, monkeypatch):
    svc, config = setup_library
    ref = candidate(svc, config)
    transfer = fake_transfer(monkeypatch)
    first, second = await asyncio.gather(svc.materialize('pexels-123', ref),
                                         svc.materialize('pexels-123', ref))
    assert first == second
    assert first['material_id'] == 'pexels-123'
    assert first['size'] > 0 and first['storage_key'] == 'cached_materials/pexels/123.mp4'
    assert transfer.await_count == 1
    assert await svc.materialize('pexels-123', ref) == first
    assert transfer.await_count == 1


@pytest.mark.asyncio
async def test_config_change_rejects_candidate(setup_library, monkeypatch):
    svc, config = setup_library
    ref = candidate(svc, config)
    monkeypatch.setattr(library, 'capture_config', lambda: replace(config, revision='changed'))
    with pytest.raises(library.VideoLibraryError, match='configuration'):
        await svc.materialize('pexels-123', ref)


@pytest.mark.asyncio
async def test_router_unknown_ingest_is_persistent_and_not_reposted(setup_library, monkeypatch):
    svc, manual = setup_library
    router = replace(manual, routed=True, revision='router-revision', api_key='',
                     router=RouterSnapshot('router', 'router', 'https://gateway.invalid',
                         api_key='ar-fixture', credential_revision='account1', revision='r'))
    monkeypatch.setattr(library, 'capture_config', lambda: router)
    ref = candidate(svc, router)
    post = AsyncMock(side_effect=RouterError('upstream_timeout', 504,
                       'Timed out', details={'request_sent': True}))
    monkeypatch.setattr(library.AsyncRouterClient, 'post', post)
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize('pexels-123', ref)
    assert caught.value.error_code == 'video_ingest_outcome_unknown'
    restarted = library.VideoLibraryService(svc.cache)
    ref = candidate(restarted, router)
    with pytest.raises(library.VideoLibraryError) as caught:
        await restarted.materialize('pexels-123', ref)
    assert caught.value.error_code == 'video_ingest_outcome_unknown'
    assert post.await_count == 1


@pytest.mark.asyncio
async def test_router_prefetch_never_ingests(setup_library, monkeypatch):
    svc, manual = setup_library
    router = replace(manual, routed=True)
    monkeypatch.setattr(library, 'capture_config', lambda: router)
    candidate(svc, router)
    post = AsyncMock()
    monkeypatch.setattr(library.AsyncRouterClient, 'post', post)
    result = await svc.enqueue('123')
    assert result['status'] == 'candidate'
    post.assert_not_awaited()


def routed_config(manual, *, account='account1', revision='router-revision'):
    return replace(manual, routed=True, revision=revision, api_key='',
        router=RouterSnapshot('router', 'router', 'https://gateway.invalid',
            api_key='ar-fixture', credential_revision=account, revision='r'))


def install_router(monkeypatch, config, *, post_error=None, download_error=None):
    monkeypatch.setattr(library, 'capture_config', lambda: config)
    post = AsyncMock(side_effect=post_error, return_value={
        'asset': {'id': 'asset-1', 'url': '/api/v1/media/assets/asset-1'}})
    monkeypatch.setattr(library.AsyncRouterClient, 'post', post)

    async def download(snapshot, url, path, **kwargs):
        if download_error:
            raise download_error
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'gateway-video')
        return len(b'gateway-video')

    asset_get = AsyncMock(side_effect=download)
    monkeypatch.setattr(library, 'download_asset', asset_get)
    metadata = dict(size=len(b'gateway-video'), width=64, height=64,
                    duration=1., format='mp4')
    monkeypatch.setattr(library, 'validate_video', AsyncMock(return_value=metadata))
    return post, asset_get


async def cached_row(svc, identifier=123):
    async with svc.cache._session_factory() as session:
        result = await session.execute(select(CachedMaterial).where(
            CachedMaterial.source == 'pexels', CachedMaterial.source_id == str(identifier)))
        return result.scalar_one()


@pytest.mark.asyncio
async def test_router_ingests_once_then_downloads_authenticated_asset(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config)
    forbidden_cdn = AsyncMock(side_effect=AssertionError('Router path used direct CDN'))
    monkeypatch.setattr(library, 'download_video', forbidden_cdn)
    key_read = AsyncMock(side_effect=AssertionError('Router path read manual API key'))
    monkeypatch.setattr(svc, '_manual_url', key_read)
    ref = candidate(svc, config)
    first, second = await asyncio.gather(svc.materialize('pexels-123', ref),
                                         svc.materialize('pexels-123', ref))
    assert first == second
    assert first['material_id'] == 'pexels-123'
    assert first['download_mode'] == 'router'
    assert first['size'] == len(b'gateway-video')
    post.assert_awaited_once()
    args, kwargs = post.await_args
    assert args[0] == 'media/ingest'
    assert args[1]['sourceUrl'] == 'https://videos.pexels.com/video-files/123/clip.mp4'
    assert args[1]['attribution']['text'] == 'Video by Creator'
    assert 'api_key' not in json.dumps(args[1])
    assert asset_get.await_args.args[:2] == (
        config.router, 'https://gateway.invalid/api/v1/media/assets/asset-1')
    assert asset_get.await_args.kwargs['max_bytes'] == library.MAX_BYTES
    forbidden_cdn.assert_not_awaited()
    key_read.assert_not_awaited()
    row = await cached_row(svc)
    assert row.status == 'ready' and row.file_size == first['size']
    assert Path(row.local_path).read_bytes() == b'gateway-video'
    receipt = svc._read_receipt('123')
    assert receipt['state'] == 'asset' and receipt['asset_id'] == 'asset-1'
    assert config.router.api_key not in json.dumps(receipt)
    assert await svc.materialize('pexels-123', ref) == first
    assert post.await_count == asset_get.await_count == 1


@pytest.mark.asyncio
async def test_saved_asset_get_failure_recovers_after_service_restart_without_post(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config,
        download_error=RouterError('upstream_unavailable', 502, 'GET failed'))
    ref = candidate(svc, config)
    with pytest.raises(RouterError):
        await svc.materialize('pexels-123', ref)
    assert svc._read_receipt('123')['state'] == 'asset'
    assert (await cached_row(svc)).status == 'failed'

    async def recover_get(snapshot, url, path, **kwargs):
        path.write_bytes(b'gateway-video')
        return len(b'gateway-video')

    asset_get.side_effect = recover_get
    restarted = library.VideoLibraryService(svc.cache)
    ref = candidate(restarted, config)
    result = await restarted.materialize('pexels-123', ref)
    assert result['success'] and result['size'] == len(b'gateway-video')
    assert post.await_count == 1
    assert asset_get.await_count == 2
    assert asset_get.await_args.args[1] == 'https://gateway.invalid/api/v1/media/assets/asset-1'


@pytest.mark.asyncio
async def test_asset_rate_limit_preserves_backoff_without_repeating_ingest(
        setup_library, monkeypatch):
    from app.services.skillrouter import client as router_client

    svc, manual = setup_library
    config = routed_config(manual)
    monkeypatch.setattr(library, 'capture_config', lambda: config)
    post = AsyncMock(return_value={
        'asset': {'id': 'asset-1', 'url': '/api/v1/media/assets/asset-1'}})
    monkeypatch.setattr(library.AsyncRouterClient, 'post', post)
    requests = []

    def rate_limited(request):
        requests.append(request)
        return httpx.Response(429, headers={'Retry-After': '75'},
                              text='Do not expose reflected credentials.')

    monkeypatch.setattr(router_client, '_async_client_factory',
        lambda *_args, **_kwargs: httpx.AsyncClient(
            transport=httpx.MockTransport(rate_limited)))
    ref = candidate(svc, config)
    for _ in range(2):
        with pytest.raises(RouterError) as caught:
            await svc.materialize('pexels-123', ref)
        assert caught.value.response_status == 429
        assert caught.value.error_code == 'router_busy'
        assert caught.value.retry_after == 75
        assert caught.value.is_retryable
        assert 'reflected credentials' not in str(caught.value)
    assert post.await_count == 1
    assert len(requests) == 2
    assert svc._read_receipt('123')['state'] == 'asset'


@pytest.mark.asyncio
async def test_account_change_cannot_download_old_authenticated_asset(
        setup_library, monkeypatch):
    svc, manual = setup_library
    first_config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, first_config,
        download_error=RouterError('upstream_unavailable', 502, 'GET failed'))
    ref = candidate(svc, first_config)
    with pytest.raises(RouterError):
        await svc.materialize('pexels-123', ref)
    second_config = routed_config(manual, account='account2', revision='new-account')
    monkeypatch.setattr(library, 'capture_config', lambda: second_config)
    restarted = library.VideoLibraryService(svc.cache)
    new_ref = candidate(restarted, second_config)
    with pytest.raises(library.VideoLibraryError) as caught:
        await restarted.materialize('pexels-123', new_ref)
    assert caught.value.error_code == 'video_ingest_account_changed'
    assert post.await_count == asset_get.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('damage', ['missing', 'empty', 'corrupt'])
async def test_invalid_ready_cache_recovers_from_manual_provider(
        setup_library, monkeypatch, damage):
    svc, config = setup_library
    ref = candidate(svc, config)
    transfer = fake_transfer(monkeypatch)
    first = await svc.materialize('pexels-123', ref)
    path = Path((await cached_row(svc)).local_path)
    if damage == 'missing':
        path.unlink()
    else:
        path.write_bytes(b'' if damage == 'empty' else b'corrupt')

    async def validate(path):
        if not path.exists() or path.read_bytes() != b'fixture-video':
            raise library.VideoTransferError('video_invalid')
        return {key: first[key] for key in ('size', 'width', 'height', 'duration', 'format')}

    monkeypatch.setattr(library, 'validate_video', validate)
    recovered = await svc.materialize('pexels-123', ref)
    assert recovered == first
    assert path.read_bytes() == b'fixture-video'
    assert transfer.await_count == 2
    assert (await cached_row(svc)).status == 'ready'


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_cancel_shared_download(
        setup_library, monkeypatch):
    svc, config = setup_library
    ref = candidate(svc, config)
    started, release = asyncio.Event(), asyncio.Event()

    async def delayed(url, path, **kwargs):
        started.set()
        await release.wait()
        path.write_bytes(b'validated')
        return dict(size=9, width=64, height=64, duration=1., format='mp4')

    transfer = AsyncMock(side_effect=delayed)
    monkeypatch.setattr(library, 'download_video', transfer)
    first = asyncio.create_task(svc.materialize('pexels-123', ref))
    await asyncio.wait_for(started.wait(), 2)
    second = asyncio.create_task(svc.materialize('pexels-123', ref))
    await asyncio.sleep(0)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    result = await asyncio.wait_for(second, 2)
    assert result['success'] and transfer.await_count == 1
    assert (await cached_row(svc)).status == 'ready'
    await asyncio.sleep(0)
    assert svc.cache._video_jobs == {}


@pytest.mark.asyncio
async def test_different_router_videos_have_effective_concurrency_limit(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config)
    refs = [candidate(svc, config, identifier) for identifier in range(123, 128)]
    active = maximum = 0
    two_started, release = asyncio.Event(), asyncio.Event()

    async def gated_post(path, body, **kwargs):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        if active == 2:
            two_started.set()
        try:
            await release.wait()
            return {'asset': {'id': 'asset-1', 'url': '/api/v1/media/assets/asset-1'}}
        finally:
            active -= 1

    post.side_effect = gated_post
    tasks = [asyncio.create_task(svc.materialize(f'pexels-{identifier}', ref))
             for identifier, ref in zip(range(123, 128), refs)]
    try:
        await asyncio.wait_for(two_started.wait(), 2)
        assert post.await_count == 2
        release.set()
        results = await asyncio.wait_for(asyncio.gather(*tasks), 3)
    finally:
        release.set()
        await asyncio.gather(*tasks, return_exceptions=True)
    assert maximum == 2
    assert all(result['success'] for result in results)
    assert post.await_count == asset_get.await_count == 5


@pytest.mark.asyncio
async def test_disabled_downloads_reject_before_transfer_or_paid_post(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config)
    ref = candidate(svc, config)
    monkeypatch.setattr(library, 'research_settings', lambda: {'downloads_enabled': False})
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize('pexels-123', ref)
    assert caught.value.error_code == 'downloads_disabled'
    with pytest.raises(library.VideoLibraryError):
        await svc.enqueue('123')
    post.assert_not_awaited()
    asset_get.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('identifier,ref_kind,code', [
    ('https://videos.pexels.com/a.mp4', 'valid', 'video_candidate_invalid'),
    ('web-123', 'valid', 'video_candidate_invalid'),
    ('pexels-0', 'valid', 'video_candidate_invalid'),
    ('pexels-124', 'valid', 'video_candidate_invalid'),
    ('pexels-123', 'forged', 'video_candidate_expired'),
    ('pexels-123', 'expired', 'video_candidate_expired'),
])
async def test_candidate_identity_and_expiration_are_enforced(
        setup_library, monkeypatch, identifier, ref_kind, code):
    svc, config = setup_library
    ref = candidate(svc, config)
    if ref_kind == 'forged':
        ref = 'forged-reference'
    if ref_kind == 'expired':
        svc._candidates[ref] = replace(svc._candidates[ref], expires=0)
    transfer = fake_transfer(monkeypatch)
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize(identifier, ref)
    assert caught.value.error_code == code
    transfer.assert_not_awaited()


@pytest.mark.asyncio
async def test_search_renews_same_ref_and_records_current_mode(
        setup_library, monkeypatch):
    svc, manual = setup_library
    ref = candidate(svc, manual)
    old = svc._candidates[ref]
    svc._candidates[ref] = replace(old, expires=old.expires - 60)
    result = VideoSearchResponse(success=True, message='updated', videos=[VideoInfo(
        id=123, title='Updated', author='Updated creator', duration=2,
        video_url='https://videos.pexels.com/video-files/123/new.mp4',
        thumbnail='', width=128, height=64)])
    svc.register_results(result, manual)
    assert result.videos[0].candidate_ref == ref
    assert result.videos[0].download_mode == 'manual'
    assert result.videos[0].config_revision == manual.revision
    renewed = svc._candidates[ref]
    assert renewed.expires >= old.expires
    assert renewed.url.endswith('/new.mp4') and renewed.author == 'Updated creator'
    router = routed_config(manual)
    monkeypatch.setattr(library, 'capture_config', lambda: router)
    new_ref = candidate(svc, router)
    assert new_ref != ref
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize('pexels-123', ref)
    assert caught.value.error_code == 'video_configuration_changed'


@pytest.mark.asyncio
async def test_router_historical_candidate_requires_trusted_new_search(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, _ = install_router(monkeypatch, config)
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize('pexels-123')
    assert caught.value.error_code == 'video_candidate_expired'
    post.assert_not_awaited()


@pytest.mark.asyncio
async def test_manual_historical_candidate_uses_authenticated_video_detail_api(
        setup_library, monkeypatch):
    svc, config = setup_library
    requests = []

    def transport(request):
        requests.append(request)
        return httpx.Response(200, json={'id': 123, 'video_files': [
            {'width': 1280, 'height': 720,
             'link': 'https://videos.pexels.com/video-files/123/refreshed.mp4'}]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(library.httpx, 'AsyncClient', lambda **kwargs:
        real_client(transport=httpx.MockTransport(transport), **kwargs))
    transfer = fake_transfer(monkeypatch)
    result = await svc.materialize('pexels-123')
    assert result['success']
    assert len(requests) == 1
    assert str(requests[0].url) == 'https://api.pexels.com/videos/videos/123'
    assert requests[0].headers['authorization'] == config.api_key
    assert transfer.await_args.args[0].endswith('/refreshed.mp4')
    assert config.api_key not in str(transfer.await_args)


@pytest.mark.asyncio
@pytest.mark.parametrize('status,code', [(401, 'video_authentication_failed'),
    (403, 'video_access_denied'), (404, 'video_not_found'), (429, 'video_rate_limited')])
async def test_manual_detail_api_http_errors_are_structured(
        setup_library, monkeypatch, status, code):
    svc, config = setup_library
    real_client = httpx.AsyncClient
    monkeypatch.setattr(library.httpx, 'AsyncClient', lambda **kwargs:
        real_client(transport=httpx.MockTransport(lambda request: httpx.Response(
            status, headers={'retry-after': '5'})), **kwargs))
    transfer = fake_transfer(monkeypatch)
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize('pexels-123')
    assert caught.value.error_code == code
    assert caught.value.status_code == status
    assert config.api_key not in str(caught.value)
    transfer.assert_not_awaited()


@pytest.mark.asyncio
async def test_config_switch_during_download_prevents_cache_commit(
        setup_library, monkeypatch):
    svc, config = setup_library
    ref = candidate(svc, config)
    started, release = asyncio.Event(), asyncio.Event()

    async def delayed(url, path, **kwargs):
        started.set()
        await release.wait()
        path.write_bytes(b'late-video')
        return dict(size=10, width=64, height=64, duration=1., format='mp4')

    monkeypatch.setattr(library, 'download_video', delayed)
    task = asyncio.create_task(svc.materialize('pexels-123', ref))
    await asyncio.wait_for(started.wait(), 2)
    monkeypatch.setattr(library, 'capture_config', lambda: replace(config, revision='new-mode'))
    release.set()
    with pytest.raises(library.VideoLibraryError) as caught:
        await asyncio.wait_for(task, 2)
    assert caught.value.error_code == 'video_configuration_changed'
    row = await cached_row(svc)
    assert row.status == 'failed' and row.local_path is None
    assert not (svc.cache.cache_dir / 'pexels' / '123.mp4').exists()
    assert not list((svc.cache.cache_dir / 'pexels').glob('*.mp4'))


@pytest.mark.asyncio
async def test_config_switch_while_queued_prevents_paid_submission(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, _ = install_router(monkeypatch, config)
    ref = candidate(svc, config)
    svc.cache._video_jobs = {}
    svc.cache._video_gate = asyncio.Semaphore(0)
    task = asyncio.create_task(svc.materialize('pexels-123', ref))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    monkeypatch.setattr(library, 'capture_config', lambda: replace(config, revision='new-mode'))
    svc.cache._video_gate.release()
    with pytest.raises(library.VideoLibraryError) as caught:
        await asyncio.wait_for(task, 2)
    assert caught.value.error_code == 'video_configuration_changed'
    post.assert_not_awaited()


@pytest.mark.asyncio
async def test_configuration_rechecked_after_cached_file_validation(
        setup_library, monkeypatch):
    svc, config = setup_library
    ref = candidate(svc, config)
    fake_transfer(monkeypatch)
    first = await svc.materialize('pexels-123', ref)

    async def validate(path):
        monkeypatch.setattr(library, 'capture_config', lambda: replace(config, revision='new-mode'))
        return {key: first[key] for key in ('size', 'width', 'height', 'duration', 'format')}

    monkeypatch.setattr(library, 'validate_video', validate)
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize('pexels-123', ref)
    assert caught.value.error_code == 'video_configuration_changed'


@pytest.mark.asyncio
async def test_disabling_downloads_while_queued_prevents_paid_submission(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, _ = install_router(monkeypatch, config)
    ref = candidate(svc, config)
    svc.cache._video_jobs = {}
    svc.cache._video_gate = asyncio.Semaphore(0)
    task = asyncio.create_task(svc.materialize('pexels-123', ref))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    monkeypatch.setattr(library, 'research_settings', lambda: {'downloads_enabled': False})
    svc.cache._video_gate.release()
    with pytest.raises(library.VideoLibraryError) as caught:
        await asyncio.wait_for(task, 2)
    assert caught.value.error_code == 'downloads_disabled'
    post.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [404, 405, 501])
async def test_explicit_unsupported_ingest_response_is_reported(
        setup_library, monkeypatch, status):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config,
        post_error=RouterError('not_found', status, 'Unsupported endpoint'))
    ref = candidate(svc, config)
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize('pexels-123', ref)
    assert caught.value.error_code == 'video_ingest_unsupported'
    assert post.await_count == 1
    asset_get.assert_not_awaited()


def test_capture_router_config_never_reads_manual_credentials(monkeypatch):
    # This test deliberately avoids setup_library's capture_config patch.
    snapshot = RouterSnapshot('router', 'router', 'https://gateway.invalid',
        api_key='ar-fixture', credential_revision='account1', revision='r')
    monkeypatch.setattr(library, 'get_snapshot', lambda: snapshot)
    decisions = []
    monkeypatch.setattr(library, 'is_routed', lambda capability:
        decisions.append(capability) or True)

    def forbidden(*args):
        raise AssertionError('Router mode must not read a Pexels key')

    monkeypatch.setattr(library.integration_credentials, 'values', forbidden)
    config = library.capture_config()
    assert decisions == ['video_library']
    assert config.routed and config.api_key == '' and config.router is snapshot
    assert snapshot.api_key not in repr(config)


@pytest.mark.asyncio
@pytest.mark.parametrize('damage', ['empty', 'corrupt'])
async def test_router_automatic_lookup_does_not_claim_invalid_cache_is_ready(
        setup_library, monkeypatch, damage):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config)
    ref = candidate(svc, config)
    await svc.materialize('pexels-123', ref)
    path = Path((await cached_row(svc)).local_path)
    path.write_bytes(b'' if damage == 'empty' else b'corrupt')
    monkeypatch.setattr(library, 'validate_video', AsyncMock(
        side_effect=library.VideoTransferError('video_invalid')))
    result = await svc.enqueue('123')
    assert result['status'] == 'candidate'
    assert result['local_path'] == ''
    assert post.await_count == asset_get.await_count == 1


@pytest.mark.asyncio
async def test_invalid_router_cache_recovers_existing_asset_without_second_ingest(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config)
    ref = candidate(svc, config)
    await svc.materialize('pexels-123', ref)
    path = Path((await cached_row(svc)).local_path)
    path.write_bytes(b'corrupt')

    async def validate(current):
        if current.read_bytes() != b'gateway-video':
            raise library.VideoTransferError('video_invalid')
        return dict(size=len(b'gateway-video'), width=64, height=64,
                    duration=1., format='mp4')

    monkeypatch.setattr(library, 'validate_video', validate)
    result = await svc.materialize('pexels-123', ref)
    assert result['success'] and path.read_bytes() == b'gateway-video'
    assert post.await_count == 1 and asset_get.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['submitting', 'unknown', 'corrupt'])
async def test_restart_with_unresolved_receipt_never_posts_again(
        setup_library, monkeypatch, state):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config)
    candidate(svc, config)
    if state == 'corrupt':
        svc._receipt_path('123').write_text('invalid json', encoding='utf-8')
    else:
        svc._write_receipt('123', {'source_id': '123', 'state': state,
            'base_url': config.router.base_url,
            'credential_revision': config.router.credential_revision})
    restarted = library.VideoLibraryService(svc.cache)
    ref = candidate(restarted, config)
    with pytest.raises(library.VideoLibraryError) as caught:
        await restarted.materialize('pexels-123', ref)
    assert caught.value.error_code == 'video_ingest_outcome_unknown'
    post.assert_not_awaited()
    asset_get.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('asset', [None, {'id': 'a'},
    {'id': 'a', 'url': 'https://other-account.invalid/asset.mp4'},
    {'id': 'a', 'url': '/api/v1/media/assets/a?key=secret'}])
async def test_invalid_paid_receipt_stays_uncertain_and_never_reposts(
        setup_library, monkeypatch, asset):
    svc, manual = setup_library
    config = routed_config(manual)
    post, asset_get = install_router(monkeypatch, config)
    post.return_value = {'asset': asset}
    ref = candidate(svc, config)
    for _ in range(2):
        with pytest.raises(library.VideoLibraryError) as caught:
            await svc.materialize('pexels-123', ref)
        assert caught.value.error_code == 'video_ingest_outcome_unknown'
    assert post.await_count == 1
    asset_get.assert_not_awaited()
    receipt = svc._receipt_path('123').read_text(encoding='utf-8')
    assert config.router.api_key not in receipt and '?key=secret' not in receipt


@pytest.mark.asyncio
async def test_provider_failure_does_not_block_another_video_id(
        setup_library, monkeypatch):
    svc, config = setup_library
    first_ref = candidate(svc, config, 123)
    second_ref = candidate(svc, config, 124)

    async def download(url, path, **kwargs):
        if '/123/' in url:
            raise library.VideoTransferError('video_download_timeout', 504, retryable=True)
        path.write_bytes(b'video')
        return dict(size=5, width=64, height=64, duration=1., format='mp4')

    monkeypatch.setattr(library, 'download_video', download)
    results = await asyncio.gather(svc.materialize('pexels-123', first_ref),
        svc.materialize('pexels-124', second_ref), return_exceptions=True)
    assert isinstance(results[0], library.VideoTransferError)
    assert results[1]['material_id'] == 'pexels-124' and results[1]['success']
    assert (await cached_row(svc, 123)).status == 'failed'
    assert (await cached_row(svc, 124)).status == 'ready'


@pytest.mark.asyncio
async def test_config_switch_immediately_before_submit_prevents_paid_post(
        setup_library, monkeypatch):
    svc, manual = setup_library
    config = routed_config(manual)
    post, _ = install_router(monkeypatch, config)
    ref = candidate(svc, config)
    original_set_row = svc._set_row

    async def switch_after_queue(row, **changes):
        await original_set_row(row, **changes)
        if changes.get('status') == 'downloading':
            monkeypatch.setattr(library, 'capture_config',
                lambda: replace(config, revision='changed-before-submit'))

    monkeypatch.setattr(svc, '_set_row', switch_after_queue)
    with pytest.raises(library.VideoLibraryError) as caught:
        await svc.materialize('pexels-123', ref)
    assert caught.value.error_code == 'video_configuration_changed'
    post.assert_not_awaited()
