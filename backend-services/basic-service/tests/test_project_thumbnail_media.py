"""用真实本地引用和 FFmpeg 验证裁剪画面及资源边界。"""
import asyncio
from dataclasses import replace
import io
from pathlib import Path
import shutil
import subprocess
import sys
import time
from types import SimpleNamespace

from PIL import Image
import pytest

from app.config import settings
from app.services import project_thumbnail_media as media
from app.services import project_thumbnail_source as source
from app.services.storage_service import storage_service


@pytest.fixture
def local_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))
    monkeypatch.setattr(storage_service, "root", tmp_path)
    monkeypatch.setattr(media, "_decode_slots", asyncio.Semaphore(2))
    return tmp_path


@pytest.fixture
def color_video(local_root):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("真实抽帧验收需要 FFmpeg")
    path = local_root / "colors.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i",
                    "color=c=red:s=160x90:d=1:r=10", "-f", "lavfi", "-i",
                    "color=c=blue:s=160x90:d=1:r=10", "-filter_complex",
                    "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "libx264",
                    "-threads", "1", "-pix_fmt", "yuv420p", str(path)],
                   check=True, capture_output=True, timeout=15)
    return path


def selection(reference="/api/storage/files/colors.mp4", clip_start=.2):
    return source.select_project_thumbnail({"scriptSegments": [{"videos": [
        {"id": "m", "type": "video", "url": reference}
    ]}]}) if clip_start == 0 else replace(selection(reference, 0), clip_start=clip_start)


@pytest.mark.asyncio
@pytest.mark.parametrize("clip_start,channel", [(.2, 0), (1.2, 2)])
async def test_real_decoder_uses_trim_start_and_fixed_size(color_video, clip_start, channel):
    resolved = await media.resolve_thumbnail_source(selection(clip_start=clip_start), deadline=time.monotonic() + 10)
    data = await media.extract_thumbnail(resolved, deadline=time.monotonic() + 10)
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "JPEG"
        assert image.size == (640, 360)
        pixel = image.getpixel((320, 180))
        assert pixel[channel] > 220 and pixel[2 - channel] < 30


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", ["blob:bad", "data:video/mp4,AA", "file:///secret.mp4",
    "/api/storage/files/../../outside.mp4", "/api/storage/files/%2e%2e/outside.mp4",
    "/api/video-projects/id/thumbnail", "/api/media-proxy?url=x", "https://example.com/video.mp4"])
async def test_invalid_or_remote_source_never_reaches_decoder(local_root, reference, monkeypatch):
    class EmptyCache:
        async def lookup_async(self, **kwargs):
            return None
    monkeypatch.setattr(media, "get_material_download_service", lambda: EmptyCache())
    with pytest.raises(media.ProjectThumbnailError) as error:
        await media.resolve_thumbnail_source(selection(reference), deadline=time.monotonic() + 1)
    assert error.value.code == "PROJECT_THUMBNAIL_SOURCE_UNAVAILABLE"


@pytest.mark.asyncio
async def test_stale_local_candidate_falls_back_within_selected_clip(color_video):
    chosen = replace(selection(), references=("/api/storage/files/missing.mp4", "/api/storage/files/colors.mp4"))
    resolved = await media.resolve_thumbnail_source(chosen, deadline=time.monotonic() + 1)
    assert resolved.path == color_video.resolve()


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["preview.mp4", "proxy-demo.mp4", "thumbnail-video.mp4"])
async def test_regular_storage_filenames_are_not_confused_with_proxy_routes(color_video, name):
    target = color_video.with_name(name)
    shutil.copyfile(color_video, target)
    resolved = await media.resolve_thumbnail_source(selection("/api/storage/files/" + name), deadline=time.monotonic() + 1)
    assert resolved.path == target


