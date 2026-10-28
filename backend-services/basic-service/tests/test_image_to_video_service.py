"""Image -> video service against a REAL FFmpeg (skipped when it is missing).

Mirrors ``test_camera_motion_stills.py``: FFmpeg invocation is a high-risk path
that CLAUDE.md forbids mocking, so these tests render actual clips.
"""

import asyncio
import io
import re
import shutil
import statistics
import subprocess
import time
from pathlib import Path

import pytest
from PIL import Image, ImageStat

from app.models import ImageToVideoRequest
from app.services import image_to_video_service as service_module
from app.services.image_to_video_service import ImageToVideoService

FFMPEG = shutil.which("ffmpeg")
needs_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="FFmpeg not installed")


@pytest.fixture
def storage(tmp_path, monkeypatch):
    """STORAGE_ROOT for both the writer (storage_service) and the resolver."""
    from app.config import settings
    from app.services import storage_service as storage_module

    root = tmp_path / "uploads"
    (root / "uploads" / "images").mkdir(parents=True)
    monkeypatch.setattr(storage_module.storage_service, "root", root)
    monkeypatch.setattr(settings.storage, "root", str(root))
    return root


def bright_png(width=800, height=600, orientation=None) -> bytes:
    """A bright, noisy picture: any black bar in the output is unmistakable."""
    image = Image.new("RGB", (width, height), (230, 210, 60))
    pixels = image.load()
    for x in range(0, width, 7):
        for y in range(0, height, 7):
            pixels[x, y] = (250, 90, 200)
    buffer = io.BytesIO()
    if orientation:
        exif = Image.Exif()
        exif[0x0112] = orientation
        image.save(buffer, format="JPEG", exif=exif)
    else:
        image.save(buffer, format="PNG")
    return buffer.getvalue()


def request_for(storage: Path, data: bytes, name="a.png", **fields):
    (storage / "uploads" / "images" / name).write_bytes(data)
    return ImageToVideoRequest(
        storage_key=f"uploads/images/{name}",
        **{"effect": "ken_burns", "duration": 2.0, "max_long_side": 640,
           **fields})


def grab_frame(video: Path, where: str, out: Path) -> Image.Image:
    seek = ["-sseof", "-0.1"] if where == "last" else ["-ss", "0"]
    subprocess.run(
        [FFMPEG, "-v", "error", *seek, "-i", str(video), "-frames:v", "1",
         "-y", str(out)], check=True)
    return Image.open(out).convert("L")


def edge_means(frame: Image.Image, band=4):
    w, h = frame.size
    boxes = {"top": (0, 0, w, band), "bottom": (0, h - band, w, h),
             "left": (0, 0, band, h), "right": (w - band, 0, w, h)}
    return {k: ImageStat.Stat(frame.crop(b)).mean[0]
            for k, b in boxes.items()}


def video_path(storage: Path, response) -> Path:
    return storage / response.storage_key


async def convert(req):
    return await ImageToVideoService().convert_image_to_video(req)


@needs_ffmpeg
@pytest.mark.asyncio
@pytest.mark.parametrize("focus_x", [0.0, 1.0])
async def test_ken_burns_has_no_black_edges_first_or_last_frame(
        storage, tmp_path, focus_x):
    req = request_for(storage, bright_png(), focus_x=focus_x, focus_y=0.5,
                      aspect_ratio="16:9")
    response = await convert(req)
    assert response.success, response
    for where in ("first", "last"):
        frame = grab_frame(video_path(storage, response), where,
                           tmp_path / f"{where}.png")
        assert min(edge_means(frame).values()) > 60, (where, edge_means(frame))


@needs_ffmpeg
@pytest.mark.asyncio
@pytest.mark.parametrize("direction", ["left_to_right", "right_to_left"])
async def test_pan_has_no_black_edges(storage, tmp_path, direction):
    req = request_for(storage, bright_png(), effect="pan",
                      pan_direction=direction, aspect_ratio="16:9")
    response = await convert(req)
    assert response.success, response
    frame = grab_frame(video_path(storage, response), "last", tmp_path / "p.png")
    assert min(edge_means(frame).values()) > 60


@needs_ffmpeg
@pytest.mark.asyncio
async def test_static_with_ratio_change_fills_with_blur_not_black(
        storage, tmp_path):
    req = request_for(storage, bright_png(600, 600), effect="static",
                      aspect_ratio="16:9")
    response = await convert(req)
    assert response.success, response
    frame = grab_frame(video_path(storage, response), "first", tmp_path / "s.png")
    assert min(edge_means(frame).values()) > 30


@needs_ffmpeg
@pytest.mark.asyncio
async def test_second_call_is_reused_without_rendering(storage, monkeypatch):
    req = request_for(storage, bright_png())
    first = await convert(req)
    assert first.success and first.reused is False

    calls = []
    original = service_module._run_ffmpeg

    async def counting(args, timeout):
        calls.append(args)
        return await original(args, timeout)

    monkeypatch.setattr(service_module, "_run_ffmpeg", counting)
    second = await convert(req)
    assert second.success and second.reused is True
    assert second.video_url == first.video_url
    assert not [a for a in calls if "-vf" in a], "must not re-render"


