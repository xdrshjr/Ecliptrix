"""封面导出的不可变引用、严格失败及真实媒体边界。"""
import asyncio
import io
import json
import shutil
import subprocess
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import numpy as np
from PIL import Image, ImageDraw

from app.models.video_models import VideoCompositionRequest
from app.services.composition import cover_contract
from app.services import video_cover_asset_service as assets
from app.services import video_cover_v2_service as covers
from tests.test_video_cover_v2 import project, revision
from tests.composition_harness import (
    make_service, composition_request, image_item, FakeFfmpeg, composing,
    camera_seams,
)


def request_for(identifier, published, **overrides):
    values = dict(task_id='cover-export', video_items=[], total_duration=1,
        image_items=[dict(id='cover', name='封面', url=published['url'],
            start_time=0, duration=1, track_id='image-cover',
            position=dict(x=0, y=0, width=1, height=1))],
        required_cover=dict(project_id=identifier, revision_id=published['id'],
            image_item_id='cover', sha256=published['sha256']))
    values.update(overrides)
    return VideoCompositionRequest(**values)


@pytest.mark.asyncio
async def test_required_revision_locks_snapshot_and_leases_file(db_session, monkeypatch, tmp_path):
    identifier = await project(db_session, monkeypatch, tmp_path)
    published = await revision(db_session, identifier)
    request = request_for(identifier, published)
    prepared = await cover_contract.prepare_required_cover(db_session, request)
    request.image_items[0].duration = 2
    assert prepared.request.image_items[0].duration == 1
    assets.cleanup_project_files(identifier)
    assert prepared.path.is_file()
    prepared.release()
    assert not prepared.path.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['fps', 'frames', 'moved', 'opacity',
    'size', 'hash', 'missing', 'overlap', 'broken', 'duplicate', 'url'])
async def test_invalid_required_cover_rejected(db_session, monkeypatch, tmp_path, change):
    identifier = await project(db_session, monkeypatch, tmp_path)
    published = await revision(db_session, identifier)
    request = request_for(identifier, published)
    if change == 'fps': request.output_fps = 24
    if change == 'frames': request.image_items[0].duration = 0.11
    if change == 'moved': request.image_items[0].start_time = 0.1
    if change == 'opacity': request.image_items[0].opacity = 0.5
    if change == 'size': request.output_resolution = dict(width=1080, height=1920)
    if change == 'hash': request.required_cover.sha256 = '0' * 64
    if change == 'missing': assets.local_source_path(published['url']).unlink()
    if change == 'broken': assets.local_source_path(published['url']).write_bytes(b'broken')
    if change == 'url': request.image_items[0].url = '/api/storage/files/other.png'
    if change == 'duplicate': request.image_items.append(request.image_items[0].model_copy())
    if change == 'overlap':
        extra = request.image_items[0].model_copy(update={'id': 'body', 'start_time': 0.5})
        request.image_items.append(extra)
    with pytest.raises(cover_contract.CoverCompositionError):
        await cover_contract.prepare_required_cover(db_session, request)
    assert identifier not in assets._leases


@pytest.mark.asyncio
async def test_worker_release_runs_once_on_owner_event_loop(db_session, monkeypatch, tmp_path):
    identifier = await project(db_session, monkeypatch, tmp_path)
    published = await revision(db_session, identifier)
    prepared = await cover_contract.prepare_required_cover(
        db_session, request_for(identifier, published))
    owner_thread = threading.get_ident()
    released = []
    release = prepared.lease.release
    def record_release():
        released.append(threading.get_ident())
        release()
    monkeypatch.setattr(prepared.lease, 'release', record_release)
    await asyncio.to_thread(prepared.release)
    prepared.release()
    assert released == [owner_thread]


def test_strict_skipped_image_fails_instead_of_successful_degradation(tmp_path):
    service = make_service(tmp_path)
    item = image_item(tmp_path, 'cover', 0, 1)
    request = composition_request(total_duration=1, image_items=[item])
    service.compositions['comp-1']['strict_image_ids'] = {'cover'}
    Path(item.url).write_bytes(b'broken PNG')
    with composing(FakeFfmpeg()):
        result = service._compose_video_sync('comp-1', request)
    assert not result.success
    assert service.compositions['comp-1']['error_code'] == 'COVER_EXPORT_FAILED'
    assert service.get_download_info('comp-1') is None


