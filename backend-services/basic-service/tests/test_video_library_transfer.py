"""Trusted API video transfers retain URL guards without webpage robots checks."""

import subprocess
from pathlib import Path

import pytest


VIDEO_URL = "https://videos.pexels.com/video-files/123/clip.mp4"


@pytest.fixture(scope="module")
def video_bytes(tmp_path_factory):
    path = tmp_path_factory.mktemp("provider-video") / "sample.mp4"
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
         "-i", "color=c=blue:s=32x48:r=10", "-t", "0.5", "-c:v", "libx264",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)],
        capture_output=True, timeout=15,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    return path.read_bytes()


def install_transport(monkeypatch, transport):
    from app.services import video_library_transfer as module
    from app.services.web_research.safe_http_client import SafeHttpClient
    client = SafeHttpClient(transport=transport, proxy_settings={"mode": "direct"})
    monkeypatch.setattr(module, "SafeHttpClient", lambda **_kwargs: client)
    return module, client


@pytest.mark.asyncio
async def test_api_video_download_ignores_robots_and_has_no_credentials(
        monkeypatch, tmp_path, video_bytes):
    from app.models.web_research_models import WebResearchError
    from app.services.web_research.safe_http_client import HttpResult, FetchPolicy, RequestSpec
    requested = []

    async def transport(policy, request):
        requested.append(request)
        if request.url.endswith("/robots.txt"):
            return HttpResult(request.url, 403, {}, b"")
        assert policy.document is False
        assert not request.headers or "authorization" not in {
            key.lower() for key in request.headers}
        return HttpResult(request.url, 200,
                          {"content-length": str(len(video_bytes))}, video_bytes)

    module, client = install_transport(monkeypatch, transport)
    dest = tmp_path / "download.mp4"
    receipt = await module.download_video(VIDEO_URL, dest, max_bytes=10_000)
    assert dest.read_bytes() == video_bytes
    assert receipt == {"size": len(video_bytes), "width": 32, "height": 48,
                       "duration": 0.5, "format": "mp4"}
    assert [request.url for request in requested] == [VIDEO_URL]
    with pytest.raises(WebResearchError, match="robots_disallowed"):
        await client.fetch(FetchPolicy(), RequestSpec(VIDEO_URL))
    assert [request.url for request in requested] == [
        VIDEO_URL, "https://videos.pexels.com/robots.txt"]


@pytest.mark.asyncio
@pytest.mark.parametrize("url", [
    "https://example.com/clip.mp4", "http://videos.pexels.com/clip.mp4",
    "https://videos.pexels.com.evil.invalid/clip.mp4",
    "https://key:secret@videos.pexels.com/clip.mp4",
    "https://videos.pexels.com:8443/clip.mp4", "https://127.0.0.1/clip.mp4",
])
async def test_untrusted_source_never_fetches(monkeypatch, tmp_path, url):
    calls = []

    async def transport(policy, request):
        calls.append(request.url)
        raise AssertionError("untrusted URL must not be fetched")

    module, _ = install_transport(monkeypatch, transport)
    with pytest.raises(module.VideoTransferError) as error:
        await module.download_video(url, tmp_path / "video.mp4", max_bytes=10_000)
    assert error.value.error_code == "video_source_forbidden"
    assert calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["https://127.0.0.1/clip.mp4",
                                         "https://untrusted.invalid/video.mp4"])
async def test_redirect_cannot_escape_trusted_public_source(
        monkeypatch, tmp_path, target):
    from app.services.web_research.safe_http_client import HttpResult
    calls = []

    async def transport(policy, request):
        calls.append(request.url)
        return HttpResult(request.url, 302, {"location": target}, b"")

    module, _ = install_transport(monkeypatch, transport)
    with pytest.raises(module.VideoTransferError):
        await module.download_video(VIDEO_URL, tmp_path / "video.mp4", max_bytes=10_000)
    assert calls == [VIDEO_URL]


@pytest.mark.asyncio
@pytest.mark.parametrize("status,code,retryable", [
    (401, "video_authentication_failed", False),
    (403, "video_access_denied", False),
    (404, "video_not_found", False),
    (429, "video_rate_limited", True),
    (503, "video_upstream_unavailable", True),
])
async def test_http_failure_is_structured_and_does_not_publish(
        monkeypatch, tmp_path, status, code, retryable):
    from app.services.web_research.safe_http_client import HttpResult

    async def transport(policy, request):
        return HttpResult(request.url, status, {"retry-after": "12"}, b"")

    module, _ = install_transport(monkeypatch, transport)
    dest = tmp_path / "video.mp4"
    with pytest.raises(module.VideoTransferError) as error:
        await module.download_video(VIDEO_URL, dest, max_bytes=10_000)
    assert error.value.error_code == code
    assert error.value.status_code == status
    assert error.value.retryable is retryable
    assert error.value.retry_after == (12 if retryable else None)
    assert not dest.exists()
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("body,headers,limit,code", [
    (b"x" * 11, {}, 10, "video_too_large"),
    (b"", {}, 10_000, "video_empty"),
    (b"1234ftypcorrupt", {}, 10_000, "video_invalid"),
    (b"<html>denied</html>", {}, 10_000, "video_invalid"),
    (b"1234ftypcorrupt", {"content-length": "999"}, 10_000, "video_truncated"),
    (b"1234ftypcorrupt", {"content-length": "999"}, 10, "video_too_large"),
])
async def test_invalid_download_keeps_existing_file_and_removes_part(
        monkeypatch, tmp_path, body, headers, limit, code):
    from app.services.web_research.safe_http_client import HttpResult

    async def transport(policy, request):
        return HttpResult(request.url, 200, headers, body)

    module, _ = install_transport(monkeypatch, transport)
    dest = tmp_path / "video.mp4"
    dest.write_bytes(b"previous validated video")
    with pytest.raises(module.VideoTransferError) as error:
        await module.download_video(VIDEO_URL, dest, max_bytes=limit)
    assert error.value.error_code == code
    assert dest.read_bytes() == b"previous validated video"
    assert list(tmp_path.iterdir()) == [dest]


@pytest.mark.asyncio
async def test_validate_cached_file_probes_real_video(tmp_path, video_bytes):
    from app.services import video_library_transfer as module
    dest = tmp_path / "cached.mp4"
    dest.write_bytes(video_bytes)
    assert (await module.validate_video(dest))["size"] == len(video_bytes)
    dest.write_bytes(b"not a valid media file")
    with pytest.raises(module.VideoTransferError, match="valid MP4 video"):
        await module.validate_video(dest)
    dest.write_bytes(b"")
    with pytest.raises(module.VideoTransferError) as error:
        await module.validate_video(dest)
    assert error.value.error_code == "video_empty"


@pytest.mark.asyncio
async def test_audio_only_mp4_is_not_a_video(tmp_path):
    from app.services import video_library_transfer as module
    dest = tmp_path / "audio.mp4"
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
         "-i", "sine=frequency=440", "-t", "0.2", "-c:a", "aac", str(dest)],
        capture_output=True, timeout=15,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    with pytest.raises(module.VideoTransferError) as error:
        await module.validate_video(dest)
    assert error.value.error_code == "video_invalid"
