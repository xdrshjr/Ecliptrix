"""使用真实 FFmpeg，防止单帧、伪 MP4 或损坏视频通过。"""
import asyncio
import shutil
import subprocess

import pytest


@pytest.fixture
def video_file(tmp_path):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("需要真实 ffmpeg 和 ffprobe")
    path = tmp_path / "portrait.mp4"
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
        "testsrc2=size=64x96:rate=10:duration=1.2", "-c:v", "libx264", "-y", str(path),
    ], check=True, capture_output=True)
    return path


@pytest.mark.asyncio
async def test_real_portrait_has_measured_dimensions_and_float_duration(video_file):
    from app.services.ark_video_artifacts import validate_video
    metadata = await validate_video(video_file)
    assert (metadata["width"], metadata["height"]) == (64, 96)
    assert 1 < metadata["duration"] < 1.5


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [b"", b"<html>error</html>", b"not-an-mp4"])
async def test_rejects_fake_video(tmp_path, content):
    from app.services.ark_video_artifacts import validate_video
    from app.services.credential_errors import VideoError
    path = tmp_path / "fake.mp4"
    path.write_bytes(content)
    with pytest.raises(VideoError) as exc:
        await validate_video(path)
    assert exc.value.code == "invalid_video_artifact"


@pytest.mark.asyncio
async def test_single_frame_mp4_is_rejected(video_file):
    from app.services.ark_video_artifacts import validate_video
    from app.services.credential_errors import VideoError
    single = video_file.with_name("single.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(video_file), "-frames:v", "1", "-y", str(single)], check=True)
    with pytest.raises(VideoError):
        await validate_video(single)


@pytest.mark.asyncio
async def test_truncated_tail_is_rejected(video_file):
    from app.services.ark_video_artifacts import validate_video
    from app.services.credential_errors import VideoError
    data = video_file.read_bytes()
    video_file.write_bytes(data[:-400])
    with pytest.raises(VideoError):
        await validate_video(video_file)


@pytest.mark.asyncio
async def test_subprocess_timeout_kills_and_waits(monkeypatch):
    from app.services.ark_video_artifacts import run_media_process
    from app.services.credential_errors import VideoError
    import sys
    with pytest.raises(VideoError):
        await run_media_process([sys.executable, "-c", "import time; time.sleep(30)"], 0.05)


@pytest.mark.asyncio
async def test_audio_only_mp4_is_rejected(video_file):
    from app.services.ark_video_artifacts import validate_video
    from app.services.credential_errors import VideoError
    audio = video_file.with_name("audio.mp4")
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=400:duration=1", "-vn", "-c:a", "aac", "-y", str(audio)], check=True)
    with pytest.raises(VideoError):
        await validate_video(audio)


@pytest.mark.asyncio
async def test_audio_with_attached_cover_is_not_a_video(video_file):
    from PIL import Image
    from app.services.ark_video_artifacts import validate_video
    from app.services.credential_errors import VideoError
    cover = video_file.with_name("cover.jpg")
    Image.new("RGB", (300, 300), "red").save(cover)
    target = video_file.with_name("covered-audio.mp4")
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=400:duration=1", "-i", str(cover), "-map", "0:a", "-map", "1:v", "-c:a", "aac", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic", "-y", str(target)], check=True)
    with pytest.raises(VideoError):
        await validate_video(target)


@pytest.mark.asyncio
async def test_interrupted_download_never_reuses_partial_file(monkeypatch, tmp_path):
    from unittest.mock import AsyncMock
    from app.services.ark_video_artifacts import _download
    from app.services.web_research.safe_http_client import SafeHttpClient
    from app.services.credential_errors import VideoError
    target = tmp_path / "task.mp4"
    old_part = tmp_path / "task.mp4.old.part"
    old_part.write_bytes(b"incomplete")
    fetch = AsyncMock(side_effect=OSError("broken stream"))
    monkeypatch.setattr(SafeHttpClient, "fetch", fetch)
    with pytest.raises(VideoError) as error:
        await _download("https://example.com/video.mp4", target)
    assert error.value.code == "video_download_failed"
    assert fetch.await_count == 2 and not target.exists()
    assert list(tmp_path.iterdir()) == [old_part]
