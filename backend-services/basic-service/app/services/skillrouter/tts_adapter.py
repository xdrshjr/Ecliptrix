"""Speech synthesis through the SkillRouter gateway (spec §4.3).

``RouterTTSClient`` has the same ``synthesize_speech`` contract as the Volcano
``TTSClient`` so ``TTSService`` (retries, duration probing, storage
registration) and every caller above it stay unchanged. It runs on a worker
thread, therefore it uses the blocking client; the asset download reuses the
async ``assets.download_asset`` through ``run_blocking``.

Rules: limits come from the gateway catalogue (never hard-coded beyond the
documented factory defaults used when a field is absent), long text is split
on sentence boundaries and synthesised sequentially, the chunks are merged with
a real ffmpeg concat, cloned voices are refused (the gateway cannot serve
them), and the output file only ever appears fully written.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.config import settings
from app.logger import get_logger
from app.models.tts_models import TTSErrorDetails, VoiceTypeInfo
from app.services.skillrouter import catalog
from app.services.skillrouter.assets import download_asset
from app.services.skillrouter.client import SyncRouterClient
from app.services.skillrouter.config import RouterSnapshot, is_routed, require_ready
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.sync_support import blocking_limits, run_blocking
from app.services.tts_errors import RETRYABLE_CODES, TTSServiceError, make_tts_error

logger = get_logger(__name__)

DEFAULT_MAX_CHARS = 1000
DEFAULT_SPEED_RANGE = (0.5, 2.0)
MAX_AUDIO_BYTES = 64 * 1024 * 1024
MAX_BACKOFF_SECONDS = 5
ROUTER_CONCURRENCY_CAP = 2
_SENTENCE_END = re.compile(r"(?<=[。！？!?；;\n])")
_BUSY_CODES = frozenset({"too_many_inflight", "upstream_rate_limited", "probe_throttled"})

#: gateway code -> existing TTS error code (spec §4.3.4, extended in the report)
_TTS_CODE_BY_GATEWAY = {
    "authentication_error": "TTS_AUTH_FAILED",
    "quota_exceeded": "TTS_QUOTA_EXHAUSTED",
    "too_many_inflight": "TTS_RATE_LIMITED",
    "upstream_rate_limited": "TTS_RATE_LIMITED",
    "too_many_jobs": "TTS_RATE_LIMITED",
    "probe_throttled": "TTS_RATE_LIMITED",
    "upstream_timeout": "TTS_TIMEOUT",
    "router_unreachable": "TTS_NETWORK_ERROR",
    "router_key_missing": "TTS_CONFIG_MISSING",
    "capability_disabled": "TTS_PERMISSION_DENIED",
    "tier_denied": "TTS_PERMISSION_DENIED",
    "invalid_request": "TTS_INVALID_REQUEST",
    "text_too_long": "TTS_INVALID_REQUEST",
    "content_rejected": "TTS_INVALID_REQUEST",
    "invalid_provider_response": "TTS_INVALID_RESPONSE",
    "router_bad_response": "TTS_INVALID_RESPONSE",
    "upstream_unavailable": "TTS_PROVIDER_ERROR",
    "egress_unavailable": "TTS_PROVIDER_ERROR",
    "capability_not_configured": "TTS_PROVIDER_ERROR",
    "capability_unavailable": "TTS_PROVIDER_ERROR",
}


def map_router_error(error: RouterError, attempts: int = 1) -> TTSServiceError:
    """Translate a gateway failure into the TTS error the upper layers know."""
    code = _TTS_CODE_BY_GATEWAY.get(error.code, "TTS_UNKNOWN_ERROR")
    status = error.http_status if 100 <= error.http_status <= 599 else None
    return TTSServiceError(code, TTSErrorDetails(
        source="backend", provider_code=error.code if re.fullmatch(
            r"[A-Za-z0-9._-]+", error.code) else None,
        http_status=status, attempts=attempts, retryable=code in RETRYABLE_CODES,
    ))


def split_text(text: str, max_chars: int) -> List[str]:
    """Split ``text`` into chunks of at most ``max_chars``, preferring sentence ends.

    A single sentence longer than ``max_chars`` is hard-cut. Joining the chunks
    reproduces ``text`` except for whitespace-only chunks, which the gateway
    would reject as empty input.
    """
    if max_chars < 1:
        raise ValueError("max_chars must be positive")
    chunks: List[str] = []
    current = ""
    for sentence in filter(None, _SENTENCE_END.split(text)):
        if len(current) + len(sentence) <= max_chars:
            current += sentence
            continue
        if current:
            chunks.append(current)
        while len(sentence) > max_chars:
            chunks.append(sentence[:max_chars])
            sentence = sentence[max_chars:]
        current = sentence
    if current:
        chunks.append(current)
    return [chunk for chunk in chunks if chunk.strip()] or [text]


def cap_tts_concurrency(configured: int) -> int:
    """Gateway admits two TTS calls in flight per caller (spec §4.3.7)."""
    return min(configured, ROUTER_CONCURRENCY_CAP) if is_routed("tts") else configured


def _clone_prefix() -> str:
    return getattr(settings, "volcano_voice_clone_speaker_id_prefix", "") or ""


def _reject_cloned_voice(voice_type: str) -> None:
    prefix = _clone_prefix()
    if not (prefix and voice_type.startswith(prefix)):
        return
    raise TTSServiceError("TTS_VOICE_UNAVAILABLE", TTSErrorDetails(
        source="backend", attempts=0, retryable=False,
        suggest="manual_capability:tts",
    ))


def _clamp_speed(speed_ratio: float, limits: Dict[str, Any]) -> float:
    bounds = limits.get("speed") if isinstance(limits.get("speed"), dict) else {}
    low = float(bounds.get("min", DEFAULT_SPEED_RANGE[0]))
    high = float(bounds.get("max", DEFAULT_SPEED_RANGE[1]))
    return max(low, min(high, float(speed_ratio)))


def _max_chars(limits: Dict[str, Any]) -> int:
    value = limits.get("maxChars")
    return int(value) if isinstance(value, (int, float)) and value >= 1 else DEFAULT_MAX_CHARS


def _ffmpeg() -> str:
    from app.services.tts_service import tts_service

    path = tts_service._get_ffmpeg_path()
    if not path:
        raise make_tts_error("TTS_LOCAL_IO_ERROR", "local", 1)
    return path


def merge_audio(parts: List[Path], output: Path) -> None:
    """Concatenate mp3 ``parts`` into ``output`` with ffmpeg stream copy."""
    listing = output.with_name(output.name + ".list")
    part_file = output.with_name(output.name + ".part")
    try:
        listing.write_text("".join(
            "file '{}'\n".format(str(p).replace("\\", "/").replace("'", "'\\''"))
            for p in parts), encoding="utf-8")
        command = [_ffmpeg(), "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                   "-c", "copy", "-f", "mp3", str(part_file)]
        result = subprocess.run(command, capture_output=True, timeout=120)
        if result.returncode != 0 or not part_file.exists() or part_file.stat().st_size == 0:
            raise make_tts_error("TTS_LOCAL_IO_ERROR", "local", 1)
        part_file.replace(output)
    except subprocess.SubprocessError:
        raise make_tts_error("TTS_LOCAL_IO_ERROR", "local", 1) from None
    finally:
        listing.unlink(missing_ok=True)
        part_file.unlink(missing_ok=True)


class RouterTTSClient:
    """Drop-in for ``TTSClient.synthesize_speech`` that talks to the gateway."""

    def __init__(self, snapshot: Optional[RouterSnapshot] = None) -> None:
        self._snapshot = snapshot

    def synthesize_speech(
        self, text: str, output_file: str,
        voice_type: str = "zh_female_qingxinnvsheng_uranus_bigtts",
        speed_ratio: float = 1.0,
    ) -> bool:
        """Write the synthesised mp3 to ``output_file``.

        Raises:
            TTSServiceError: mapped gateway failure, refused cloned voice or local I/O.
        """
        output = Path(output_file)
        try:
            _reject_cloned_voice(voice_type)
            snapshot = self._snapshot or require_ready()
            limits = blocking_limits("tts")
            self._run(snapshot, text, output, voice_type, _clamp_speed(speed_ratio, limits),
                      _max_chars(limits))
            return True
        except RouterError as error:
            self._pause_when_busy(error)
            raise map_router_error(error) from None
        except OSError:
            raise make_tts_error("TTS_LOCAL_IO_ERROR", "local", 1) from None

    def _run(self, snapshot: RouterSnapshot, text: str, output: Path,
             voice_type: str, speed: float, max_chars: int) -> None:
        chunks = split_text(text, max_chars)
        if len(chunks) == 1:
            self._synthesize_chunk(snapshot, chunks[0], output, voice_type, speed)
            return
        with tempfile.TemporaryDirectory(prefix="tts_chunks_", dir=output.parent) as work:
            parts = []
            for index, chunk in enumerate(chunks):
                part = Path(work) / f"{index:04d}.mp3"
                self._synthesize_chunk(snapshot, chunk, part, voice_type, speed)
                parts.append(part)
            merge_audio(parts, output)

    @staticmethod
    def _synthesize_chunk(snapshot: RouterSnapshot, text: str, destination: Path,
                          voice_type: str, speed: float) -> None:
        body = {"text": text, "voice": voice_type, "speed": speed, "response": "url"}
        data = SyncRouterClient(snapshot).post("media/audio/speech", body, gate="tts")
        asset = data.get("asset") if isinstance(data, dict) else None
        url = asset.get("url") if isinstance(asset, dict) else None
        if not isinstance(url, str) or not url:
            raise RouterError("router_bad_response", 502, "Speech response has no asset url.")
        run_blocking(download_asset(snapshot, url, destination, max_bytes=MAX_AUDIO_BYTES))

    @staticmethod
    def _pause_when_busy(error: RouterError) -> None:
        """Honour ``Retry-After`` so the caller's next attempt lands after the window."""
        if error.code in _BUSY_CODES and error.retry_after:
            time.sleep(min(error.retry_after, MAX_BACKOFF_SECONDS))



