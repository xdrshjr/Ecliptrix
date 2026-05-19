"""Regression tests for ``app.security.url_guard`` and its integrations.

Covers spec 03 (external-process injection) acceptance criteria:

* unit-level: ``validate_external_url`` + ``validate_local_path_for_ffmpeg``
  reject SSRF / file-read attack vectors and accept legitimate inputs.
* integration: HTTP routes that previously forwarded user-controlled URLs
  to yt-dlp / FFmpeg / media-proxy now return 4xx for the same vectors.

Note: tests deliberately monkey-patch ``socket.getaddrinfo`` rather than
relying on live DNS so the suite stays hermetic and works offline.
"""

from __future__ import annotations

import socket
from pathlib import Path

import pytest

from app.security.url_guard import (
    FFMPEG_LOCAL_PROTOCOL_WHITELIST,
    FFMPEG_REMOTE_PROTOCOL_WHITELIST,
    URLGuardError,
    validate_external_url,
    validate_local_path_for_ffmpeg,
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _fake_getaddrinfo_factory(addresses):
    """Return a getaddrinfo stub that yields the given IPv4/IPv6 strings."""

    def _stub(host, port=None, *args, **kwargs):  # noqa: ARG001
        out = []
        for addr in addresses:
            family = socket.AF_INET6 if ":" in addr else socket.AF_INET
            out.append((family, socket.SOCK_STREAM, 0, "", (addr, port or 0)))
        return out

    return _stub


@pytest.fixture
def public_dns(monkeypatch):
    """Pretend every hostname resolves to a public IPv4 address."""
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        _fake_getaddrinfo_factory(["93.184.216.34"]),  # example.com address
    )
    yield


@pytest.fixture
def private_dns(monkeypatch):
    """Pretend every hostname resolves to a private IPv4 address."""
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        _fake_getaddrinfo_factory(["10.0.0.5"]),
    )
    yield


# ---------------------------------------------------------------------------
# validate_external_url — positive cases
# ---------------------------------------------------------------------------


def test_validate_url_accepts_public_https(public_dns):
    out = validate_external_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert out.startswith("https://www.youtube.com/watch")


def test_validate_url_accepts_pexels_cdn_https(public_dns):
    out = validate_external_url("https://videos.pexels.com/video-files/853874/853874-hd_1280_720_25fps.mp4")
    assert out.startswith("https://videos.pexels.com/")


def test_validate_url_preserves_query_string(public_dns):
    raw = "https://example.com/api?token=abc&id=42"
    assert validate_external_url(raw) == raw


# ---------------------------------------------------------------------------
# validate_external_url — attack vectors
# ---------------------------------------------------------------------------


def test_validate_url_rejects_file_scheme():
    with pytest.raises(URLGuardError):
        validate_external_url("file:///etc/passwd")


def test_validate_url_rejects_rtsp_scheme():
    with pytest.raises(URLGuardError):
        validate_external_url("rtsp://example.com/stream")


def test_validate_url_rejects_gopher_scheme():
    with pytest.raises(URLGuardError):
        validate_external_url("gopher://example.com/")


def test_validate_url_rejects_data_scheme():
    with pytest.raises(URLGuardError):
        validate_external_url("data:text/plain,hello")


def test_validate_url_rejects_localhost_literal():
    with pytest.raises(URLGuardError):
        validate_external_url("http://localhost:8000/api/admin/x")


def test_validate_url_rejects_aws_metadata_literal():
    with pytest.raises(URLGuardError):
        validate_external_url(
            "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
        )


def test_validate_url_rejects_gcp_metadata_host():
    with pytest.raises(URLGuardError):
        validate_external_url(
            "http://metadata.google.internal/computeMetadata/v1/instance/"
        )


def test_validate_url_rejects_userinfo_reflection():
    with pytest.raises(URLGuardError):
        validate_external_url("http://user:pass@example.com/")


def test_validate_url_rejects_private_resolution(private_dns):
    # Public-looking hostname but DNS resolves to RFC1918 — classic
    # SSRF dodge with attacker-controlled DNS.
    with pytest.raises(URLGuardError):
        validate_external_url("http://internal.example.com/")


def test_validate_url_rejects_ipv6_loopback():
    with pytest.raises(URLGuardError):
        validate_external_url("http://[::1]/")


def test_validate_url_rejects_ipv4_loopback_literal():
    with pytest.raises(URLGuardError):
        validate_external_url("http://127.0.0.1:8000/admin")


def test_validate_url_rejects_empty():
    with pytest.raises(URLGuardError):
        validate_external_url("")


def test_validate_url_rejects_oversized():
    with pytest.raises(URLGuardError):
        validate_external_url("https://example.com/" + "a" * 5000)


def test_validate_url_dev_override_allows_private(monkeypatch, private_dns):
    monkeypatch.setenv("URL_GUARD_ALLOW_PRIVATE", "1")
    out = validate_external_url("http://internal.example.com/path")
    assert out.startswith("http://internal.example.com/")


# ---------------------------------------------------------------------------
# validate_local_path_for_ffmpeg
# ---------------------------------------------------------------------------


def test_validate_local_path_accepts_file_inside_root(tmp_path):
    sub = tmp_path / "static" / "uploads" / "audio"
    sub.mkdir(parents=True)
    f = sub / "clip.mp3"
    f.write_bytes(b"\x00\x01")
    out = validate_local_path_for_ffmpeg(str(f), [tmp_path])
    assert Path(out) == f.resolve()


