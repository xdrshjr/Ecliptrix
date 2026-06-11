"""
Tests for video thumbnail generation hardening
(local-upload-video-thumbnail-fix §3.2 C, file change plan #11).

Covers:
  (a) a video whose ``format.duration`` is missing (only a per-stream duration)
      still produces a poster — the generation is no longer gated on
      ``duration is not None``;
  (b) when ffmpeg fails (non-zero return) the function returns
      ``thumbnail_url is None`` without raising;
  (c) a generated ``thumbnail_url`` is served under
      ``/api/storage/files/static/video/thumbnails/``;
  (d) RV-4: a known-short (<1s) video seeks at ``min(duration, 1.0)`` rather
      than past the last frame.

运行测试：
pytest tests/test_storage_video_thumbnail.py -v
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import app.services.storage_service as storage_module
from app.services.storage_service import StorageService


@pytest.fixture
def video_storage_svc(storage_root):
    """A StorageService whose ``settings`` stay patched for the whole test.

    The shared ``storage_svc`` fixture only patches ``settings`` during
    construction; ``upload_video_file`` reads ``settings.upload.thumbnail.*`` at
    call time, so we keep the patch active via ``yield``.
    """
    with patch("app.services.storage_service.settings") as mock_settings:
        mock_settings.storage = MagicMock()
        mock_settings.storage.root = str(storage_root)
        mock_settings.storage.max_file_size = 524288000
        mock_settings.storage.allowed_video_types = ["video/mp4"]
        mock_settings.storage.allowed_audio_types = ["audio/mpeg"]
        mock_settings.storage.allowed_image_types = ["image/png", "image/jpeg"]
        mock_settings.upload.thumbnail.thumbnail_max_width = 320
        mock_settings.upload.thumbnail.thumbnail_quality = 2
        svc = StorageService()
        yield svc


def _is_ffprobe(cmd) -> bool:
    return "-show_streams" in cmd or "-show_format" in cmd


def _make_fake_run(
    *,
    probe_format: dict,
    ffmpeg_returncode: int,
    create_poster: bool,
    calls: list,
):
    """Build a ``subprocess.run`` replacement that fakes ffprobe + ffmpeg.

    ``calls`` records every argv so tests can assert the ffmpeg seek offset.
    """

    def fake_run(cmd, **_kwargs):
        calls.append([str(c) for c in cmd])
        result = MagicMock()
        if _is_ffprobe(cmd):
            result.returncode = 0
            result.stdout = json.dumps({
                "streams": [{"codec_type": "video", "width": 640, "height": 480}],
                "format": probe_format,
            })
            result.stderr = ""
            return result
        # ffmpeg branch
        result.returncode = ffmpeg_returncode
        result.stderr = b"" if ffmpeg_returncode == 0 else b"boom"
        if create_poster and ffmpeg_returncode == 0:
            out_path = Path(cmd[-1])
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(b"\xff\xd8\xff\xe0fakejpeg")
        return result

    return fake_run


def _ffmpeg_seek(calls) -> str:
    """Return the ``-ss`` value from the recorded ffmpeg argv."""
    for cmd in calls:
        if "-vframes" in cmd and "-ss" in cmd:
            return cmd[cmd.index("-ss") + 1]
    raise AssertionError("no ffmpeg -ss invocation recorded")


@pytest.mark.asyncio
async def test_poster_generated_without_format_duration(video_storage_svc, monkeypatch):
    """(a)+(c) Missing format.duration still yields a poster URL under the
    thumbnails mount."""
    calls: list = []
    fake_run = _make_fake_run(
        probe_format={},  # no "duration" key
        ffmpeg_returncode=0,
        create_poster=True,
        calls=calls,
    )
    monkeypatch.setattr(storage_module.subprocess, "run", fake_run)

    result = await video_storage_svc.upload_video_file(
        file_data=b"\x00\x00\x00\x18ftypmp42rest-of-bytes",
        filename="clip.mp4",
        content_type="video/mp4",
        user_id="u1",
    )

    assert result["success"] is True
    assert result["duration"] is None  # ffprobe gave no format.duration
    assert result["thumbnail_url"] is not None
    assert result["thumbnail_url"].startswith(
        "/api/storage/files/static/video/thumbnails/"
    )
    # Unknown duration → seek defaults to 1.0s.
    assert _ffmpeg_seek(calls) == "1.0"


@pytest.mark.asyncio
async def test_thumbnail_none_when_ffmpeg_fails(video_storage_svc, monkeypatch):
    """(b) ffmpeg failure → thumbnail_url is None and no exception is raised."""
    calls: list = []
    fake_run = _make_fake_run(
        probe_format={"duration": "12.5"},
        ffmpeg_returncode=1,
        create_poster=False,
        calls=calls,
    )
    monkeypatch.setattr(storage_module.subprocess, "run", fake_run)

    result = await video_storage_svc.upload_video_file(
        file_data=b"\x00\x00\x00\x18ftypmp42rest-of-bytes",
        filename="clip.mp4",
        content_type="video/mp4",
        user_id="u1",
    )

    assert result["success"] is True
    assert result["thumbnail_url"] is None


@pytest.mark.asyncio
async def test_short_video_seeks_within_bounds(video_storage_svc, monkeypatch):
    """(d) RV-4: a 0.5s video seeks at min(duration, 1.0) == 0.5, not 1.0."""
    calls: list = []
    fake_run = _make_fake_run(
        probe_format={"duration": "0.5"},
        ffmpeg_returncode=0,
        create_poster=True,
        calls=calls,
    )
    monkeypatch.setattr(storage_module.subprocess, "run", fake_run)

    result = await video_storage_svc.upload_video_file(
        file_data=b"\x00\x00\x00\x18ftypmp42rest-of-bytes",
        filename="short.mp4",
        content_type="video/mp4",
        user_id="u1",
    )

    assert result["success"] is True
    assert result["thumbnail_url"] is not None
    assert _ffmpeg_seek(calls) == "0.5"
