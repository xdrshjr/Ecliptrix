"""Connectivity probes (setup-wizard-full-capability-coverage §3.5, §7.2).

HTTP probes run against ``httpx.MockTransport``; TTS and ASR use fakes at the
client boundary. Nothing here touches the network.
"""

from __future__ import annotations

import asyncio
import logging
import os

import httpx
import pytest
import pytest_asyncio
from websockets.datastructures import Headers
from websockets.exceptions import InvalidStatus
from websockets.http11 import Response

from app.services import integration_probes as probes
from app.services.integration_credentials_service import (
    integration_credentials as creds,
)
from app.services.tts_errors import make_tts_error

KEY = "probe-secret-key-0123456789"


@pytest_asyncio.fixture
async def store(integration_db):
    creds.reset()
    probes.reset_throttle()
    yield creds
    probes.reset_throttle()


def _install_transport(monkeypatch, handler):
    seen = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(
        probes,
        "_client_factory",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    return seen


async def _save(store, integration_id, fields):
    await store.save(integration_id, fields)


HTTP_CASES = [
    ("pexels", {"api_keys": [KEY]}),
    ("unsplash", {"access_keys": [KEY]}),
    ("freesound", {"api_key": KEY}),
    ("ark", {"api_key": KEY}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("integration_id, fields", HTTP_CASES)
@pytest.mark.parametrize(
    "status, expected",
    [(200, "ok"), (401, "invalid_credentials"), (429, "rate_limited"),
     (500, "upstream_error"), (404, "upstream_error")],
)
async def test_http_status_classification(
    store, monkeypatch, integration_id, fields, status, expected
):
    await _save(store, integration_id, fields)
    _install_transport(monkeypatch, lambda request: httpx.Response(status))

    report = await probes.run_probe(integration_id)

    assert report.outcome == expected


@pytest.mark.asyncio
async def test_ark_403_means_a_valid_key_without_access(store, monkeypatch):
    await _save(store, "ark", {"api_key": KEY})
    _install_transport(monkeypatch, lambda request: httpx.Response(403))

    assert (await probes.run_probe("ark")).outcome == "not_entitled"


@pytest.mark.asyncio
@pytest.mark.parametrize("integration_id, fields", HTTP_CASES)
async def test_the_key_travels_in_a_header_only(
    store, monkeypatch, caplog, integration_id, fields
):
    await _save(store, integration_id, fields)
    seen = _install_transport(monkeypatch, lambda request: httpx.Response(200))

    with caplog.at_level(logging.DEBUG):
        await probes.run_probe(integration_id)

    request = seen[0]
    assert KEY not in str(request.url)
    assert KEY in request.headers["authorization"]
    assert KEY not in caplog.text


@pytest.mark.asyncio
async def test_transport_failures_read_as_unreachable(store, monkeypatch):
    await _save(store, "freesound", {"api_key": KEY})

    def boom(request):
        raise httpx.ConnectTimeout("timed out", request=request)

    _install_transport(monkeypatch, boom)

    assert (await probes.run_probe("freesound")).outcome == "unreachable"


@pytest.mark.asyncio
async def test_pexels_tries_every_key_and_any_success_wins(store, monkeypatch):
    good = "pexels-good-key-12345678"
    await _save(store, "pexels", {"api_keys": [KEY, good]})
    _install_transport(
        monkeypatch,
        lambda request: httpx.Response(200 if request.headers["authorization"] == good else 401),
    )

    assert (await probes.run_probe("pexels")).outcome == "ok"


@pytest.mark.asyncio
async def test_voice_clone_is_never_verified_and_never_calls_out(store, monkeypatch):
    await _save(store, "volcano_voice_clone", {"app_key": "1234567890", "access_key": KEY})
    seen = _install_transport(monkeypatch, lambda request: httpx.Response(200))

    report = await probes.run_probe("volcano_voice_clone")

    assert report.outcome == "unverifiable" and report.verify_level == "none"
    assert seen == []


@pytest.mark.asyncio
async def test_a_second_probe_within_five_seconds_is_rate_limited(store, monkeypatch):
    await _save(store, "freesound", {"api_key": KEY})
    seen = _install_transport(monkeypatch, lambda request: httpx.Response(200))

    first = await probes.run_probe("freesound")
    second = await probes.run_probe("freesound")

    assert (first.outcome, second.outcome) == ("ok", "rate_limited")
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_a_probe_while_another_runs_is_rate_limited(store, monkeypatch):
    await _save(store, "freesound", {"api_key": KEY})
    await _save(store, "ark", {"api_key": KEY})
    gate = asyncio.Event()

    async def slow_probe():
        await gate.wait()
        return "ok"

    monkeypatch.setitem(probes.PROBES, "freesound", slow_probe)
    running = asyncio.create_task(probes.run_probe("freesound"))
    await asyncio.sleep(0)
    other = await probes.run_probe("ark")
    gate.set()

    assert other.outcome == "rate_limited"
    assert (await running).outcome == "ok"


@pytest.mark.asyncio
async def test_an_unexpected_probe_error_becomes_a_safe_outcome(store, monkeypatch, caplog):
    async def broken():
        raise RuntimeError(f"explodes with {KEY}")

    monkeypatch.setitem(probes.PROBES, "ark", broken)
    with caplog.at_level(logging.DEBUG):
        report = await probes.run_probe("ark")

    assert report.outcome == "upstream_error"
    assert KEY not in caplog.text


# ----------------------------------------------------------------------- TTS


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "code, expected",
    [
        ("TTS_AUTH_FAILED", "invalid_credentials"),
        ("TTS_PERMISSION_DENIED", "not_entitled"),
        ("TTS_VOICE_UNAVAILABLE", "not_entitled"),
        ("TTS_QUOTA_EXHAUSTED", "not_entitled"),
        ("TTS_INSUFFICIENT_BALANCE", "not_entitled"),
        ("TTS_RATE_LIMITED", "rate_limited"),
        ("TTS_TIMEOUT", "unreachable"),
        ("TTS_NETWORK_ERROR", "unreachable"),
        ("TTS_PROVIDER_ERROR", "upstream_error"),
        ("TTS_INVALID_RESPONSE", "upstream_error"),
        ("TTS_INVALID_REQUEST", "upstream_error"),
        ("TTS_UNKNOWN_ERROR", "upstream_error"),
        ("TTS_LOCAL_IO_ERROR", "upstream_error"),
    ],
)
async def test_tts_error_codes_map_to_outcomes(store, monkeypatch, code, expected):
    from app.services import tts_service

    await _save(store, "volcano_tts", {"api_key": KEY})
    monkeypatch.setattr(tts_service, "MOCK_MODE", False)

    def fail(self, *args, **kwargs):
        raise make_tts_error(code, "provider", 1)

    monkeypatch.setattr(tts_service.TTSClient, "synthesize_speech", fail)

    assert (await probes.run_probe("volcano_tts")).outcome == expected


@pytest.mark.asyncio
async def test_tts_mock_mode_is_unverifiable_not_ok(store, monkeypatch):
    from app.services import tts_service

    await _save(store, "volcano_tts", {"api_key": KEY})
    monkeypatch.setattr(tts_service, "MOCK_MODE", True)
    calls = []
    monkeypatch.setattr(
        tts_service.TTSClient, "synthesize_speech",
        lambda self, *a, **k: calls.append(a) or True,
    )

    assert (await probes.run_probe("volcano_tts")).outcome == "unverifiable"
    assert calls == []


@pytest.mark.asyncio
async def test_tts_probe_uses_a_voice_that_matches_the_resource_and_cleans_up(
    store, monkeypatch
):
    from app.services import tts_service

    monkeypatch.setattr(tts_service, "MOCK_MODE", False)
    captured = []

    def record(self, text, output_file, voice_type="", speed_ratio=1.0):
        captured.append((self.resource_id, self.timeout, voice_type, output_file))
        with open(output_file, "wb") as handle:
            handle.write(b"mp3")
        return True

    monkeypatch.setattr(tts_service.TTSClient, "synthesize_speech", record)
    for resource, marker in (("seed-tts-2.0", "_uranus_"), ("seed-tts-1.0", "_moon_")):
        probes.reset_throttle()
        await _save(store, "volcano_tts", {"api_key": KEY, "resource_id": resource})
        assert (await probes.run_probe("volcano_tts")).outcome == "ok"
        used_resource, timeout, voice, output = captured[-1]
        assert used_resource == resource and marker in voice
        assert timeout == probes.PROBE_TIMEOUT_SECONDS
        assert not os.path.exists(os.path.dirname(output))


@pytest.mark.asyncio
async def test_tts_probe_does_not_block_the_event_loop(store, monkeypatch):
    import time

    from app.services import tts_service

    await _save(store, "volcano_tts", {"api_key": KEY})
    monkeypatch.setattr(tts_service, "MOCK_MODE", False)

    def slow(self, text, output_file, voice_type="", speed_ratio=1.0):
        time.sleep(0.3)
        return True

    monkeypatch.setattr(tts_service.TTSClient, "synthesize_speech", slow)
    beats = []

    async def heartbeat():
        while True:
            beats.append(1)
            await asyncio.sleep(0.02)

    task = asyncio.create_task(heartbeat())
    try:
        await probes.run_probe("volcano_tts")
    finally:
        task.cancel()

    assert len(beats) >= 5


# ----------------------------------------------------------------------- ASR


class _FakeSocket:
    def __init__(self, frame=None, silent=False):
        self.frame, self.silent, self.sent = frame, silent, []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def send(self, data):
        self.sent.append(data)

    async def recv(self):
        if self.silent:
            await asyncio.sleep(10)
        return self.frame


async def _save_asr(store):
    await _save(store, "volcano_asr", {"appid": "1234567890", "access_token": KEY})


def _connect_returning(socket, seen=None):
    def connect(url, **kwargs):
        if seen is not None:
            seen.append(kwargs)
        return socket

    return connect


@pytest.mark.asyncio
async def test_asr_probe_ok_when_the_upgrade_succeeds_and_the_server_is_quiet(
    store, monkeypatch
):
    import websockets

    await _save_asr(store)
    seen = []
    monkeypatch.setattr(probes, "ASR_ACK_WAIT_SECONDS", 0.05)
    monkeypatch.setattr(websockets, "connect", _connect_returning(_FakeSocket(silent=True), seen))

    report = await probes.run_probe("volcano_asr")

    assert report.outcome == "ok" and report.verify_level == "handshake"
    headers = seen[0]["additional_headers"]
    assert headers["X-Api-App-Key"] == "1234567890" and headers["X-Api-Access-Key"] == KEY


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status, expected",
    [(401, "invalid_credentials"), (403, "invalid_credentials"),
     (429, "rate_limited"), (502, "upstream_error")],
)
async def test_asr_probe_classifies_a_rejected_upgrade(store, monkeypatch, status, expected):
    import websockets

    await _save_asr(store)

    def reject(url, **kwargs):
        raise InvalidStatus(Response(status, "x", Headers(), b""))

    monkeypatch.setattr(websockets, "connect", reject)

    assert (await probes.run_probe("volcano_asr")).outcome == expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status, body, expected",
    [
        # Bodies observed from the live endpoint on 2026-11-01.
        (401, b'{"error":"load grant: requested grant not found in SaaS storage"}',
         "invalid_credentials"),
        (403, b'{"error":"[resource_id=volc.bigasr.sauc.duration] requested resource not granted"}',
         "not_entitled"),
        (403, b"", "invalid_credentials"),
    ],
)
async def test_asr_probe_tells_a_bad_token_from_an_ungranted_resource(
    store, monkeypatch, status, body, expected
):
    import websockets

    await _save_asr(store)

    def reject(url, **kwargs):
        raise InvalidStatus(Response(status, "x", Headers(), body))

    monkeypatch.setattr(websockets, "connect", reject)

    assert (await probes.run_probe("volcano_asr")).outcome == expected