def test_validate_local_path_rejects_file_scheme(tmp_path):
    with pytest.raises(URLGuardError):
        validate_local_path_for_ffmpeg("file:///etc/passwd", [tmp_path])


def test_validate_local_path_rejects_http_scheme(tmp_path):
    with pytest.raises(URLGuardError):
        validate_local_path_for_ffmpeg("http://evil.example.com/x", [tmp_path])


def test_validate_local_path_rejects_absolute_outside_root(tmp_path):
    outside = tmp_path.parent / "definitely-not-here.txt"
    with pytest.raises(URLGuardError):
        validate_local_path_for_ffmpeg(str(outside), [tmp_path], must_exist=False)


def test_validate_local_path_rejects_traversal(tmp_path):
    sub = tmp_path / "inside"
    sub.mkdir()
    (sub / "file.txt").write_text("ok")
    # ``../../etc/passwd`` resolves outside the allowed root.
    with pytest.raises(URLGuardError):
        validate_local_path_for_ffmpeg(
            str(sub / ".." / ".." / "etc" / "passwd"),
            [sub],
            must_exist=False,
        )


def test_validate_local_path_rejects_nul_byte(tmp_path):
    with pytest.raises(URLGuardError):
        validate_local_path_for_ffmpeg(
            str(tmp_path) + "/foo\x00.mp3", [tmp_path], must_exist=False
        )


def test_validate_local_path_requires_allowed_roots():
    with pytest.raises(URLGuardError):
        validate_local_path_for_ffmpeg("/tmp/x", [], must_exist=False)


# ---------------------------------------------------------------------------
# FFmpeg protocol whitelist constants — guard against typo regressions
# ---------------------------------------------------------------------------


def test_remote_whitelist_excludes_file():
    parts = {p.strip() for p in FFMPEG_REMOTE_PROTOCOL_WHITELIST.split(",")}
    assert "file" not in parts
    assert "http" in parts and "https" in parts


def test_local_whitelist_excludes_http():
    parts = {p.strip() for p in FFMPEG_LOCAL_PROTOCOL_WHITELIST.split(",")}
    assert "http" not in parts and "https" not in parts
    assert "file" in parts


# ---------------------------------------------------------------------------
# Integration — youtube_service should refuse SSRF URLs
# ---------------------------------------------------------------------------


_GUARD_REJECT_HINTS = ("rejected", "block-list", "disallowed", "not allowed")


def _looks_like_guard_rejection(text: str) -> bool:
    """Match the various phrasings url_guard / wrappers may emit."""
    lowered = (text or "").lower()
    return any(hint in lowered for hint in _GUARD_REJECT_HINTS)


def test_youtube_service_get_video_info_rejects_file_scheme():
    # Lazy import — youtube_service has heavy import-time side effects
    # (yt-dlp banner, semaphore init) that we don't want at collection.
    from app.services.youtube_service import YouTubeService
    from app.models.youtube_models import YoutubeVideoInfoRequest

    svc = YouTubeService()
    resp = svc.get_video_info(YoutubeVideoInfoRequest(url="file:///etc/passwd"))
    assert resp.success is False
    assert _looks_like_guard_rejection(resp.error or "")


def test_youtube_service_download_rejects_metadata_ip():
    from app.services.youtube_service import YouTubeService
    from app.models.youtube_models import YoutubeVideoDownloadRequest

    svc = YouTubeService()
    resp = svc.download_video(
        YoutubeVideoDownloadRequest(url="http://169.254.169.254/latest/meta-data/")
    )
    assert resp.success is False
    assert _looks_like_guard_rejection(resp.error or "")


# ---------------------------------------------------------------------------
# Integration — FastAPI routes return 4xx for SSRF inputs
# ---------------------------------------------------------------------------


@pytest.fixture
def test_client():
    """Mount only the routers under test on a fresh FastAPI app.

    The production ``app.main:app`` runs a database lifespan on startup,
    which is unavailable in CI. Since these tests only exercise the
    request-time url_guard layer (before any router hits a service that
    needs the DB), we can isolate the relevant routers on a lightweight
    app and skip the lifespan entirely.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routers.media_proxy_router import router as media_router
    from app.routers.preview_proxy_router import router as preview_router

    iso_app = FastAPI()
    iso_app.include_router(media_router, prefix="/api")
    iso_app.include_router(preview_router, prefix="/api")

    with TestClient(iso_app) as c:
        yield c


def test_media_proxy_rejects_file_url(test_client):
    resp = test_client.get("/api/media/proxy", params={"u": "file:///etc/passwd"})
    assert resp.status_code in (400, 403), resp.text
    body = resp.json()
    # Detail can be either a string or dict depending on how FastAPI wraps it.
    detail = body.get("detail")
    assert detail is not None
    assert _looks_like_guard_rejection(str(detail))


def test_media_proxy_rejects_loopback(test_client):
    resp = test_client.get(
        "/api/media/proxy", params={"u": "http://127.0.0.1:8000/admin"}
    )
    assert resp.status_code in (400, 403), resp.text
    assert _looks_like_guard_rejection(resp.text)


def test_preview_proxy_rejects_file_url(test_client):
    resp = test_client.post(
        "/api/media/preview-proxy",
        json={"source_url": "file:///etc/passwd"},
    )
    assert resp.status_code == 400, resp.text
    body = resp.json()
    text = str(body).lower()
    assert _looks_like_guard_rejection(text) or "validation" in text