def test_strict_ffmpeg_failure_never_returns_download(tmp_path):
    service = make_service(tmp_path)
    item = image_item(tmp_path, 'cover', 0, 1)
    request = composition_request(total_duration=1, image_items=[item])
    service.compositions['comp-1']['strict_image_ids'] = {'cover'}
    failed = FakeFfmpeg(fail_when=lambda cmd: cmd[-1].endswith('_with_images.mp4'))
    with composing(failed):
        result = service._compose_video_sync('comp-1', request)
    assert not result.success
    assert service.get_download_info('comp-1') is None
    assert not list(service.output_dir.glob('*.mp4'))


@pytest.mark.parametrize('combined', [False, True])
def test_strict_replace_failure_is_fatal(tmp_path, combined):
    service = make_service(tmp_path)
    item = image_item(tmp_path, 'cover', 0, 1)
    subtitles = [dict(id='s', name='s', text='body', start_time=1,
                     duration=1, track_id='sub')] if combined else []
    request = composition_request(total_duration=2, image_items=[item],
                                  subtitle_items=subtitles)
    service.compositions['comp-1']['strict_image_ids'] = {'cover'}
    with composing(FakeFfmpeg()), patch(
            'app.services.video_composition_service.os.replace',
            side_effect=OSError('cannot replace output')):
        result = service._compose_video_sync('comp-1', request)
    assert not result.success
    assert service.compositions['comp-1']['error_code'] == 'COVER_EXPORT_FAILED'
    assert service.get_download_info('comp-1') is None


def test_queued_cancel_releases_cover_lease(tmp_path):
    service = make_service(tmp_path)
    lease = MagicMock()
    service.compositions['comp-1']['prepared_cover'] = lease
    request = composition_request(total_duration=1)
    with patch.object(service, '_acquire_composition_slot', return_value=False):
        service._process_video_composition_async('comp-1', request)
    lease.release.assert_called_once()


def test_strict_work_file_is_not_in_public_output_directory(tmp_path):
    service = make_service(tmp_path)
    item = image_item(tmp_path, 'cover', 0, 1)
    request = composition_request(total_duration=1, image_items=[item])
    service.compositions['comp-1']['strict_image_ids'] = {'cover'}
    overlay = service._process_image_overlays
    def inspect_output(images, video_path, *args, **kwargs):
        assert not Path(video_path).is_relative_to(service.output_dir)
        assert not (service.output_dir / 'composed_comp-1.mp4').exists()
        return overlay(images, video_path, *args, **kwargs)
    with composing(FakeFfmpeg()), patch.object(service, '_process_image_overlays',
                                               side_effect=inspect_output):
        result = service._compose_video_sync('comp-1', request)
    assert result.success
    assert Path(result.output_file_path).parent == service.output_dir


def media_command(arguments):
    result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error',
                             '-y', *arguments], capture_output=True, timeout=90)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    return result.stdout


async def patterned_revision(db, identifier):
    from tests.test_video_cover_v2 import draft
    saved = await draft(db, identifier)
    image = Image.new('RGB', (1920, 1080), 'red')
    draw = ImageDraw.Draw(image)
    draw.rectangle((960, 0, 1439, 539), fill='black')
    draw.rectangle((1440, 540, 1919, 1079), fill='white')
    output = io.BytesIO()
    image.save(output, 'PNG')
    return await covers.publish_revision(db, identifier, output.getvalue(), {
        'request_id': 'real-export', 'expected_version': 1,
        'document_hash': saved['document_hash'],
    })