@pytest.mark.asyncio
async def test_unready_composite_cache_still_tries_ready_url(color_video, monkeypatch):
    calls = []
    class Cache:
        async def lookup_async(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(status="pending" if "source" in kwargs else "ready")

        def local_url_for(self, row):
            return "/api/storage/files/colors.mp4"
    monkeypatch.setattr(media, "get_material_download_service", Cache)
    chosen = replace(selection("https://example.com/v.mp4"), source="pexels", source_id="42")
    assert (await media.resolve_thumbnail_source(chosen, deadline=time.monotonic() + 1)).path == color_video
    assert calls == [{"source": "pexels", "source_id": "42"}, {"url": "https://example.com/v.mp4"}]


@pytest.mark.asyncio
async def test_out_of_range_and_invalid_video_fail_explicitly(color_video):
    resolved = await media.resolve_thumbnail_source(selection(clip_start=5), deadline=time.monotonic() + 5)
    with pytest.raises(media.ProjectThumbnailError, match="无法读取") as error:
        await media.extract_thumbnail(resolved, deadline=time.monotonic() + 5)
    assert error.value.code == "PROJECT_THUMBNAIL_DECODE_FAILED"
    color_video.write_bytes(b"broken")
    with pytest.raises(media.ProjectThumbnailError):
        await media.extract_thumbnail(resolved, deadline=time.monotonic() + 5)


@pytest.mark.asyncio
async def test_missing_decoder_and_expired_budget(color_video, monkeypatch):
    resolved = await media.resolve_thumbnail_source(selection(), deadline=time.monotonic() + 5)
    monkeypatch.setattr(media.shutil, "which", lambda name: None)
    with pytest.raises(media.ProjectThumbnailError) as error:
        await media.extract_thumbnail(resolved, deadline=time.monotonic() + 5)
    assert error.value.code == "PROJECT_THUMBNAIL_DECODER_UNAVAILABLE"
    with pytest.raises(media.ProjectThumbnailError) as error:
        await media.resolve_thumbnail_source(selection(), deadline=time.monotonic() - 1)
    assert error.value.code == "PROJECT_THUMBNAIL_TIMEOUT"


def test_decoder_argv_limits_both_sides_and_filter_threads():
    args = media.thumbnail_arguments("ffmpeg", Path("source.mp4"), 1.2)
    split = args.index("-i")
    assert args[:split].count("-threads") == 1
    assert args[split:].count("-threads") == 1
    assert args[args.index("-filter_threads") + 1] == "1"
    assert args[args.index("-ss") + 1] == "1.2"


def test_jpeg_validation_rejects_wrong_size_and_oversize():
    output = io.BytesIO()
    Image.new("RGB", (1, 1)).save(output, format="JPEG")
    for data in (b"bad", output.getvalue(), b"x" * (512 * 1024 + 1)):
        with pytest.raises(media.ProjectThumbnailError):
            media.validate_jpeg(data)


@pytest.mark.asyncio
async def test_real_portrait_rotation_preserves_direction_and_aspect(local_root):
    executable = shutil.which("ffmpeg")
    if not executable:
        pytest.skip("需要 FFmpeg")
    original, rotated = local_root / "wide.mp4", local_root / "rotated.mp4"
    subprocess.run([executable, "-v", "error", "-f", "lavfi", "-i", "color=red:s=80x90:d=1",
                    "-f", "lavfi", "-i", "color=blue:s=80x90:d=1", "-filter_complex", "hstack",
                    "-c:v", "libx264", "-threads", "1", str(original)], check=True, capture_output=True)
    subprocess.run([executable, "-v", "error", "-display_rotation:v:0", "90",
                    "-i", str(original), "-c", "copy", str(rotated)], check=True, capture_output=True)
    source = await media.resolve_thumbnail_source(selection("/api/storage/files/rotated.mp4"), deadline=time.monotonic() + 5)
    data = await media.extract_thumbnail(source, deadline=time.monotonic() + 5)
    with Image.open(io.BytesIO(data)) as image:
        assert image.size == (640, 360)
        assert max(image.getpixel((10, 180))) < 10
        assert image.getpixel((320, 50))[2] > 220
        assert image.getpixel((320, 310))[0] > 220


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "cancel", "oversize"])
async def test_real_subprocess_failure_reaps_and_releases_slot(color_video, monkeypatch, failure):
    source = await media.resolve_thumbnail_source(selection(), deadline=time.monotonic() + 5)
    processes, started = [], asyncio.Event()
    original = asyncio.create_subprocess_exec
    async def launch(*args, **kwargs):
        process = await original(*args, **kwargs)
        processes.append(process)
        started.set()
        return process
    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", launch)
    if failure == "oversize":
        monkeypatch.setattr(media, "MAX_JPEG_BYTES", 128)
    else:
        monkeypatch.setattr(media, "thumbnail_arguments", lambda exe, path, trim: [
            exe, "-nostdin", "-loglevel", "error", "-re", "-stream_loop", "-1",
            "-i", str(path), "-f", "null", "-"])
    if failure == "timeout":
        monkeypatch.setattr(media, "DECODE_TIMEOUT", .1)
    request = asyncio.create_task(media.extract_thumbnail(source, deadline=time.monotonic() + 5))
    await asyncio.wait_for(started.wait(), 2)
    if failure == "cancel":
        request.cancel()
        await asyncio.sleep(0)
        request.cancel()
    with pytest.raises(asyncio.CancelledError if failure == "cancel" else media.ProjectThumbnailError):
        await request
    assert processes[0].returncode is not None
    assert media._decode_slots._value == 2


