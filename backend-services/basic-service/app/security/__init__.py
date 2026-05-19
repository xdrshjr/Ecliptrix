"""Defensive security helpers (URL/path guards, sanitizers).

This package centralizes validators that fence off external-process and
SSRF risks. See ``url_guard`` for the URL & local-path validators used by
yt-dlp, FFmpeg, and the media/preview proxy routers.
"""

from app.security.url_guard import (
    URLGuardError,
    validate_external_url,
    validate_local_path_for_ffmpeg,
    FFMPEG_REMOTE_PROTOCOL_WHITELIST,
    FFMPEG_LOCAL_PROTOCOL_WHITELIST,
)
from app.security.log_redact import (
    REDACTED,
    SENSITIVE_HEADERS,
    SENSITIVE_BODY_KEY_SUBSTRINGS,
    redact_headers,
    redact_body,
    redact_string,
)

__all__ = [
    "URLGuardError",
    "validate_external_url",
    "validate_local_path_for_ffmpeg",
    "FFMPEG_REMOTE_PROTOCOL_WHITELIST",
    "FFMPEG_LOCAL_PROTOCOL_WHITELIST",
    "REDACTED",
    "SENSITIVE_HEADERS",
    "SENSITIVE_BODY_KEY_SUBSTRINGS",
    "redact_headers",
    "redact_body",
    "redact_string",
]
