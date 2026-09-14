"""
Unit tests for ``AudioTranscriptionService`` covering:

* Lazy construction (no raise when credentials are absent).
* ``ASR_NOT_CONFIGURED`` short-circuit when calling without credentials.
* ``ASR_CLIP_TOO_LONG`` short-circuit BEFORE any WebSocket is opened.
* Happy-path single-file transcription end-to-end via a stubbed WebSocket
  that replays handcrafted server frames built with the protocol helpers.
* Silent-audio response → ``success=True`` with empty subtitles.
* Volcano server error frame → ``success=False`` carrying the Volcano code.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import os
import struct
from types import SimpleNamespace
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.audio_transcription_service import (
    AudioTranscriptionService,
    map_subtitles_to_timeline,
)
from app.services.volcano_ws_protocol import (
    COMPRESSION_GZIP,
    FLAG_POSITIVE_SEQ,
    MSG_TYPE_FULL_SERVER_RESPONSE,
    MSG_TYPE_SERVER_ERROR,
    SERIALIZATION_JSON,
    build_header,
)


# ---------------------------------------------------------- frame builders

def _full_server_response(payload: dict, *, seq: int = 1) -> bytes:
    header = build_header(
        msg_type=MSG_TYPE_FULL_SERVER_RESPONSE,
        flags=FLAG_POSITIVE_SEQ,
        serialization=SERIALIZATION_JSON,
        compression=COMPRESSION_GZIP,
    )
    body = gzip.compress(json.dumps(payload).encode("utf-8"))
    return header + struct.pack(">i", seq) + struct.pack(">I", len(body)) + body


def _error_frame(code: int, text: str) -> bytes:
    header = build_header(
        msg_type=MSG_TYPE_SERVER_ERROR,
        flags=0,
        serialization=SERIALIZATION_JSON,
        compression=0,
    )
    text_b = text.encode("utf-8")
    return header + struct.pack(">I", code) + struct.pack(">I", len(text_b)) + text_b


# ------------------------------------------------------ fake WS plumbing

class _FakeWS:
    """Async-context-manager that replays a fixed queue of frames on ``recv``."""

    def __init__(self, frames: List[bytes]):
        self._frames = list(frames)
        self.response_headers = {"X-Tt-Logid": "test-logid-1"}
        self.sent: List[bytes] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def send(self, frame: bytes):
        self.sent.append(frame)

    async def recv(self):
        if not self._frames:
            # Mimic Volcano's "stay quiet between mid packets" behaviour.
            await asyncio.sleep(0)
            raise asyncio.TimeoutError()
        return self._frames.pop(0)


def _make_service(*, appid="appid", access="token", resource="volc.bigasr.sauc.duration", max_clip=300):
    """Build a service instance with credentials forced via monkey-patch."""
    svc = AudioTranscriptionService.__new__(AudioTranscriptionService)
    svc.appid = appid
    svc.access_token = access
    svc.resource_id = resource
    svc.max_clip_seconds = max_clip
    svc.ws_url = "wss://example.invalid/test"
    return svc


# -------------------------------------------------------- construction

def test_init_with_empty_creds_does_not_raise(monkeypatch):
    """Locks in spec §2.5: constructor logs warnings instead of raising."""
    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "volcano_asr_appid", "")
    monkeypatch.setattr(_settings, "volcano_asr_access_token", "")
    monkeypatch.setattr(_settings, "volcano_asr_resource_id", "")

    svc = AudioTranscriptionService()
    assert svc.appid == ""
    assert svc.access_token == ""
    assert svc.resource_id == ""
    assert svc._missing_credentials() == "VOLCANO_ASR_APPID"


# --------------------------------------------------- pre-WebSocket guards

@pytest.mark.asyncio
async def test_aprocess_returns_not_configured_when_credentials_missing(tmp_path):
    audio = tmp_path / "clip.wav"
    audio.write_bytes(b"riff-stub")
    svc = _make_service(appid="", access="", resource="")

    with patch("app.services.audio_transcription_service.websockets.connect") as connect:
        result = await svc.aprocess_audio_file(str(audio), language="zh-CN")

    assert result["success"] is False
    assert result["error_code"] == "ASR_NOT_CONFIGURED"
    connect.assert_not_called()


@pytest.mark.asyncio
async def test_aprocess_rejects_long_clip_before_opening_websocket(tmp_path):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"data")
    svc = _make_service(max_clip=10)

    with patch.object(svc, "get_audio_duration", return_value=120.0), \
         patch("app.services.audio_transcription_service.websockets.connect") as connect:
        result = await svc.aprocess_audio_file(str(audio), language="zh-CN")

    assert result["success"] is False
    assert result["error_code"] == "ASR_CLIP_TOO_LONG"
    assert result["error_details"]["limit_s"] == 10
    connect.assert_not_called()


@pytest.mark.asyncio
async def test_aprocess_reports_file_not_found_without_opening_websocket(tmp_path):
    svc = _make_service()
    with patch("app.services.audio_transcription_service.websockets.connect") as connect:
        result = await svc.aprocess_audio_file(str(tmp_path / "missing.wav"))
    assert result["success"] is False
    assert result["error_code"] == "ASR_FILE_NOT_FOUND"
    connect.assert_not_called()


# ------------------------------------------------------------ happy path

@pytest.mark.asyncio
async def test_aprocess_happy_path_returns_subtitles(tmp_path):
    pcm_path = tmp_path / "pcm.wav"
    pcm_path.write_bytes(b"\x00" * 1024)  # tiny synthetic clip

    svc = _make_service()

    transcoded = tmp_path / "transcoded.wav"
    transcoded.write_bytes(b"\x00" * 1024)

    final_payload = {
        "audio_info": {"duration": 2000},
        "result": {
            "text": "这是字节跳动",
            "utterances": [
                {
                    "definite": True,
                    "start_time": 0,
                    "end_time": 1500,
                    "text": "这是字节跳动",
                }
            ],
        },
    }

    fake_ws = _FakeWS(
        frames=[
            _full_server_response({"audio_info": {}, "result": {"utterances": []}}, seq=1),
            _full_server_response(final_payload, seq=2),
        ]
    )

    with patch.object(svc, "get_audio_duration", return_value=2.0), \
         patch.object(svc, "_transcode_to_pcm16k_mono", return_value=str(transcoded)), \
         patch(
             "app.services.audio_transcription_service.websockets.connect",
             return_value=fake_ws,
         ):
        result = await svc.aprocess_audio_file(
            str(pcm_path), language="zh-CN", generate_srt_file=False
        )

    assert result["success"] is True
    assert result["subtitle_count"] == 1
    assert result["subtitles"][0].text == "这是字节跳动"
    assert result["audio_duration"] == 2.0
    # The transcoded temp file should have been cleaned up.
    assert not os.path.exists(str(transcoded))


@pytest.mark.asyncio
async def test_aprocess_silent_audio_returns_success_with_empty_subtitles(tmp_path):
    pcm_path = tmp_path / "silent.wav"
    pcm_path.write_bytes(b"\x00" * 128)
    svc = _make_service()

    transcoded = tmp_path / "transcoded.wav"
    transcoded.write_bytes(b"\x00" * 128)

    silent_payload = {"audio_info": {"duration": 500}, "result": {"text": "", "utterances": []}}
    fake_ws = _FakeWS(frames=[_full_server_response(silent_payload, seq=2)])

    with patch.object(svc, "get_audio_duration", return_value=0.5), \
         patch.object(svc, "_transcode_to_pcm16k_mono", return_value=str(transcoded)), \
         patch(
             "app.services.audio_transcription_service.websockets.connect",
             return_value=fake_ws,
         ):
        result = await svc.aprocess_audio_file(str(pcm_path), generate_srt_file=False)

    assert result["success"] is True
    assert result["subtitles"] == []
    assert result["subtitle_count"] == 0


@pytest.mark.asyncio
async def test_aprocess_volcano_error_frame_surfaces_failure(tmp_path):
    pcm_path = tmp_path / "clip.wav"
    pcm_path.write_bytes(b"\x00" * 128)
    svc = _make_service()

    transcoded = tmp_path / "tx.wav"
    transcoded.write_bytes(b"\x00" * 128)

    fake_ws = _FakeWS(frames=[_error_frame(45000001, "invalid request")])

    with patch.object(svc, "get_audio_duration", return_value=1.0), \
         patch.object(svc, "_transcode_to_pcm16k_mono", return_value=str(transcoded)), \
         patch(
             "app.services.audio_transcription_service.websockets.connect",
             return_value=fake_ws,
         ):
        result = await svc.aprocess_audio_file(str(pcm_path))

    assert result["success"] is False
    assert result["error_code"] == "ASR_AUTH_FAILED"
    assert result["error_details"]["volcano_code"] == 45000001
    assert "logid" in result["error_details"]


# --------------------------------------- ME-03: clip window → timeline time

AUDIO_URL = "/api/storage/files/audio/voice.mp3"


def _subtitle(start_ms: int, end_ms: int, text: str) -> SimpleNamespace:
    return SimpleNamespace(start_time=start_ms, end_time=end_ms, text=text)


def _timeline_triples(subtitles) -> list:
    return [(s["start_time"], s["end_time"], s["text"]) for s in subtitles]


async def _transcribe_items(tmp_path, items, source_subtitles) -> list:
    """Run the batch facade with ASR stubbed to return ``source_subtitles``."""
    audio = tmp_path / "voice.mp3"
    audio.write_bytes(b"data")
    svc = _make_service()
    asr = AsyncMock(return_value={"success": True, "subtitles": source_subtitles})
    with patch.object(svc, "_resolve_local_path", return_value=str(audio)), \
         patch.object(svc, "aprocess_audio_file", asr):
        return await svc.atranscribe_audio_urls(items)


def test_subtitles_are_mapped_through_clip_window():
    # The clip sits at 5s on the timeline and plays source 10-14s.
    mapped = map_subtitles_to_timeline(
        [_subtitle(0, 2000, "intro"), _subtitle(12000, 14000, "kept")],
        clip_start_s=10.0,
        clip_end_s=14.0,
        timeline_start_s=5.0,
    )

    assert _timeline_triples(mapped) == [(7000, 9000, "kept")]


def test_subtitle_crossing_the_window_is_cut_and_slivers_are_dropped():
    mapped = map_subtitles_to_timeline(
        [_subtitle(9000, 11000, "edge"), _subtitle(13950, 16000, "sliver")],
        clip_start_s=10.0,
        clip_end_s=14.0,
        timeline_start_s=0.0,
    )

    assert _timeline_triples(mapped) == [(0, 1000, "edge")]


@pytest.mark.asyncio
async def test_split_halves_do_not_duplicate_subtitles(tmp_path):
    halves = [
        {"id": "left", "url": AUDIO_URL, "start_time": 0.0, "duration": 5.0,
         "clip_start": 0.0, "clip_end": 5.0},
        {"id": "right", "url": AUDIO_URL, "start_time": 5.0, "duration": 5.0,
         "clip_start": 5.0, "clip_end": 10.0},
    ]
    source = [_subtitle(1000, 3000, "first"), _subtitle(6000, 8000, "second")]

    results = await _transcribe_items(tmp_path, halves, source)

    assert [_timeline_triples(r["subtitles"]) for r in results] == [
        [(1000, 3000, "first")],
        [(6000, 8000, "second")],
    ]
    assert "00:00:06,000 --> 00:00:08,000" in results[1]["srt_content"]


@pytest.mark.asyncio
async def test_missing_clip_end_uses_clip_start_plus_duration(tmp_path):
    item = {"id": "a", "url": AUDIO_URL, "start_time": 20.0, "duration": 3.0,
            "clip_start": 2.0, "clip_end": None}
    source = [_subtitle(2500, 4500, "inside"), _subtitle(5500, 7000, "after")]

    results = await _transcribe_items(tmp_path, [item], source)

    assert _timeline_triples(results[0]["subtitles"]) == [
        (20500, 22500, "inside")
    ]