@pytest.mark.asyncio
async def test_global_decode_slots_are_bounded_and_busy(color_video, monkeypatch):
    source = await media.resolve_thumbnail_source(selection(), deadline=time.monotonic() + 5)
    entered, release = 0, asyncio.Event()
    async def blocked(*args):
        nonlocal entered
        entered += 1
        await release.wait()
        return b"result"
    monkeypatch.setattr(media, "_decode", blocked)
    monkeypatch.setattr(media, "SLOT_TIMEOUT", .03)
    requests = [asyncio.create_task(media.extract_thumbnail(source, deadline=time.monotonic() + 5)) for _ in range(2)]
    while entered < 2:
        await asyncio.sleep(0)
    with pytest.raises(media.ProjectThumbnailError) as error:
        await media.extract_thumbnail(source, deadline=time.monotonic() + 5)
    assert error.value.code == "PROJECT_THUMBNAIL_BUSY"
    release.set()
    await asyncio.gather(*requests)
    assert media._decode_slots._value == 2


@pytest.mark.asyncio
async def test_large_real_stdout_is_drained_after_limit_error(color_video, monkeypatch):
    source = await media.resolve_thumbnail_source(selection(), deadline=time.monotonic() + 5)
    processes = []
    original = asyncio.create_subprocess_exec
    async def launch(*args, **kwargs):
        process = await original(*args, **kwargs)
        processes.append(process)
        return process
    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", launch)
    monkeypatch.setattr(media, "thumbnail_arguments", lambda *args: [sys.executable, "-c",
        "import sys,time; sys.stdout.buffer.write(bytes(3000000)); sys.stdout.flush(); time.sleep(30)"])
    request = asyncio.create_task(media.extract_thumbnail(source, deadline=time.monotonic() + 2))
    done, _ = await asyncio.wait({request}, timeout=1)
    if not done:
        # 失败时收敛夹具，避免旧实现的管道挂起影响后续测试。
        await processes[0].stdout.read()
    with pytest.raises(media.ProjectThumbnailError) as error:
        await request
    assert done, "stdout 超限后，杀死进程仍必须排空已暂停的管道"
    assert error.value.code == "PROJECT_THUMBNAIL_DECODE_FAILED"
    assert processes[0].returncode is not None
    assert media._decode_slots._value == 2


@pytest.mark.asyncio
async def test_external_cancel_simultaneous_with_operation_completion_is_preserved():
    async def request():
        caller = asyncio.current_task()
        async def operation():
            caller.cancel()
            return 123
        return await media.within_budget(operation(), time.monotonic() + 1)
    with pytest.raises(asyncio.CancelledError):
        await asyncio.create_task(request())


@pytest.mark.asyncio
async def test_cancel_simultaneous_with_slot_acquisition_returns_slot(color_video, monkeypatch):
    source = await media.resolve_thumbnail_source(selection(), deadline=time.monotonic() + 5)
    caller = None
    class CancellingSemaphore(asyncio.Semaphore):
        async def acquire(self):
            result = await super().acquire()
            caller.cancel()
            return result
    slots = CancellingSemaphore(2)
    monkeypatch.setattr(media, "_decode_slots", slots)
    async def request():
        return await media.extract_thumbnail(source, deadline=time.monotonic() + 5)
    caller = asyncio.create_task(request())
    with pytest.raises(asyncio.CancelledError):
        await caller
    assert slots._value == 2
