"""
Volcano 大模型流式语音识别 WebSocket 二进制协议编解码工具。

This module is **pure encode/decode** — no I/O, no network. It owns the
byte-level framing for the streaming bigmodel WebSocket API:

  * 4-byte fixed header (protocol version / header size / msg type / flags /
    serialization / compression / reserved).
  * Optional 4-byte big-endian sequence number immediately after the header.
  * 4-byte big-endian payload size.
  * Payload bytes (gzip-compressed JSON for the full client request, gzip-
    compressed audio for audio-only packets).

Server frames carry either a normal full-server-response payload
(`msg_type=0b1001`) or an error frame (`msg_type=0b1111`). `parse_response`
returns a `ServerMessage` dataclass that captures both shapes so the
service-layer code can branch on `is_error` without re-reading the bytes.

See `docs/plans/asr-websocket-streaming-fix/spec.md` §2.3 for the authoritative
byte layout that the corresponding tests pin via golden-byte assertions.
"""

from __future__ import annotations

import gzip
import json
import struct
from dataclasses import dataclass
from typing import Any, Dict, Optional


# Protocol constants — see spec.md §2.3.
PROTOCOL_VERSION: int = 0b0001
HEADER_SIZE_WORDS: int = 0b0001  # in 4-byte words; total header = 4 bytes

MSG_TYPE_FULL_CLIENT_REQUEST: int = 0b0001
MSG_TYPE_AUDIO_ONLY_REQUEST: int = 0b0010
MSG_TYPE_FULL_SERVER_RESPONSE: int = 0b1001
MSG_TYPE_SERVER_ERROR: int = 0b1111

# Message-type-specific flags.
FLAG_POSITIVE_SEQ: int = 0b0001
FLAG_NEG_SEQ_LAST: int = 0b0011  # last packet, sequence number is negative

SERIALIZATION_NONE: int = 0b0000
SERIALIZATION_JSON: int = 0b0001

COMPRESSION_NONE: int = 0b0000
COMPRESSION_GZIP: int = 0b0001


def build_header(
    *,
    msg_type: int,
    flags: int,
    serialization: int = SERIALIZATION_JSON,
    compression: int = COMPRESSION_GZIP,
) -> bytes:
    """Pack the 4-byte protocol header.

    Bit layout (per spec.md §2.3):
        byte 0: protocol_version (4b) | header_size_words (4b)
        byte 1: msg_type (4b)         | flags (4b)
        byte 2: serialization (4b)    | compression (4b)
        byte 3: 0x00 (reserved)
    """
    byte0 = (PROTOCOL_VERSION << 4) | (HEADER_SIZE_WORDS & 0x0F)
    byte1 = ((msg_type & 0x0F) << 4) | (flags & 0x0F)
    byte2 = ((serialization & 0x0F) << 4) | (compression & 0x0F)
    return bytes([byte0, byte1, byte2, 0x00])


def build_full_client_request(payload: Dict[str, Any], *, seq: int = 1) -> bytes:
    """Build the first client frame: gzip(JSON) payload with sequence number.

    Wire layout (spec.md §2.3.1):
        header[4] ‖ seq=+N (int32 BE) ‖ size (uint32 BE) ‖ gzip(json_bytes)

    `seq` defaults to 1 (per Volcano's official samples).
    """
    if seq <= 0:
        raise ValueError(f"full client request seq must be positive, got {seq}")

    header = build_header(
        msg_type=MSG_TYPE_FULL_CLIENT_REQUEST,
        flags=FLAG_POSITIVE_SEQ,
        serialization=SERIALIZATION_JSON,
        compression=COMPRESSION_GZIP,
    )
    json_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    gzipped = gzip.compress(json_bytes)
    seq_field = struct.pack(">i", seq)
    size_field = struct.pack(">I", len(gzipped))
    return header + seq_field + size_field + gzipped


def build_audio_packet(*, seq: int, audio: bytes, last: bool) -> bytes:
    """Build an audio-only frame.

    Wire layout (spec.md §2.3.1):
        mid:  header[4] ‖ seq=+N (int32 BE) ‖ size (uint32 BE) ‖ gzip(chunk)
        last: header[4] ‖ seq=-N (int32 BE) ‖ size (uint32 BE) ‖ gzip(chunk)

    The caller passes the **positive** sequence number; this helper negates it
    when ``last=True`` to satisfy the FLAG_NEG_SEQ_LAST contract.
    """
    if seq <= 0:
        raise ValueError(f"audio packet seq must be positive, got {seq}")

    flags = FLAG_NEG_SEQ_LAST if last else FLAG_POSITIVE_SEQ
    header = build_header(
        msg_type=MSG_TYPE_AUDIO_ONLY_REQUEST,
        flags=flags,
        serialization=SERIALIZATION_NONE,
        compression=COMPRESSION_GZIP,
    )
    wire_seq = -seq if last else seq
    gzipped = gzip.compress(audio)
    seq_field = struct.pack(">i", wire_seq)
    size_field = struct.pack(">I", len(gzipped))
    return header + seq_field + size_field + gzipped


