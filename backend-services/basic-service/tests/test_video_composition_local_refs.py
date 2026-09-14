from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.models import VideoCompositionItem, VideoCompositionRequest
from app.security.url_guard import URLGuardError
from app.services import video_composition_service as composition_module
from app.services.local_media_resolver import (
    LocalMediaResolveError,
    resolve_media_reference,
)
from app.services.video_composition_service import (
    VideoCompositionService,
    _is_loopback_local_reference,
    validate_external_url,
)
from tests.composition_harness import (
    MODULE,
    FakeFfmpeg,
    composing,
    composition_request,
    make_service,
    media_file,
)


def _audio_item(url: str) -> dict:
    return {
        "id": "a1",
        "name": "loopback.mp3",
        "url": url,
        "start_time": 0.0,
        "duration": 5.0,
        "track_id": "t-audio",
    }


def _video_item(url: str) -> dict:
    return {
        "id": "v1",
        "name": "loopback.mp4",
        "url": url,
        "start_time": 0.0,
        "duration": 5.0,
        "track_id": "t-video",
    }


def _request(*, video_url: str, audio_url: str | None = None) -> VideoCompositionRequest:
    audio_items = [_audio_item(audio_url)] if audio_url else []
    return VideoCompositionRequest(
        task_id="repro",
        video_items=[_video_item(video_url)],
        audio_items=audio_items,
        total_duration=5.0,
        output_fps=30,
        output_format="mp4",
    )


def test_loopback_local_reference_is_detected_for_known_prefixes():
    assert _is_loopback_local_reference(
        "http://127.0.0.1:18320/api/storage/files/video/local.mp4"
    )
    assert _is_loopback_local_reference(
        "http://localhost:3000/api/audio/generated/seg.mp3"
    )
    # Non-loopback host → not exempt.
    assert not _is_loopback_local_reference(
        "https://cdn.example.com/api/storage/files/video/local.mp4"
    )
    # Loopback host but a non-media route → not exempt.
    assert not _is_loopback_local_reference("http://127.0.0.1:18320/admin")


def test_external_guard_rejects_loopback_url_without_exemption():
    """Pins the bug: without the exemption a loopback same-origin URL is
    rejected by the SSRF guard (round-2 path ②, ``_is_unsafe_ip`` loopback)."""
    with pytest.raises(URLGuardError):
        validate_external_url(
            "http://127.0.0.1:18320/api/storage/files/audio/local.mp3"
        )


def test_guard_request_urls_allows_loopback_local_refs_in_video_and_audio():
    """With the exemption, a request whose video AND audio items carry absolute
    loopback same-origin URLs passes the request-time guard (deferred to the
    per-clip resolver). This is the packaged-desktop reproduction."""
    service = VideoCompositionService()
    request = _request(
        video_url="http://127.0.0.1:18320/api/storage/files/video/local.mp4",
        audio_url="http://127.0.0.1:18320/api/storage/files/audio/local.mp3",
    )
    # Must not raise.
    service._guard_request_urls(request)


def test_guard_request_urls_still_rejects_non_local_loopback_path():
    """The exemption is narrow: a loopback URL to a non-media route is still
    treated as external and rejected. Audio is the item type FFmpeg still opens
    over http (video URLs are resolved locally or refused, N-14)."""
    service = VideoCompositionService()
    request = _request(
        video_url="http://127.0.0.1:18320/api/storage/files/video/local.mp4",
        audio_url="http://127.0.0.1:18320/admin/secret",
    )
    with pytest.raises(URLGuardError):
        service._guard_request_urls(request)


def test_loopback_traversal_is_still_rejected_by_resolver():
    """Defence in depth: even though the guard exempts loopback local refs, the
    per-clip resolver still containerises, so traversal escapes are rejected."""
    with pytest.raises(LocalMediaResolveError):
        resolve_media_reference(
            "http://127.0.0.1:18320/api/storage/files/../../../etc/passwd",
            allow_remote=False,
        )


def test_composition_resolves_local_reference_before_remote_download(monkeypatch, tmp_path):
    service = VideoCompositionService()
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    def fake_resolve(reference, material_id=None, allow_remote=False):
        assert reference == "/api/storage/files/video/source.mp4"
        assert allow_remote is False
        return type(
            "Resolved",
            (),
            {"path": source, "public_url": reference, "source_kind": "local_storage"},
        )()

    monkeypatch.setattr("app.services.video_composition_service.resolve_media_reference", fake_resolve)

    assert service._convert_url_to_local_path("/api/storage/files/video/source.mp4") == str(source)


def _refuse_remote(self, url):
    raise FileNotFoundError(f"URL rejected by security guard: host of {url} resolves to 198.18.0.224")


def test_embedded_audio_uses_cached_path_not_remote_url(tmp_path):
    """A cached Pexels clip exported without sound: the audio stage re-resolved its CDN URL."""
    service = make_service(tmp_path)
    cached = media_file(tmp_path, "pexels-12345.mp4")
    clip = VideoCompositionItem(
        id="pexels", name="pexels", url="https://videos.pexels.com/video-files/12345.mp4",
        start_time=0.0, duration=3.0, track_id="video-track-1", clip_start=0.0, clip_end=3.0,
    )
    ffmpeg = FakeFfmpeg()

    with composing(ffmpeg), \
            patch(f"{MODULE}.resolve_local_media",
                  side_effect=lambda url, cache_lookup=None: SimpleNamespace(local_path=cached, origin="cache")), \
            patch.object(VideoCompositionService, "_convert_url_to_local_path", _refuse_remote):
        response = service._compose_video_sync(
            "comp-1", composition_request(video_items=[clip], total_duration=3.0),
        )

    probe = next(cmd for cmd in ffmpeg.commands if cmd[0] == "ffprobe")
    assert response.success is True
    assert probe[-1] == cached
    assert service.compositions["comp-1"]["degradations"] == []


def test_request_guard_skips_video_urls_resolved_locally(tmp_path, monkeypatch):
    """Fake-ip DNS (Clash TUN) rejected every export of a cached remote video."""
    service = make_service(tmp_path)
    monkeypatch.setattr(
        composition_module, "validate_external_url",
        MagicMock(side_effect=URLGuardError("resolves to disallowed address 198.18.0.224")),
    )
    monkeypatch.setattr(
        VideoCompositionService, "_process_video_composition_async", lambda self, cid, req: None,
    )

    response = service.start_video_composition(
        _request(video_url="https://videos.pexels.com/video-files/12345.mp4"),
    )

    assert (response.success, response.status) == (True, "processing")
