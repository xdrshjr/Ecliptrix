"""
Golden-byte tests for the Volcano ASR WebSocket binary protocol helpers.

These tests pin the wire format against the layout documented in
``docs/plans/asr-websocket-streaming-fix/spec.md`` §2.3.1 so that any future
refactor that drifts away from Volcano's expected bytes fails loudly here
instead of being caught only by integration tests against the live service.
"""

from __future__ import annotations

import gzip
import json
import struct

import pytest

from app.services.volcano_ws_protocol import (
    COMPRESSION_GZIP,
    COMPRESSION_NONE,
    FLAG_NEG_SEQ_LAST,
    FLAG_POSITIVE_SEQ,
    HEADER_SIZE_WORDS,
    MSG_TYPE_AUDIO_ONLY_REQUEST,
    MSG_TYPE_FULL_CLIENT_REQUEST,
    MSG_TYPE_FULL_SERVER_RESPONSE,
    MSG_TYPE_SERVER_ERROR,
    PROTOCOL_VERSION,
    SERIALIZATION_JSON,
    SERIALIZATION_NONE,
    build_audio_packet,
    build_full_client_request,
    build_header,
    parse_response,
)


# ---------------------------------------------------------------- header

def test_build_header_bit_layout_matches_spec():
    """byte0 packs version+header_size, byte1 packs msg_type+flags, byte2 packs serialization+compression."""
    header = build_header(
        msg_type=MSG_TYPE_FULL_CLIENT_REQUEST,
        flags=FLAG_POSITIVE_SEQ,
        serialization=SERIALIZATION_JSON,
        compression=COMPRESSION_GZIP,
    )
    assert len(header) == 4
    assert header[0] == (PROTOCOL_VERSION << 4) | HEADER_SIZE_WORDS
    assert header[1] == (MSG_TYPE_FULL_CLIENT_REQUEST << 4) | FLAG_POSITIVE_SEQ
    assert header[2] == (SERIALIZATION_JSON << 4) | COMPRESSION_GZIP
    assert header[3] == 0x00


# ------------------------------------------------ full client request

def test_build_full_client_request_layout():
    """header[4] ‖ seq=+1 (int32 BE) ‖ size (uint32 BE) ‖ gzip(json_bytes)."""
    payload = {"audio": {"format": "wav"}, "request": {"model_name": "bigmodel"}}
    frame = build_full_client_request(payload, seq=1)

    assert frame[0] == (PROTOCOL_VERSION << 4) | HEADER_SIZE_WORDS
    assert frame[1] == (MSG_TYPE_FULL_CLIENT_REQUEST << 4) | FLAG_POSITIVE_SEQ
    assert frame[2] == (SERIALIZATION_JSON << 4) | COMPRESSION_GZIP
    assert frame[3] == 0x00

    seq = struct.unpack(">i", frame[4:8])[0]
    assert seq == 1

    size = struct.unpack(">I", frame[8:12])[0]
    body = frame[12:]
    assert len(body) == size

    # Round-trip JSON via gzip-decompress.
    decoded = json.loads(gzip.decompress(body).decode("utf-8"))
    assert decoded == payload


def test_build_full_client_request_rejects_non_positive_seq():
    with pytest.raises(ValueError):
        build_full_client_request({"a": 1}, seq=0)
    with pytest.raises(ValueError):
        build_full_client_request({"a": 1}, seq=-1)


# ---------------------------------------------------- audio packets

def test_build_audio_packet_positive_seq_layout():
    """Mid packet: flag=0b0001, serialization=raw, compression=gzip, seq positive."""
    audio = b"\x00\x01\x02\x03"
    frame = build_audio_packet(seq=5, audio=audio, last=False)

    assert frame[1] == (MSG_TYPE_AUDIO_ONLY_REQUEST << 4) | FLAG_POSITIVE_SEQ
    assert frame[2] == (SERIALIZATION_NONE << 4) | COMPRESSION_GZIP

    seq = struct.unpack(">i", frame[4:8])[0]
    assert seq == 5

    size = struct.unpack(">I", frame[8:12])[0]
    body = frame[12:]
    assert len(body) == size
    assert gzip.decompress(body) == audio


def test_build_audio_packet_last_negates_seq_and_flips_flag():
    """Last packet: flag=0b0011, seq is the *negation* of the positive value passed."""
    audio = b"final-bytes"
    frame = build_audio_packet(seq=42, audio=audio, last=True)

    assert frame[1] == (MSG_TYPE_AUDIO_ONLY_REQUEST << 4) | FLAG_NEG_SEQ_LAST

    seq = struct.unpack(">i", frame[4:8])[0]
    assert seq == -42

    body = frame[12:]
    assert gzip.decompress(body) == audio


def test_build_audio_packet_rejects_non_positive_seq():
    with pytest.raises(ValueError):
        build_audio_packet(seq=0, audio=b"", last=False)


# ---------------------------------------------------- parse_response

def _pack_full_server_response(payload: dict, *, seq: int = 1, compress: bool = True) -> bytes:
    header = build_header(
        msg_type=MSG_TYPE_FULL_SERVER_RESPONSE,
        flags=FLAG_POSITIVE_SEQ,
        serialization=SERIALIZATION_JSON,
        compression=COMPRESSION_GZIP if compress else COMPRESSION_NONE,
    )
    body_bytes = json.dumps(payload).encode("utf-8")
    if compress:
        body_bytes = gzip.compress(body_bytes)
    return header + struct.pack(">i", seq) + struct.pack(">I", len(body_bytes)) + body_bytes


def _pack_error_response(code: int, text: str) -> bytes:
    header = build_header(
        msg_type=MSG_TYPE_SERVER_ERROR,
        flags=0,
        serialization=SERIALIZATION_JSON,
        compression=COMPRESSION_NONE,
    )
    text_bytes = text.encode("utf-8")
    return header + struct.pack(">I", code) + struct.pack(">I", len(text_bytes)) + text_bytes


def test_parse_response_full_server_response_decodes_payload():
    payload = {"result": {"text": "hello", "utterances": []}, "audio_info": {"duration": 1000}}
    frame = _pack_full_server_response(payload, seq=3)

    msg = parse_response(frame)
    assert msg.is_error is False
    assert msg.sequence == 3
    assert msg.payload == payload
    assert msg.error_code is None
    assert msg.msg_type == MSG_TYPE_FULL_SERVER_RESPONSE


def test_parse_response_error_frame_extracts_code_and_message():
    frame = _pack_error_response(45000001, "invalid request")
    msg = parse_response(frame)
    assert msg.is_error is True
    assert msg.error_code == 45000001
    assert msg.error_text == "invalid request"
    assert msg.payload is None


def test_parse_response_full_server_response_without_compression():
    payload = {"result": {"text": "raw"}}
    frame = _pack_full_server_response(payload, seq=1, compress=False)
    msg = parse_response(frame)
    assert msg.is_error is False
    assert msg.payload == payload


def test_parse_response_rejects_truncated_frame():
    with pytest.raises(ValueError):
        parse_response(b"")
    with pytest.raises(ValueError):
        parse_response(b"\x00\x00")
