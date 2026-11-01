"""Connectivity probes for saved integration credentials.

(setup-wizard-full-capability-coverage §3.5.) A probe answers one question -
"does the upstream accept these credentials?" - with a closed ``outcome``
enum. It never echoes an upstream response body, never accepts a URL from the
caller (all hosts are constants, so there is no SSRF surface), keeps keys in
request headers only and never logs them. When a probe cannot give an honest
answer it returns ``unverifiable`` instead of a made-up ``ok``.

The upstream endpoints below were checked against the live services on
2026-11-01 (see ``link-audit.md`` section A.2 for what was and was not
confirmed: the ASR handshake *success* path and the ``not_entitled`` mapping of
Ark/TTS are still inferred).
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List

import httpx

from app.logger import get_logger
from app.services.integration_credentials_service import integration_credentials
from app.services.integration_registry import get_spec

logger = get_logger(__name__)

OUTCOMES = (
    "ok", "invalid_credentials", "not_entitled", "rate_limited",
    "unreachable", "upstream_error", "unverifiable",
)

PROBE_TIMEOUT_SECONDS = 10.0
THROTTLE_SECONDS = 5.0
ASR_ACK_WAIT_SECONDS = 2.0
_PROBE_TEXT = "好"

PEXELS_URL = "https://api.pexels.com/videos/search"
UNSPLASH_URL = "https://api.unsplash.com/search/photos"
FREESOUND_URL = "https://freesound.org/apiv2/search/text/"
ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"

# TTSServiceError.error_code -> outcome. Codes not listed are upstream_error.
TTS_OUTCOMES: Dict[str, str] = {
    "TTS_AUTH_FAILED": "invalid_credentials",
    "TTS_PERMISSION_DENIED": "not_entitled",
    "TTS_VOICE_UNAVAILABLE": "not_entitled",
    "TTS_QUOTA_EXHAUSTED": "not_entitled",
    "TTS_INSUFFICIENT_BALANCE": "not_entitled",
    "TTS_RATE_LIMITED": "rate_limited",
    "TTS_TIMEOUT": "unreachable",
    "TTS_NETWORK_ERROR": "unreachable",
}

_ASR_AUTH_HINTS = ("auth", "token", "appid", "app id", "unauthor", "grant", "credential")
_ASR_ENTITLEMENT_HINTS = ("resource", "permission", "not granted", "授权", "开通")

# Probe state is process-wide: one probe at a time, 5 s apart per integration.
_probe_lock = asyncio.Lock()
_last_run: Dict[str, float] = {}


@dataclass(frozen=True)
class ProbeReport:
    """What the router returns for ``POST /api/integrations/{id}/test``."""

    outcome: str
    verify_level: str
    elapsed_ms: int


def reset_throttle() -> None:
    """Forget throttle history and replace the lock (test isolation)."""
    global _probe_lock
    _last_run.clear()
    _probe_lock = asyncio.Lock()


def _client_factory() -> httpx.AsyncClient:
    """Test seam: tests substitute a client bound to ``httpx.MockTransport``."""
    return httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS, follow_redirects=False)


def classify_status(status_code: int) -> str:
    """Map an upstream HTTP status to an outcome (no body inspection)."""
    if 200 <= status_code < 300:
        return "ok"
    if status_code in (401, 403):
        return "invalid_credentials"
    if status_code == 429:
        return "rate_limited"
    return "upstream_error"


async def _get_status(
    url: str, headers: Dict[str, str], params: Dict[str, str]
) -> int:
    """GET once and return the status code; transport faults raise httpx errors."""
    async with _client_factory() as client:
        response = await client.get(url, headers=headers, params=params)
    return response.status_code


async def _probe_http(
    url: str,
    headers: Dict[str, str],
    params: Dict[str, str],
    classify: Callable[[int], str] = classify_status,
) -> str:
    try:
        return classify(await _get_status(url, headers, params))
    except httpx.HTTPError as error:
        logger.info("probe transport failure: %s", type(error).__name__)
        return "unreachable"


def _best_outcome(outcomes: List[str]) -> str:
    """One ok wins; otherwise rate limiting beats a plain rejection."""
    if "ok" in outcomes:
        return "ok"
    for preferred in ("rate_limited", "unreachable", "upstream_error"):
        if preferred in outcomes:
            return preferred
    return outcomes[0] if outcomes else "invalid_credentials"


async def _probe_keys(
    keys: List[str], build: Callable[[str], tuple]
) -> str:
    outcomes: List[str] = []
    for key in keys:
        url, headers, params = build(key)
        outcome = await _probe_http(url, headers, params)
        if outcome == "ok":
            return "ok"
        outcomes.append(outcome)
    return _best_outcome(outcomes)


async def _probe_pexels() -> str:
    keys = integration_credentials.values("pexels", "api_keys")
    return await _probe_keys(keys, lambda key: (
        PEXELS_URL, {"Authorization": key}, {"query": "nature", "per_page": "1"},
    ))


async def _probe_unsplash() -> str:
    keys = integration_credentials.values("unsplash", "access_keys")
    return await _probe_keys(keys, lambda key: (
        UNSPLASH_URL, {"Authorization": f"Client-ID {key}"},
        {"query": "nature", "per_page": "1"},
    ))


async def _probe_freesound() -> str:
    key = integration_credentials.value("freesound", "api_key")
    return await _probe_http(
        FREESOUND_URL, {"Authorization": f"Token {key}"},
        {"query": "rain", "page_size": "1"},
    )


def _classify_ark(status_code: int) -> str:
    # A wrong key is 401; a valid key without access is 403. ``ok`` only proves
    # the key is valid - model activation is checked by the first real task.
    if status_code == 403:
        return "not_entitled"
    return classify_status(status_code)


async def _probe_ark() -> str:
    key = integration_credentials.value("ark", "api_key")
    return await _probe_http(
        ARK_URL, {"Authorization": f"Bearer {key}"}, {"page_size": "1"},
        classify=_classify_ark,
    )


def _classify_asr_rejection(response) -> str:
    """Classify a refused WebSocket upgrade.

    Observed live (2026-11-01): wrong app id / token -> 401 "requested grant
    not found"; valid credentials whose app lacks the chosen resource -> 403
    "requested resource not granted". The body is only inspected here and is
    never returned or logged.
    """
    body = bytes(response.body or b"").decode("utf-8", errors="ignore")
    if _is_resource_not_granted(body):
        return "not_entitled"
    return classify_status(response.status_code)


def _is_resource_not_granted(text: str) -> bool:
    """True for "requested resource not granted" (credentials fine, app not
    entitled). Must be tested before the auth hints: "not granted" contains
    the auth hint "grant" and would otherwise read as a bad token."""
    lowered = (text or "").lower()
    return "not granted" in lowered and "resource" in lowered


def _classify_asr_error(error_text: str) -> str:
    lowered = (error_text or "").lower()
    if _is_resource_not_granted(lowered):
        return "not_entitled"
    if any(hint in lowered for hint in _ASR_AUTH_HINTS):
        return "invalid_credentials"
    if any(hint in lowered for hint in _ASR_ENTITLEMENT_HINTS):
        return "not_entitled"
    return "upstream_error"


async def _read_asr_ack(websocket) -> str:
    """After a successful upgrade, surface an early error frame if one arrives."""
    from app.services.volcano_ws_protocol import parse_response

    try:
        frame = await asyncio.wait_for(
            websocket.recv(), timeout=ASR_ACK_WAIT_SECONDS
        )
    except asyncio.TimeoutError:
        # The nostream endpoint may stay silent until audio arrives; the
        # authenticated upgrade itself is the signal we have.
        return "ok"
    try:
        message = parse_response(frame)
    except ValueError:
        return "upstream_error"
    return _classify_asr_error(message.error_text) if message.is_error else "ok"


async def _probe_asr() -> str:
    import websockets
    from websockets.exceptions import InvalidStatus, WebSocketException

    from app.services.audio_transcription_service import (
        _ASR_WS_URL,
        AudioTranscriptionService,
    )
    from app.services.volcano_ws_protocol import build_full_client_request

    service = AudioTranscriptionService()
    headers = service._build_headers(str(uuid.uuid4()), str(uuid.uuid4()))
    payload = service._build_full_client_payload(
        language="", use_itn=True, use_punc=True, audio_format="wav"
    )
    try:
        async with websockets.connect(
            _ASR_WS_URL, additional_headers=headers,
            open_timeout=PROBE_TIMEOUT_SECONDS, max_size=None,
        ) as websocket:
            await websocket.send(build_full_client_request(payload, seq=1))
            return await _read_asr_ack(websocket)
    except InvalidStatus as error:
        return _classify_asr_rejection(error.response)
    except (asyncio.TimeoutError, OSError, WebSocketException) as error:
        logger.info("asr probe transport failure: %s", type(error).__name__)
        return "unreachable"


def _tts_probe_voice(resource_id: str) -> str:
    """A voice that is valid for ``resource_id``; a mismatch reads as not_entitled."""
    from app.models.tts_models import VoiceType

    if resource_id == "seed-tts-2.0":
        return "zh_female_qingxinnvsheng_uranus_bigtts"
    return VoiceType.ZH_FEMALE_LINJIANVHAI_MOON_BIGTTS.value


def _synthesize_probe_sync(api_key: str, resource_id: str) -> str:
    """Blocking: synthesize one character into a throw-away directory."""
    from app.services import tts_service
    from app.services.tts_errors import TTSServiceError

    if tts_service.MOCK_MODE:
        # Mock mode returns success without any network call: not a real check.
        return "unverifiable"
    client = tts_service.TTSClient(api_key, resource_id, timeout=PROBE_TIMEOUT_SECONDS)
    with tempfile.TemporaryDirectory() as workdir:
        target = os.path.join(workdir, "probe.mp3")
        try:
            client.synthesize_speech(
                _PROBE_TEXT, target, voice_type=_tts_probe_voice(resource_id)
            )
        except TTSServiceError as error:
            return TTS_OUTCOMES.get(error.error_code, "upstream_error")
    return "ok"


async def _probe_tts() -> str:
    api_key = integration_credentials.value("volcano_tts", "api_key")
    resource_id = integration_credentials.value("volcano_tts", "resource_id")
    # The client is synchronous (requests): keep it off the event loop.
    return await asyncio.to_thread(_synthesize_probe_sync, api_key, resource_id)


async def _probe_unverifiable() -> str:
    return "unverifiable"


PROBES: Dict[str, Callable[[], Awaitable[str]]] = {
    "pexels": _probe_pexels,
    "unsplash": _probe_unsplash,
    "freesound": _probe_freesound,
    "ark": _probe_ark,
    "volcano_asr": _probe_asr,
    "volcano_tts": _probe_tts,
    "volcano_voice_clone": _probe_unverifiable,
}


def _throttled(integration_id: str) -> bool:
    last = _last_run.get(integration_id)
    return last is not None and time.monotonic() - last < THROTTLE_SECONDS


async def run_probe(integration_id: str) -> ProbeReport:
    """Probe the SAVED credentials of one integration.

    Concurrent or too-frequent calls answer ``rate_limited`` instead of
    queueing, so a double click can never fan out into repeated upstream calls.

    Raises:
        UnknownIntegrationError: ``integration_id`` is not registered.
    """
    from app.services.integration_credentials_service import UnknownIntegrationError

    spec = get_spec(integration_id)
    if spec is None:
        raise UnknownIntegrationError(integration_id)
    level = spec.verify_level
    if level == "none":
        return ProbeReport("unverifiable", level, 0)
    if _probe_lock.locked() or _throttled(integration_id):
        return ProbeReport("rate_limited", level, 0)
    started = time.monotonic()
    async with _probe_lock:
        _last_run[integration_id] = started
        outcome = await _guarded(PROBES[integration_id])
    elapsed = int((time.monotonic() - started) * 1000)
    return ProbeReport(outcome, level, elapsed)


async def _guarded(probe: Callable[[], Awaitable[str]]) -> str:
    """Run a probe under the overall deadline; any fault is a safe outcome."""
    try:
        return await asyncio.wait_for(probe(), timeout=PROBE_TIMEOUT_SECONDS + 2)
    except asyncio.TimeoutError:
        return "unreachable"
    except Exception as error:  # noqa: BLE001 - a probe must never 500 the wizard
        logger.error("probe failed unexpectedly: %s", type(error).__name__)
        return "upstream_error"