@needs_ffmpeg
@pytest.mark.asyncio
async def test_different_params_get_different_files(storage):
    a = await convert(request_for(storage, bright_png(), duration=2.0))
    b = await convert(request_for(storage, bright_png(), duration=3.0))
    assert a.video_url != b.video_url


@needs_ffmpeg
@pytest.mark.asyncio
async def test_output_lands_in_generated_dir_with_even_size(storage):
    response = await convert(request_for(storage, bright_png(801, 599)))
    assert response.success
    assert response.storage_key.startswith("video/generated/i2v_")
    assert response.video_url == "/api/storage/files/" + response.storage_key
    assert response.width % 2 == 0 and response.height % 2 == 0
    assert (storage / response.storage_key).stat().st_size > 0
    assert response.thumbnail_url is not None


@needs_ffmpeg
@pytest.mark.asyncio
async def test_exif_rotated_portrait_photo_comes_out_portrait(storage):
    # 800x600 pixels tagged "rotate 90 CW" is a portrait photo (600x800).
    response = await convert(request_for(
        storage, bright_png(800, 600, orientation=6), name="p.jpg"))
    assert response.success, response
    assert response.height > response.width


@needs_ffmpeg
@pytest.mark.asyncio
async def test_no_partial_files_are_left_behind(storage):
    await convert(request_for(storage, bright_png()))
    leftovers = [p.name for p in (storage / "video" / "generated").iterdir()
                 if ".part" in p.name]
    assert leftovers == []


@needs_ffmpeg
@pytest.mark.asyncio
async def test_event_loop_stays_responsive_during_a_render(storage):
    """Soft probe: a blocking subprocess.run would freeze these ticks."""
    req = request_for(storage, bright_png(1600, 900), duration=3.0,
                      max_long_side=1280)
    delays = []

    async def probe():
        for _ in range(5):
            began = time.perf_counter()
            await asyncio.sleep(0.05)
            delays.append(time.perf_counter() - began - 0.05)
            await asyncio.sleep(0.1)

    response, _ = await asyncio.gather(convert(req), probe())
    assert response.success
    assert statistics.median(delays) < 0.5


def test_service_module_has_no_blocking_primitives():
    source = Path(service_module.__file__).read_text(encoding="utf-8")
    assert not re.search(r"subprocess\.run|\brequests\b", source)


@pytest.mark.asyncio
async def test_missing_ffmpeg_reports_a_stable_code(storage, monkeypatch):
    monkeypatch.setattr(service_module, "_ffmpeg_path_cache", None)
    monkeypatch.setattr(service_module.shutil, "which", lambda _name: None)
    response = await convert(request_for(storage, bright_png()))
    assert response.success is False
    assert response.error_code == "FFMPEG_UNAVAILABLE"


@needs_ffmpeg
@pytest.mark.asyncio
async def test_ffmpeg_timeout_kills_the_process_and_reports_queue_timeout(
        storage, monkeypatch):
    original = service_module._run_ffmpeg

    async def hurried(args, timeout):
        return await original(args, 0.001)

    monkeypatch.setattr(service_module, "_run_ffmpeg", hurried)
    response = await convert(request_for(storage, bright_png()))
    assert response.success is False
    assert response.error_code == "QUEUE_TIMEOUT"
    generated = storage / "video" / "generated"
    assert not generated.exists() or not list(generated.glob("*.mp4"))


@needs_ffmpeg
@pytest.mark.asyncio
async def test_browser_blob_images_convert_through_base64(storage):
    """The material panel sends blob images as base64 (human path, AC-17)."""
    import base64

    payload = base64.b64encode(bright_png(640, 480)).decode()
    response = await convert(ImageToVideoRequest(
        image_data=payload, effect="static", duration=1.0, max_long_side=480))
    assert response.success, response
    assert (storage / response.storage_key).stat().st_size > 0


@needs_ffmpeg
@pytest.mark.asyncio
async def test_same_origin_url_converts_like_a_storage_key(storage):
    """Legacy callers pass /api/storage/files/... as image_url (D2 fix)."""
    (storage / "uploads" / "images" / "z.png").write_bytes(bright_png(640, 480))
    by_url = await convert(ImageToVideoRequest(
        image_url="/api/storage/files/uploads/images/z.png",
        effect="static", duration=1.0, max_long_side=480))
    by_key = await convert(ImageToVideoRequest(
        storage_key="uploads/images/z.png",
        effect="static", duration=1.0, max_long_side=480))
    assert by_url.success and by_key.success
    assert by_url.video_url == by_key.video_url
    assert by_key.reused is True