def real_composition(service, prepared):
    """只替换本地测试文件解析和硬件探测，实际渲染/混音均执行FFmpeg。"""
    service.compositions['comp-1']['strict_image_ids'] = {'cover'}
    service.compositions['comp-1']['prepared_cover'] = prepared
    lookup = MagicMock()
    lookup.resolve_cached_path.return_value = None
    lookup.lookup_by_url.return_value = None
    with camera_seams(), patch.object(service, '_convert_url_to_local_path',
            side_effect=lambda url: str(assets.local_source_path(url))
            if url.startswith('/api/storage/files/') else url), patch(
            'app.services.video_composition_service.get_material_download_service',
            return_value=lookup):
        result = service._compose_video_sync('comp-1', prepared.request)
    assert result.success, service.compositions['comp-1']
    return service.get_download_info('comp-1')['file_path']


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='需要真实FFmpeg')
@pytest.mark.asyncio
async def test_real_video_first_and_boundary_frames_and_shifted_audio(db_session, monkeypatch, tmp_path):
    identifier = await project(db_session, monkeypatch, tmp_path)
    published = await patterned_revision(db_session, identifier)
    body = tmp_path / 'blue.mp4'
    sound = tmp_path / 'marker.wav'
    media_command(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=2',
                   '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(body)])
    media_command(['-f', 'lavfi', '-i',
        'aevalsrc=if(between(t\,0.5\,0.65)\,0.5*sin(2*PI*440*t)\,0):s=48000:d=2',
        str(sound)])
    request = request_for(identifier, published, total_duration=3,
        video_items=[dict(id='body', name='body',
                          url='/api/storage/files/blue.mp4', start_time=1,
                          duration=2, track_id='video', clip_start=0, clip_end=2)],
        audio_items=[dict(id='marker', name='marker',
                         url='/api/storage/files/marker.wav',
                         start_time=1, duration=2, track_id='audio')])
    prepared = await cover_contract.prepare_required_cover(db_session, request)
    output = real_composition(make_service(tmp_path), prepared)
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_streams',
                            '-show_format', '-of', 'json', output],
                           capture_output=True, check=True)
    info = json.loads(probe.stdout)
    video = next(stream for stream in info['streams'] if stream['codec_type'] == 'video')
    assert (video['width'], video['height'], video['r_frame_rate']) == (1920, 1080, '30/1')
    assert abs(float(info['format']['duration']) - 3) <= 1 / 30
    frames = media_command(['-i', output, '-vf',
        'select=eq(n\,0)+eq(n\,29)+eq(n\,30),scale=160:90',
        '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    pixels = np.frombuffer(frames, np.uint8).reshape(3, 90, 160, 3)
    for index in (0, 1):
        mean = pixels[index, 10:70, 10:70].mean(axis=(0, 1))
        assert mean[0] > 200 and mean[2] < 40
    assert pixels[2, :, :, 2].mean() > 200
    audio = media_command(['-i', output, '-vn', '-ac', '1', '-ar', '48000',
                           '-f', 'f32le', 'pipe:1'])
    samples = np.frombuffer(audio, '<f4')
    onset = np.flatnonzero(np.abs(samples) > 0.02)[0] / 48000
    assert abs(onset - 1.5) <= 1 / 30
    assert np.max(np.abs(samples[:48000])) < 0.002


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='需要真实FFmpeg')
@pytest.mark.asyncio
async def test_real_cover_only_exports_one_second_without_video_or_audio(db_session, monkeypatch, tmp_path):
    identifier = await project(db_session, monkeypatch, tmp_path)
    published = await revision(db_session, identifier)
    prepared = await cover_contract.prepare_required_cover(
        db_session, request_for(identifier, published))
    output = real_composition(make_service(tmp_path), prepared)
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_format',
                           '-of', 'json', output], capture_output=True, check=True)
    assert abs(float(json.loads(probe.stdout)['format']['duration']) - 1) <= 1 / 30
    assert identifier not in assets._leases


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='需要真实FFmpeg')
@pytest.mark.asyncio
async def test_real_portrait_multiple_images_and_subtitles(db_session, monkeypatch, tmp_path):
    from tests.test_video_cover_v2 import draft, png
    identifier = await project(db_session, monkeypatch, tmp_path)
    saved = await draft(db_session, identifier, aspect_ratio='9:16')
    published = await covers.publish_revision(db_session, identifier,
        png((1080, 1920)), {'request_id': 'portrait', 'expected_version': 1,
                           'document_hash': saved['document_hash']})
    request = request_for(identifier, published, aspect_ratio='9:16', total_duration=2,
        subtitle_items=[dict(id='sub', name='body', text='Cover export',
            start_time=1, duration=1, track_id='subtitle')])
    green = tmp_path / 'green.png'
    Image.new('RGB', (1080, 1920), 'green').save(green)
    request.image_items.append(request.image_items[0].model_copy(update={
        'id': 'body', 'url': str(green), 'start_time': 1,
    }))
    prepared = await cover_contract.prepare_required_cover(db_session, request)
    output = real_composition(make_service(tmp_path), prepared)
    frames = media_command(['-i', output, '-vf',
        r'select=eq(n\,0)+eq(n\,30),scale=54:96',
        '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    pixels = np.frombuffer(frames, np.uint8).reshape(2, 96, 54, 3)
    assert pixels[0, :40, :, 0].mean() > 200
    assert pixels[1, :40, :, 1].mean() > 80