def _infer_gender(voice: Dict[str, Any]) -> str:
    declared = voice.get("gender")
    if isinstance(declared, str) and declared:
        return declared
    identifier = str(voice.get("id", ""))
    if "_female_" in identifier:
        return "female"
    return "male" if "_male_" in identifier else "unknown"


def _voice_info(voice: Dict[str, Any]) -> Optional[VoiceTypeInfo]:
    identifier = voice.get("id")
    if not isinstance(identifier, str) or not identifier:
        return None
    generation = voice.get("generation")
    return VoiceTypeInfo(
        id=identifier, name=str(voice.get("name") or identifier),
        language=str(voice.get("language") or "zh-CN"), gender=_infer_gender(voice),
        description=str(voice.get("description") or (
            f"Voice {generation}" if generation else "")),
        category=str(voice.get("category") or "general"),
    )


async def router_voice_types(
    fallback: Callable[[], Dict[str, VoiceTypeInfo]],
) -> Tuple[Dict[str, VoiceTypeInfo], bool]:
    """Voice catalogue from the gateway ``limits.voices``.

    Returns ``(voices, stale)``. ``stale`` is True when the gateway list was
    unavailable and the static table (``fallback``) was served instead.
    """
    limits = await catalog.ensure_limits("tts")
    voices = limits.get("voices") if isinstance(limits.get("voices"), list) else []
    infos = [info for info in (_voice_info(v) for v in voices if isinstance(v, dict)) if info]
    if not infos:
        logger.warning("skillrouter voices unavailable; serving the static voice table")
        return fallback(), True
    return {info.id: info for info in infos}, False
