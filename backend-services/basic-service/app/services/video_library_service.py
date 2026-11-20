"""Trusted video candidates -> one validated local cache entry.

Runs on MaterialDownloadService's loop. Gateway receipts survive restarts so an
uncertain paid POST is never repeated, and a known asset only needs another GET.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
import uuid
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.db_models import CachedMaterial
from app.services.integration_credentials_service import integration_credentials
from app.services.skillrouter.assets import asset_url, download_asset
from app.services.skillrouter.client import AsyncRouterClient
from app.services.skillrouter.config import RouterSnapshot, get_snapshot, is_routed
from app.services.skillrouter.errors import RouterError
from app.services.system_settings_service import research_settings
from app.services.video_library_transfer import (
    VideoTransferError, download_video, validate_video,
)

MAX_BYTES = 256 * 1024 * 1024
CANDIDATE_TTL = 1800
MAX_CANDIDATES = 2048


def _require_downloads():
    if not research_settings().get('downloads_enabled', True):
        raise VideoLibraryError('downloads_disabled', 403, 'Downloads are disabled in settings.')


class VideoLibraryError(VideoTransferError):
    pass


@dataclass(frozen=True)
class VideoConfig:
    routed: bool
    revision: str
    router: RouterSnapshot = field(repr=False)
    api_key: str = field(default='', repr=False)


def capture_config() -> VideoConfig:
    """Use the sole routing predicate; never read a manual key in router mode."""
    snapshot = get_snapshot()
    routed = is_routed('video_library')
    keys = () if routed else tuple(integration_credentials.values('pexels', 'api_keys'))
    if snapshot.revision != get_snapshot().revision:
        raise VideoLibraryError('video_configuration_changed', 409,
                                'Video library configuration changed; search again.')
    fingerprint = hashlib.sha256(json.dumps(
        [routed, snapshot.revision, keys], separators=(',', ':')).encode()).hexdigest()
    return VideoConfig(routed, fingerprint, snapshot, keys[0] if keys else '')


@dataclass(frozen=True)
class Candidate:
    source_id: str
    url: str
    author: str
    revision: str
    expires: float


class VideoLibraryService:
    def __init__(self, cache=None):
        self._cache = cache
        self._candidates = OrderedDict()
        self._candidate_lock = threading.Lock()

    @property
    def cache(self):
        if self._cache is None:
            from app.services.material_download_service import get_material_download_service
            self._cache = get_material_download_service()
        return self._cache

    def _check_config(self, config):
        if capture_config().revision != config.revision:
            raise VideoLibraryError('video_configuration_changed', 409,
                                    'Video library configuration changed; search again.')

    def register_results(self, result, config):
        self._check_config(config)
        if not result.success:
            return result
        now = time.monotonic()
        with self._candidate_lock:
            for ref, entry in list(self._candidates.items()):
                if entry.expires < now:
                    del self._candidates[ref]
            for video in result.videos:
                source_id = str(video.id)
                ref = next((key for key, entry in self._candidates.items()
                            if entry.source_id == source_id and entry.revision == config.revision), None)
                ref = ref or uuid.uuid4().hex
                self._candidates[ref] = Candidate(source_id, video.video_url,
                    video.author, config.revision, now + CANDIDATE_TTL)
                self._candidates.move_to_end(ref)
                video.candidate_ref = ref
                video.download_mode = 'router' if config.routed else 'manual'
                video.config_revision = config.revision
            while len(self._candidates) > MAX_CANDIDATES:
                self._candidates.popitem(last=False)
        return result

    def _candidate(self, source_id, ref, config):
        with self._candidate_lock:
            if ref:
                entry = self._candidates.get(ref)
            else:
                entry = next((entry for entry in reversed(self._candidates.values())
                              if entry.source_id == source_id), None)
        if entry is not None:
            if entry.source_id != source_id:
                raise VideoLibraryError('video_candidate_invalid', 400,
                                        'Candidate identity does not match the video.')
            if entry.revision != config.revision:
                raise VideoLibraryError('video_configuration_changed', 409,
                                        'Video library configuration changed; search again.')
            if entry.expires >= time.monotonic():
                return entry
        if ref or config.routed:
            raise VideoLibraryError('video_candidate_expired', 409,
                                    'Search for this video again to obtain a current candidate.')
        # Historical manual candidates are validated by video ID through the API,
        # never by trusting a URL or source supplied by a client.
        return Candidate(source_id, '', '', config.revision, time.monotonic() + CANDIDATE_TTL)

    async def materialize(self, material_id, candidate_ref=None):
        match = re.fullmatch(r'pexels-([1-9][0-9]{0,17})', material_id or '')
        if not match:
            raise VideoLibraryError('video_candidate_invalid', 400,
                                    'A Pexels video material ID is required.')
        _require_downloads()
        config = capture_config()
        candidate = self._candidate(match[1], candidate_ref, config)
        return await self.cache._dispatch(self._join(candidate, config))

    async def enqueue(self, source_id):
        """Legacy automatic prefetch must never create a paid gateway asset."""
        if not re.fullmatch(r'[1-9][0-9]{0,17}', str(source_id)):
            raise VideoLibraryError('video_candidate_invalid', 400, 'Invalid Pexels video ID.')
        _require_downloads()
        config = capture_config()
        if config.routed:
            row = await self.cache.lookup_async(source='pexels', source_id=str(source_id))
            valid = False
            if row and self.cache.local_url_for(row):
                path = Path(row.local_path)
                if path.resolve().is_relative_to(self._directory()) and not path.is_symlink():
                    try:
                        await validate_video(path)
                        valid = True
                    except VideoTransferError:
                        pass
            self._check_config(config)
            return {'material_id': str(row.id) if row else f'pexels-{source_id}',
                    'status': 'ready' if valid else 'candidate',
                    'local_path': row.local_path if valid else ''}
        candidate = self._candidate(str(source_id), None, config)
        return await self.cache._dispatch(self._prefetch(candidate, config))

    async def _prefetch(self, candidate, config):
        task = asyncio.create_task(self._join(candidate, config))
        # A background prefetch failure is available from lookup; consume the
        # exception so it cannot escape as an unhandled task/log with secrets.
        task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
        return {'material_id': f'pexels-{candidate.source_id}', 'status': 'pending', 'local_path': ''}

    async def _join(self, candidate, config):
        cache = self.cache
        if not hasattr(cache, '_video_jobs'):
            cache._video_jobs = {}
            cache._video_gate = asyncio.Semaphore(2)
        entry = cache._video_jobs.get(candidate.source_id)
        if entry and entry[0] != config.revision:
            raise VideoLibraryError('video_configuration_changed', 409,
                                    'A download with another configuration is still running.')
        if entry is None:
            task = asyncio.create_task(self._run(candidate, config))
            cache._video_jobs[candidate.source_id] = (config.revision, task)

            def cleanup(done):
                cache._video_jobs.pop(candidate.source_id, None)
                if not done.cancelled():
                    done.exception()

            task.add_done_callback(cleanup)
        else:
            task = entry[1]
        # One caller leaving its project cannot cancel other callers' transfer.
        return await asyncio.shield(task)

    async def _row(self, candidate):
        async with self.cache._session_factory() as session:
            query = select(CachedMaterial).where(CachedMaterial.source == 'pexels',
                         CachedMaterial.source_id == candidate.source_id)
            row = (await session.execute(query)).scalar_one_or_none()
            if row is None:
                row = CachedMaterial(source='pexels', source_id=candidate.source_id,
                    source_url=candidate.url, status='pending', ref_count=1)
                session.add(row)
                try:
                    await session.commit()
                except IntegrityError:
                    await session.rollback()
                    row = (await session.execute(query)).scalar_one()
            return row

    def _directory(self):
        root = self.cache.cache_dir.resolve()
        directory = root / 'pexels'
        if not directory.resolve().is_relative_to(root) or directory.is_symlink():
            raise VideoLibraryError('video_cache_invalid', 507, 'Video cache directory is invalid.')
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def _receipt_path(self, source_id):
        return self._directory() / f'.{source_id}.ingest.json'

    def _read_receipt(self, source_id):
        path = self._receipt_path(source_id)
        if not path.exists():
            return None
        try:
            receipt = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(receipt, dict) or receipt.get('source_id') != source_id:
                raise ValueError()
            return receipt
        except (ValueError, OSError):
            raise VideoLibraryError('video_ingest_outcome_unknown', 409,
                'The saved ingest receipt cannot be verified. Check the gateway before retrying.') from None

    def _write_receipt(self, source_id, receipt):
        path = self._receipt_path(source_id)
        descriptor, filename = tempfile.mkstemp(dir=path.parent, suffix='.part')
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                json.dump(receipt, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(filename, path)
        finally:
            Path(filename).unlink(missing_ok=True)

    async def _set_row(self, row, **changes):
        async with self.cache._session_factory() as session:
            current = await session.get(CachedMaterial, row.id)
            for key, value in changes.items():
                setattr(current, key, value)
                setattr(row, key, value)
            await session.commit()

    async def _manual_url(self, candidate, config):
        if not config.api_key:
            raise VideoLibraryError('credential_not_configured', 409, 'Configure a Pexels API key.')
        url = f'https://api.pexels.com/videos/videos/{candidate.source_id}'
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
                async with client.stream('GET', url, headers={'Authorization': config.api_key}) as response:
                    if response.status_code != 200:
                        retry_after = response.headers.get('retry-after', '')
                        raise VideoLibraryError(
                            {401: 'video_authentication_failed', 403: 'video_access_denied',
                             404: 'video_not_found', 429: 'video_rate_limited'}.get(
                                 response.status_code, 'video_api_failed'),
                            response.status_code, f'Pexels API returned HTTP {response.status_code}.',
                            retryable=response.status_code == 429 or response.status_code >= 500,
                            retry_after=min(int(retry_after), 86400) if retry_after.isdigit() else None)
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 2 * 1024 * 1024:
                            raise VideoLibraryError('video_api_invalid', 502, 'Pexels API response is too large.')
            data = json.loads(body)
            if str(data.get('id')) != candidate.source_id:
                raise ValueError()
            from app.services.video_search_service import VideoSearchService
            selected = VideoSearchService()._select_video_file(data.get('video_files', []))
            if not selected or not selected.get('link'):
                raise ValueError()
            return selected['link']
        except httpx.HTTPError:
            raise VideoLibraryError('video_api_unavailable', 502,
                                    'Pexels API could not be reached.', retryable=True) from None
        except (ValueError, TypeError, AttributeError):
            raise VideoLibraryError('video_api_invalid', 502, 'Pexels API returned invalid video metadata.') from None

    async def _router_file(self, candidate, config, target):
        snapshot = config.router
        if not snapshot.has_key:
            raise VideoLibraryError('credential_not_configured', 409, 'Configure a SkillRouter API key.')
        receipt = self._read_receipt(candidate.source_id)
        if receipt and receipt.get('state') != 'rejected':
            if (receipt.get('credential_revision') != snapshot.credential_revision
                    or receipt.get('base_url') != snapshot.base_url):
                raise VideoLibraryError('video_ingest_account_changed', 409,
                    'This ingest belongs to another gateway account. Restore it or reconcile the asset first.')
            if receipt.get('state') in {'submitting', 'unknown'}:
                raise VideoLibraryError('video_ingest_outcome_unknown', 409,
                    'The gateway may already have created this asset. Check its outcome before retrying.')
        if not receipt or receipt.get('state') == 'rejected':
            _require_downloads()
            self._check_config(config)
            receipt = {'source_id': candidate.source_id, 'base_url': snapshot.base_url,
                       'credential_revision': snapshot.credential_revision, 'state': 'submitting'}
            self._write_receipt(candidate.source_id, receipt)
            try:
                result = await AsyncRouterClient(snapshot).post('media/ingest', {
                    'sourceUrl': candidate.url,
                    'attribution': {'text': f'Video by {candidate.author or "Pexels creator"}',
                                    'url': f'https://www.pexels.com/video/{candidate.source_id}/'},
                }, timeout=60)
                asset = result.get('asset') if isinstance(result, dict) else None
                if not isinstance(asset, dict) or not asset.get('id') or not asset.get('url'):
                    raise VideoLibraryError('video_ingest_outcome_unknown', 502,
                                            'The gateway ingest response has no usable asset receipt.')
                safe_url = asset_url(snapshot, str(asset['url']))
                if urlsplit(safe_url).query or urlsplit(safe_url).username:
                    raise VideoLibraryError('video_ingest_outcome_unknown', 502, 'Invalid gateway asset URL.')
                receipt.update(state='asset', asset_id=str(asset['id']), asset_url=safe_url)
                # Persist before GET: failure afterwards resumes this exact asset.
                self._write_receipt(candidate.source_id, receipt)
            except RouterError as error:
                sent = error.details.get('request_sent', error.http_status >= 500)
                receipt['state'] = 'unknown' if sent else 'rejected'
                self._write_receipt(candidate.source_id, receipt)
                if error.http_status in {404, 405, 501}:
                    raise VideoLibraryError('video_ingest_unsupported', 501,
                                            'This gateway does not support video ingest.') from None
                if sent:
                    raise VideoLibraryError('video_ingest_outcome_unknown', 409,
                        'The ingest outcome is unknown; check the gateway before retrying.') from None
                raise
        if receipt.get('state') != 'asset' or not receipt.get('asset_url'):
            raise VideoLibraryError('video_ingest_outcome_unknown', 409,
                                    'The saved gateway asset receipt is incomplete.')
        _require_downloads()
        self._check_config(config)
        await download_asset(snapshot, receipt['asset_url'], target, max_bytes=MAX_BYTES)
        return await validate_video(target)

    async def _run(self, candidate, config):
        async with self.cache._video_gate:
            _require_downloads()
            self._check_config(config)
            row = await self._row(candidate)
            if row.status == 'ready' and row.local_path:
                path = Path(row.local_path)
                if path.resolve().is_relative_to(self._directory()) and not path.is_symlink():
                    try:
                        metadata = await validate_video(path)
                        _require_downloads()
                        self._check_config(config)
                        return self._result(candidate, config, path, metadata)
                    except VideoLibraryError:
                        raise
                    except VideoTransferError:
                        pass
            await self._set_row(row, status='downloading', error_message=None, local_path=None)
            target = self._directory() / f'{candidate.source_id}.mp4'
            stage = target.with_name(f'{candidate.source_id}.{uuid.uuid4().hex}.mp4')
            try:
                self._check_config(config)
                if config.routed:
                    metadata = await self._router_file(candidate, config, stage)
                    source_url = candidate.url
                else:
                    source_url = candidate.url or await self._manual_url(candidate, config)
                    _require_downloads()
                    self._check_config(config)
                    try:
                        metadata = await download_video(source_url, stage, max_bytes=MAX_BYTES)
                    except VideoTransferError as error:
                        if error.status_code not in {401, 403, 404, 410} or not candidate.url:
                            raise
                        source_url = await self._manual_url(candidate, config)
                        _require_downloads()
                        self._check_config(config)
                        metadata = await download_video(source_url, stage, max_bytes=MAX_BYTES)
                _require_downloads()
                self._check_config(config)
                os.replace(stage, target)
                await self._set_row(row, status='ready', local_path=str(target),
                    source_url=source_url, file_size=metadata['size'],
                    width=metadata['width'], height=metadata['height'],
                    duration=metadata['duration'], error_message=None)
                return self._result(candidate, config, target, metadata)
            except (VideoTransferError, RouterError) as error:
                await self._set_row(row, status='failed', error_message=error.error_code)
                raise
            except OSError:
                await self._set_row(row, status='failed', error_message='video_cache_write_failed')
                raise VideoLibraryError('video_cache_write_failed', 507,
                                        'Video cache could not be written.') from None
            finally:
                stage.unlink(missing_ok=True)
                stage.with_name(stage.name + '.part').unlink(missing_ok=True)

    def _result(self, candidate, config, path, metadata):
        storage_key = f'cached_materials/pexels/{path.name}'
        return {'success': True, 'material_id': f'pexels-{candidate.source_id}',
                'source': 'pexels', 'source_id': candidate.source_id,
                'local_url': f'/api/storage/files/{storage_key}', 'storage_key': storage_key,
                'download_mode': 'router' if config.routed else 'manual', **metadata}


_service = VideoLibraryService()


def get_video_library_service():
    return _service
