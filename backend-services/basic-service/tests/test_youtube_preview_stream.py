"""Unit tests for the YouTube left-panel preview stream endpoint.

Spec: docs/plans/youtube-preview-stream-proxy/spec.md (v2)

The video editor's search modal used to preview a selected YouTube result via an
``<iframe youtube.com/embed>`` which tripped YouTube's anti-bot "Sign in to
confirm you're not a bot" challenge. The fix routes preview playback through a
backend endpoint that resolves a progressive (combined audio+video) MP4 direct
URL with yt-dlp and proxies the bytes back (Range 206 aware), so the browser
only ever talks to our own origin.

These tests lock the contract at the network boundary — the external YouTube
edges (yt-dlp / httpx) are stubbed, per the project convention of isolating
uncontrollable external dependencies rather than mocking high-risk internal
paths.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models.youtube_models import YoutubePreviewStream
from app.routers import youtube_router
from app.services.youtube_service import (
    YouTubeService,
    YoutubePreviewError,
    youtube_service,
)


# ---------------------------------------------------------------------------
# Fakes for the httpx upstream boundary
# ---------------------------------------------------------------------------


class _FakeUpstream:
    """Stand-in for an ``httpx.Response`` opened with ``stream=True``."""

    def __init__(self, status_code: int, headers: dict, chunks: list[bytes]):
        self.status_code = status_code
        self.headers = headers
        self._chunks = chunks
        self.closed = False

    async def aiter_bytes(self, chunk_size: int):
        for chunk in self._chunks:
            yield chunk

    async def aclose(self) -> None:
        self.closed = True


class _FakeClient:
    """Stand-in for an ``httpx.AsyncClient``."""

    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


def _build_app() -> TestClient:
    app = FastAPI()
    app.include_router(youtube_router.router, prefix="/api")
    return TestClient(app)


def _sample_stream() -> YoutubePreviewStream:
    return YoutubePreviewStream(
        url="https://r1.googlevideo.com/videoplayback?itag=18",
        http_headers={"User-Agent": "web-client-ua"},
        content_type="video/mp4",
        ext="mp4",
        filesize=1000,
        expire_at=9_999_999_999.0,
    )


# ---------------------------------------------------------------------------
# video_id validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_id", ["", "../etc", "short", "toolongvideoid", "bad id!"])
def test_rejects_invalid_video_id(bad_id: str) -> None:
    """Non-11-char / traversal / malformed ids are rejected with 400."""
    client = _build_app()
    resp = client.get("/api/youtube/preview/stream", params={"video_id": bad_id})
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# progressive format selection
# ---------------------------------------------------------------------------


def test_picks_progressive_mp4_format_prefers_720() -> None:
    """From a DASH+progressive mix, the combined mp4 (itag 22, <=720) is picked."""
    formats = [
        # DASH video-only (must be ignored — vcodec set but acodec none)
        {"format_id": "137", "ext": "mp4", "acodec": "none", "vcodec": "avc1",
         "height": 1080, "url": "https://g/dash-video"},
        # DASH audio-only (must be ignored)
        {"format_id": "140", "ext": "m4a", "acodec": "mp4a", "vcodec": "none",
         "url": "https://g/dash-audio"},
        # progressive 360p
        {"format_id": "18", "ext": "mp4", "acodec": "mp4a", "vcodec": "avc1",
         "height": 360, "url": "https://g/prog360",
         "http_headers": {"User-Agent": "web"}},
        # progressive 720p
        {"format_id": "22", "ext": "mp4", "acodec": "mp4a", "vcodec": "avc1",
         "height": 720, "url": "https://g/prog720",
         "http_headers": {"User-Agent": "web"}},
    ]
    fmt = youtube_service._pick_progressive_format(formats)
    assert fmt is not None
    assert fmt["format_id"] == "22"
    assert fmt["acodec"] != "none" and fmt["vcodec"] != "none"


def test_picks_itag18_when_only_360_available() -> None:
    """When only the 360p progressive exists it becomes the pick (秒开兜底)."""
    formats = [
        {"format_id": "137", "ext": "mp4", "acodec": "none", "vcodec": "avc1",
         "height": 1080, "url": "https://g/dash-video"},
        {"format_id": "18", "ext": "mp4", "acodec": "mp4a", "vcodec": "avc1",
         "height": 360, "url": "https://g/prog360"},
    ]
    fmt = youtube_service._pick_progressive_format(formats)
    assert fmt is not None
    assert fmt["format_id"] == "18"


def test_returns_none_when_no_progressive_format() -> None:
    """Live/DASH-only videos have no combined format → None (endpoint 502s)."""
    formats = [
        {"format_id": "137", "ext": "mp4", "acodec": "none", "vcodec": "avc1",
         "height": 1080, "url": "https://g/dash-video"},
        {"format_id": "140", "ext": "m4a", "acodec": "mp4a", "vcodec": "none",
         "url": "https://g/dash-audio"},
    ]
    assert youtube_service._pick_progressive_format(formats) is None


# ---------------------------------------------------------------------------
# Range → 206 passthrough
# ---------------------------------------------------------------------------


def test_range_request_returns_206(monkeypatch) -> None:
    """A Range request proxies the upstream 206 + Content-Range/Accept-Ranges."""
    monkeypatch.setattr(
        youtube_router.youtube_service,
        "resolve_preview_stream",
        lambda video_id, *a, **k: _sample_stream(),
    )

    async def _fake_open(stream, range_header):
        assert range_header == "bytes=0-3"
        upstream = _FakeUpstream(
            206,
            {
                "content-type": "video/mp4",
                "content-length": "4",
                "content-range": "bytes 0-3/1000",
            },
            [b"data"],
        )
        return _FakeClient(), upstream

    monkeypatch.setattr(youtube_router, "_open_preview_upstream", _fake_open)

    client = _build_app()
    resp = client.get(
        "/api/youtube/preview/stream",
        params={"video_id": "abcdefghijk"},
        headers={"Range": "bytes=0-3"},
    )

    assert resp.status_code == 206, resp.text
    assert resp.headers["Content-Range"] == "bytes 0-3/1000"
    assert resp.headers["Accept-Ranges"] == "bytes"
    assert resp.headers["Cache-Control"] == "no-store"
    assert resp.content == b"data"


def test_plain_get_returns_200(monkeypatch) -> None:
    """No-Range request proxies the upstream 200 body."""
    monkeypatch.setattr(
        youtube_router.youtube_service,
        "resolve_preview_stream",
        lambda video_id, *a, **k: _sample_stream(),
    )

    async def _fake_open(stream, range_header):
        return _FakeClient(), _FakeUpstream(
            200, {"content-type": "video/mp4", "content-length": "5"}, [b"hello"]
        )

    monkeypatch.setattr(youtube_router, "_open_preview_upstream", _fake_open)

    client = _build_app()
    resp = client.get(
        "/api/youtube/preview/stream", params={"video_id": "abcdefghijk"}
    )

    assert resp.status_code == 200, resp.text
    assert resp.headers["Accept-Ranges"] == "bytes"
    assert resp.content == b"hello"


# ---------------------------------------------------------------------------
# resolve failure → 502
# ---------------------------------------------------------------------------


def test_resolve_failure_returns_502(monkeypatch) -> None:
    """A yt-dlp failure (e.g. anti-bot at the yt-dlp layer) surfaces as 502."""

    def _boom(video_id, *a, **k):
        raise YoutubePreviewError("Sign in to confirm you're not a bot")

    monkeypatch.setattr(
        youtube_router.youtube_service, "resolve_preview_stream", _boom
    )

    client = _build_app()
    resp = client.get(
        "/api/youtube/preview/stream", params={"video_id": "abcdefghijk"}
    )
    assert resp.status_code == 502, resp.text


# ---------------------------------------------------------------------------
# TTL cache reuse & expired-upstream re-resolve
# ---------------------------------------------------------------------------


class _FakeYoutubeDL:
    """Minimal ``yt_dlp.YoutubeDL`` context-manager stub with a call counter."""

    calls = 0

    def __init__(self, opts):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=False):
        _FakeYoutubeDL.calls += 1
        return {
            "id": "abcdefghijk",
            "http_headers": {"User-Agent": "top-level"},
            "formats": [
                {"format_id": "18", "ext": "mp4", "acodec": "mp4a",
                 "vcodec": "avc1", "height": 360, "url": "https://g/prog360",
                 "http_headers": {"User-Agent": "format-level"}},
            ],
        }


def test_ttl_cache_reuses_resolution(monkeypatch) -> None:
    """Within the TTL, a second resolve reuses the cache (no extra extract_info)."""
    import app.services.youtube_service as yt_svc_mod

    _FakeYoutubeDL.calls = 0
    monkeypatch.setattr(yt_svc_mod.yt_dlp, "YoutubeDL", _FakeYoutubeDL)

    svc = YouTubeService()

    first = svc.resolve_preview_stream("abcdefghijk")
    second = svc.resolve_preview_stream("abcdefghijk")

    assert _FakeYoutubeDL.calls == 1
    assert first.url == second.url
    # P1-1: headers come from the selected format, not the top-level desktop UA.
    assert first.http_headers.get("User-Agent") == "format-level"

    # force_refresh bypasses the cache and re-resolves exactly once more.
    svc.resolve_preview_stream("abcdefghijk", force_refresh=True)
    assert _FakeYoutubeDL.calls == 2


def test_expired_upstream_reresolves_once(monkeypatch) -> None:
    """A first upstream 403 invalidates the cache and re-resolves once, then 200s."""
    resolve_calls = {"n": 0}

    def _resolve(video_id, force_refresh=False):
        resolve_calls["n"] += 1
        return _sample_stream()

    monkeypatch.setattr(
        youtube_router.youtube_service, "resolve_preview_stream", _resolve
    )
    monkeypatch.setattr(
        youtube_router.youtube_service, "invalidate_preview_cache", lambda vid: None
    )

    open_calls = {"n": 0}

    async def _fake_open(stream, range_header):
        open_calls["n"] += 1
        if open_calls["n"] == 1:
            return _FakeClient(), _FakeUpstream(403, {}, [])
        return _FakeClient(), _FakeUpstream(
            200, {"content-type": "video/mp4"}, [b"ok"]
        )

    monkeypatch.setattr(youtube_router, "_open_preview_upstream", _fake_open)

    client = _build_app()
    resp = client.get(
        "/api/youtube/preview/stream", params={"video_id": "abcdefghijk"}
    )

    assert resp.status_code == 200, resp.text
    assert resp.content == b"ok"
    assert open_calls["n"] == 2  # first 403, second success
    assert resolve_calls["n"] == 2  # initial + one forced re-resolve


def test_persistent_upstream_403_returns_502(monkeypatch) -> None:
    """If the re-resolved direct URL still 403s, the endpoint reports 502."""
    monkeypatch.setattr(
        youtube_router.youtube_service,
        "resolve_preview_stream",
        lambda video_id, *a, **k: _sample_stream(),
    )
    monkeypatch.setattr(
        youtube_router.youtube_service, "invalidate_preview_cache", lambda vid: None
    )

    async def _fake_open(stream, range_header):
        return _FakeClient(), _FakeUpstream(403, {}, [])

    monkeypatch.setattr(youtube_router, "_open_preview_upstream", _fake_open)

    client = _build_app()
    resp = client.get(
        "/api/youtube/preview/stream", params={"video_id": "abcdefghijk"}
    )
    assert resp.status_code == 502, resp.text