@dataclass
class ServerMessage:
    """Decoded view of a single server frame.

    Exactly one of ``payload`` (success branch) or ``(error_code, error_text)``
    (error branch) is populated; ``is_error`` discriminates.
    """

    is_error: bool
    sequence: Optional[int]
    payload: Optional[Dict[str, Any]]
    error_code: Optional[int]
    error_text: Optional[str]
    msg_type: int
    flags: int


def parse_response(frame: bytes) -> ServerMessage:
    """Decode a frame received from the Volcano server.

    Handles two top-level shapes:
        * Full server response (msg_type=0b1001):
              header[4] ‖ seq (int32 BE) ‖ size (uint32 BE) ‖ payload
          ``payload`` is gzip-decompressed and JSON-decoded when the header
          compression / serialization flags say so.
        * Error response (msg_type=0b1111):
              header[4] ‖ error_code (uint32 BE) ‖ size (uint32 BE) ‖ utf8_text

    Raises ValueError on malformed frames so the caller can fail loudly rather
    than silently ignore garbage.
    """
    if len(frame) < 4:
        raise ValueError(f"frame too short: {len(frame)} bytes")

    byte0, byte1, byte2, _reserved = frame[0], frame[1], frame[2], frame[3]
    header_size_words = byte0 & 0x0F
    header_size_bytes = header_size_words * 4
    msg_type = (byte1 >> 4) & 0x0F
    flags = byte1 & 0x0F
    serialization = (byte2 >> 4) & 0x0F
    compression = byte2 & 0x0F

    cursor = header_size_bytes

    if msg_type == MSG_TYPE_SERVER_ERROR:
        if len(frame) < cursor + 8:
            raise ValueError("error frame missing code/size fields")
        error_code = struct.unpack(">I", frame[cursor : cursor + 4])[0]
        cursor += 4
        size = struct.unpack(">I", frame[cursor : cursor + 4])[0]
        cursor += 4
        text_bytes = frame[cursor : cursor + size]
        try:
            error_text = text_bytes.decode("utf-8")
        except UnicodeDecodeError:
            error_text = text_bytes.decode("utf-8", errors="replace")
        return ServerMessage(
            is_error=True,
            sequence=None,
            payload=None,
            error_code=error_code,
            error_text=error_text,
            msg_type=msg_type,
            flags=flags,
        )

    if msg_type != MSG_TYPE_FULL_SERVER_RESPONSE:
        # Unknown / unsupported — surface a structured error rather than crash.
        return ServerMessage(
            is_error=True,
            sequence=None,
            payload=None,
            error_code=None,
            error_text=f"unexpected msg_type=0b{msg_type:04b}",
            msg_type=msg_type,
            flags=flags,
        )

    # Full server response: optional sequence + payload-size + payload.
    sequence: Optional[int] = None
    # Volcano always emits a 4-byte sequence number on full server response
    # frames in the streaming protocol (spec.md §2.3.1).
    if len(frame) < cursor + 4:
        raise ValueError("full server response missing sequence field")
    sequence = struct.unpack(">i", frame[cursor : cursor + 4])[0]
    cursor += 4

    if len(frame) < cursor + 4:
        raise ValueError("full server response missing payload size")
    size = struct.unpack(">I", frame[cursor : cursor + 4])[0]
    cursor += 4

    raw_payload = frame[cursor : cursor + size]

    if compression == COMPRESSION_GZIP:
        decoded_bytes = gzip.decompress(raw_payload)
    else:
        decoded_bytes = raw_payload

    payload: Optional[Dict[str, Any]] = None
    if serialization == SERIALIZATION_JSON:
        if decoded_bytes:
            payload = json.loads(decoded_bytes.decode("utf-8"))
        else:
            payload = {}
    else:
        payload = {"raw": decoded_bytes}

    return ServerMessage(
        is_error=False,
        sequence=sequence,
        payload=payload,
        error_code=None,
        error_text=None,
        msg_type=msg_type,
        flags=flags,
    )
