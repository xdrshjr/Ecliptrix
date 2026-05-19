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
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.audio_transcription_service import (
    AudioTranscriptionService,
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
