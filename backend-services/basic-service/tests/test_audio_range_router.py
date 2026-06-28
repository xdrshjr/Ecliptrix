"""HTTP Range serving for generated/subtitle audio (mid-clip preview seek).

Regression test for
``docs/diagnoses/audio-midclip-silent-non-seekable-source/analysis.md``.

TTS/generated audio (``/api/audio/generated``) and subtitle/ASR audio
(``/api/audio/subtitles``) used to be served by bare ``StaticFiles`` mounts.
Under the pinned Starlette 0.27.0 those mounts ignore the ``Range`` request
header (``200`` whole file, no ``Accept-Ranges``), so a preview started from the
MIDDLE of an audio clip — which assigns a non-zero ``currentTime`` and therefore
needs a byte Range — could never reach a playable state and the audio track
stayed silent. Starting at the clip head worked only because it needs no seek
(progressive download from byte 0). ``audio_router`` now serves both dirs
through the same explicit-``206`` ``_serve_safe_media`` helper that
``/api/storage/files`` already uses, at the SAME public URLs.

These tests lock the ``206``/``416``/``Accept-Ranges`` contract and the
``..``-traversal guard so the behaviour holds regardless of the installed
Starlette version (the bug node ran on a box whose Starlette differs from the
pin, which is precisely why version-independent assertions matter).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.routers import storage_files_router


# Deterministic 5000-byte payload so byte-range slices are easy to assert.
_PAYLOAD = bytes((i % 251) for i in range(5000))


def _build_audio_app(
    generated_dir: Path, subtitle_dir: Path, monkeypatch
) -> FastAPI:
    """Mount ``audio_router`` with its dir resolvers pointed at temp dirs."""
    monkeypatch.setattr(
        storage_files_router, "audio_generated_dir", lambda: generated_dir
    )
    monkeypatch.setattr(
        storage_files_router, "audio_subtitle_dir", lambda: subtitle_dir
    )
    app = FastAPI()
    app.include_router(storage_files_router.audio_router, prefix="/api")
    return app


def _make_file(directory: Path, name: str, content: bytes) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_bytes(content)


def _bare_request() -> Request:
    """A minimal GET request (no Range) for direct helper calls."""
    return Request({"type": "http", "method": "GET", "headers": []})


def test_generated_audio_midfile_range_returns_206(tmp_path, monkeypatch):
    """A mid-file Range (the mid-clip seek case) returns exactly the slice.

    This is the head-vs-middle asymmetry the bug was about: the byte slice for
    a non-zero seek must be served, not the whole file with a 200.
    """
    gen = tmp_path / "generated"
    _make_file(gen, "narration.mp3", _PAYLOAD)
    client = TestClient(_build_audio_app(gen, tmp_path / "subtitles", monkeypatch))

    resp = client.get(
        "/api/audio/generated/narration.mp3",
        headers={"Range": "bytes=1000-1999"},
    )

    assert resp.status_code == 206, resp.text
    assert resp.headers["Content-Range"] == f"bytes 1000-1999/{len(_PAYLOAD)}"
    assert resp.headers["Accept-Ranges"] == "bytes"
    assert resp.content == _PAYLOAD[1000:2000]


def test_generated_audio_no_range_advertises_accept_ranges(tmp_path, monkeypatch):
    """A plain GET (clip-head start) still advertises seekability.

    The old StaticFiles mount returned 200 with NO ``Accept-Ranges``, which is
    what made the element treat the source as non-seekable.
    """
    gen = tmp_path / "generated"
    _make_file(gen, "narration.mp3", _PAYLOAD)
    client = TestClient(_build_audio_app(gen, tmp_path / "subtitles", monkeypatch))

    resp = client.get("/api/audio/generated/narration.mp3")

    assert resp.status_code == 200, resp.text
    assert resp.headers.get("Accept-Ranges") == "bytes"
    assert resp.content == _PAYLOAD


def test_generated_audio_unsatisfiable_range_returns_416(tmp_path, monkeypatch):
    """A start past EOF → 416 + ``Content-Range: bytes */size``."""
    gen = tmp_path / "generated"
    _make_file(gen, "narration.mp3", _PAYLOAD)
    client = TestClient(_build_audio_app(gen, tmp_path / "subtitles", monkeypatch))

    resp = client.get(
        "/api/audio/generated/narration.mp3",
        headers={"Range": f"bytes={len(_PAYLOAD) + 10}-{len(_PAYLOAD) + 20}"},
    )

    assert resp.status_code == 416, resp.text
    assert resp.headers.get("Content-Range") == f"bytes */{len(_PAYLOAD)}"


def test_subtitle_audio_range_returns_206(tmp_path, monkeypatch):
    """The subtitle mount gets the same Range treatment as generated audio."""
    sub = tmp_path / "subtitles"
    _make_file(sub, "asr.wav", _PAYLOAD)
    client = TestClient(_build_audio_app(tmp_path / "generated", sub, monkeypatch))

    resp = client.get(
        "/api/audio/subtitles/asr.wav",
        headers={"Range": "bytes=0-1023"},
    )

    assert resp.status_code == 206, resp.text
    assert resp.headers["Accept-Ranges"] == "bytes"
    assert resp.content == _PAYLOAD[0:1024]


def test_generated_audio_missing_file_returns_404(tmp_path, monkeypatch):
    """An absent file still 404s, as the StaticFiles mount did."""
    gen = tmp_path / "generated"
    gen.mkdir(parents=True, exist_ok=True)
    client = TestClient(_build_audio_app(gen, tmp_path / "subtitles", monkeypatch))

    resp = client.get("/api/audio/generated/does-not-exist.mp3")

    assert resp.status_code == 404, resp.text


def test_serve_audio_with_range_rejects_traversal(tmp_path):
    """``..`` escape outside the audio root is rejected (400).

    A hand-rolled route does NOT inherit StaticFiles' free escape protection,
    so the containment guard is the principal regression risk of this fix. We
    call the helper directly to exercise the guard unambiguously, bypassing any
    client-side URL normalisation of dot-segments.
    """
    gen = tmp_path / "generated"
    gen.mkdir(parents=True, exist_ok=True)
    (tmp_path / "secret.txt").write_bytes(b"top-secret")

    with pytest.raises(HTTPException) as exc_info:
        storage_files_router._serve_audio_with_range(
            gen, "../secret.txt", _bare_request()
        )

    assert exc_info.value.status_code == 400


def test_serve_audio_with_range_rejects_empty_path(tmp_path):
    """An empty relative path is rejected (400) before any disk access."""
    gen = tmp_path / "generated"
    gen.mkdir(parents=True, exist_ok=True)

    with pytest.raises(HTTPException) as exc_info:
        storage_files_router._serve_audio_with_range(gen, "", _bare_request())

    assert exc_info.value.status_code == 400