@pytest.mark.asyncio
async def test_asr_probe_unreachable_on_network_errors(store, monkeypatch):
    import websockets

    await _save_asr(store)

    def refuse(url, **kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(websockets, "connect", refuse)

    assert (await probes.run_probe("volcano_asr")).outcome == "unreachable"


@pytest.mark.asyncio
async def test_asr_probe_reads_an_early_error_frame(store, monkeypatch):
    import websockets

    from app.services.volcano_ws_protocol import ServerMessage

    await _save_asr(store)
    monkeypatch.setattr(websockets, "connect", _connect_returning(_FakeSocket(frame=b"x")))
    monkeypatch.setattr(
        "app.services.volcano_ws_protocol.parse_response",
        lambda frame: ServerMessage(True, None, None, 45000001, "invalid token", 15, 0),
    )

    assert (await probes.run_probe("volcano_asr")).outcome == "invalid_credentials"


@pytest.mark.asyncio
async def test_asr_probe_reads_an_ungranted_resource_from_an_early_error_frame(
    store, monkeypatch
):
    """"not granted" contains the auth hint "grant"; it must still read as
    not_entitled, otherwise a user with valid credentials is told to re-enter
    their token."""
    import websockets

    from app.services.volcano_ws_protocol import ServerMessage

    await _save_asr(store)
    monkeypatch.setattr(websockets, "connect", _connect_returning(_FakeSocket(frame=b"x")))
    monkeypatch.setattr(
        "app.services.volcano_ws_protocol.parse_response",
        lambda frame: ServerMessage(
            True, None, None, 45000001, "requested resource not granted", 15, 0
        ),
    )

    assert (await probes.run_probe("volcano_asr")).outcome == "not_entitled"
