"""Tests for app.services.llm_client — the shared OpenAI/Anthropic adapter.

These tests avoid real network calls by monkeypatching `httpx.AsyncClient` so
both the non-streaming (`call_chat`) and streaming (`stream_chat`) dispatchers
can be verified against synthetic provider responses.
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any, Dict, List

import httpx
import pytest

from app.services.llm_client import (
    LLMCallConfig,
    _split_system_messages,
    call_chat,
    normalize_api_type,
    stream_chat,
)


# ── normalize_api_type ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, "openai"),
        ("", "openai"),
        ("OPENAI", "openai"),
        ("OpenAI ", "openai"),
        ("anthropic", "anthropic"),
        ("Anthropic", "anthropic"),
        ("bogus", "openai"),
        ("null", "openai"),
    ],
)
def test_normalize_api_type(value, expected):
    assert normalize_api_type(value) == expected


# ── _split_system_messages ─────────────────────────────────────────────────


def test_split_system_messages_joins_multiple_system_chunks():
    msgs = [
        {"role": "system", "content": "A"},
        {"role": "user", "content": "hi"},
        {"role": "system", "content": "B"},
    ]
    system, rest = _split_system_messages(msgs)
    assert system == "A\n\nB"
    assert rest == [{"role": "user", "content": "hi"}]


def test_split_system_messages_handles_multimodal_content():
    msgs = [
        {"role": "system", "content": [{"type": "text", "text": "sys"}, {"type": "image", "url": "x"}]},
        {"role": "user", "content": "hi"},
    ]
    system, rest = _split_system_messages(msgs)
    assert system == "sys"
    assert rest == [{"role": "user", "content": "hi"}]


def test_split_system_messages_no_system_returns_none():
    msgs = [{"role": "user", "content": "hi"}]
    system, rest = _split_system_messages(msgs)
    assert system is None
    assert rest == msgs


# ── Non-streaming dispatch via call_chat ───────────────────────────────────


class _StubResponse:
    def __init__(self, status_code: int, body: Any):
        self.status_code = status_code
        self._body = body
        self.request = None
        self.text = json.dumps(body) if isinstance(body, dict) else str(body)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=self.request, response=self)  # type: ignore[arg-type]

    def json(self):
        return self._body


class _StubAsyncClient:
    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs
        self.last_post: Dict[str, Any] = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, *, json=None, headers=None):  # noqa: A002 - mimic httpx
        self.last_post = {"url": url, "json": json, "headers": headers}
        return _StubAsyncClient._next_response


_StubAsyncClient._next_response = None  # type: ignore[attr-defined]


@pytest.fixture
def stub_httpx(monkeypatch):
    """Monkeypatch httpx.AsyncClient for non-streaming tests."""
    monkeypatch.setattr(
        "app.services.llm_client.httpx.AsyncClient", _StubAsyncClient
    )
    yield _StubAsyncClient


@pytest.mark.asyncio
async def test_call_chat_openai_parses_choices(stub_httpx):
    stub_httpx._next_response = _StubResponse(
        200,
        {"choices": [{"message": {"content": "hello"}}]},
    )
    cfg = LLMCallConfig(
        api_url="https://example.com/v1",
        api_key="k",
        model="m",
        api_type="openai",
    )
    out = await call_chat([{"role": "user", "content": "hi"}], config=cfg)
    assert out == "hello"


@pytest.mark.asyncio
async def test_call_chat_anthropic_parses_content_blocks(stub_httpx):
    stub_httpx._next_response = _StubResponse(
        200,
        {
            "content": [
                {"type": "text", "text": "hello "},
                {"type": "text", "text": "world"},
            ]
        },
    )
    cfg = LLMCallConfig(
        api_url="https://anthropic.example/",
        api_key="k",
        model="m",
        api_type="anthropic",
    )
    out = await call_chat(
        [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
        ],
        config=cfg,
    )
    assert out == "hello world"


@pytest.mark.asyncio
async def test_call_chat_openai_invalid_shape_raises(stub_httpx):
    stub_httpx._next_response = _StubResponse(200, {"unexpected": "shape"})
    cfg = LLMCallConfig(api_url="u", api_key="k", model="m", api_type="openai")
    with pytest.raises(ValueError, match="Invalid OpenAI LLM response"):
        await call_chat([{"role": "user", "content": "hi"}], config=cfg)


@pytest.mark.asyncio
async def test_call_chat_anthropic_invalid_shape_raises(stub_httpx):
    stub_httpx._next_response = _StubResponse(200, {"content": "oops-not-a-list"})
    cfg = LLMCallConfig(api_url="u", api_key="k", model="m", api_type="anthropic")
    with pytest.raises(ValueError, match="Invalid Anthropic LLM response"):
        await call_chat([{"role": "user", "content": "hi"}], config=cfg)


@pytest.mark.asyncio
async def test_call_chat_raises_when_config_missing():
    cfg = LLMCallConfig(api_url="", api_key="", model="m", api_type="openai")
    with pytest.raises(ValueError, match="api_key and api_url"):
        await call_chat([], config=cfg)


@pytest.mark.asyncio
async def test_call_chat_anthropic_sends_dual_auth_headers_and_strips_system(stub_httpx):
    stub_httpx._next_response = _StubResponse(
        200, {"content": [{"type": "text", "text": "ok"}]}
    )
    instance_holder: Dict[str, _StubAsyncClient] = {}

    orig_init = _StubAsyncClient.__init__

    def _capture_init(self, *args, **kwargs):
        orig_init(self, *args, **kwargs)
        instance_holder["client"] = self

    _StubAsyncClient.__init__ = _capture_init  # type: ignore[method-assign]

    try:
        await call_chat(
            [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "hi"},
            ],
            config=LLMCallConfig(
                api_url="https://open.bigmodel.cn/api/anthropic/",
                api_key="sk-zhipu",
                model="glm-4.6",
                api_type="anthropic",
            ),
        )
    finally:
        _StubAsyncClient.__init__ = orig_init  # type: ignore[method-assign]

    client = instance_holder["client"]
    assert client.last_post["url"].endswith("/v1/messages")
    assert client.last_post["headers"]["x-api-key"] == "sk-zhipu"
    assert client.last_post["headers"]["Authorization"] == "Bearer sk-zhipu"
    body = client.last_post["json"]
    assert body["system"] == "sys"
    assert body["messages"] == [{"role": "user", "content": "hi"}]
    assert "max_tokens" in body  # Anthropic default backfill


# ── Streaming dispatch via stream_chat ─────────────────────────────────────


class _StubStreamResponse:
    def __init__(self, status_code: int, lines: List[str]):
        self.status_code = status_code
        self._lines = lines
        self.request = None

    async def aread(self):  # for error path
        return b""

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _StubStreamClient:
    last_request: Dict[str, Any] = {}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def stream(self, method, url, *, json=None, headers=None):  # noqa: A002
        _StubStreamClient.last_request = {
            "method": method,
            "url": url,
            "json": json,
            "headers": headers,
        }
        return self._cm()

    @asynccontextmanager
    async def _cm(self):
        yield _StubStreamClient._next_response  # type: ignore[attr-defined]


_StubStreamClient._next_response = None  # type: ignore[attr-defined]


@pytest.fixture
def stub_stream_httpx(monkeypatch):
    monkeypatch.setattr(
        "app.services.llm_client.httpx.AsyncClient", _StubStreamClient
    )
    yield _StubStreamClient


@pytest.mark.asyncio
async def test_stream_chat_openai_yields_delta_content_and_stops_on_done(stub_stream_httpx):
    stub_stream_httpx._next_response = _StubStreamResponse(
        200,
        [
            "data: " + json.dumps({"choices": [{"delta": {"content": "Hel"}}]}),
            "",
            "data: " + json.dumps({"choices": [{"delta": {"content": "lo"}}]}),
            "data: " + json.dumps({"choices": [{"delta": {}}]}),  # no content
            "data: [DONE]",
            "data: " + json.dumps({"choices": [{"delta": {"content": "IGNORED"}}]}),
        ],
    )
    cfg = LLMCallConfig(api_url="u", api_key="k", model="m", api_type="openai")
    chunks: List[str] = []
    async for piece in stream_chat([{"role": "user", "content": "hi"}], config=cfg):
        chunks.append(piece)
    assert chunks == ["Hel", "lo"]
    assert stub_stream_httpx.last_request["json"]["stream"] is True


@pytest.mark.asyncio
async def test_stream_chat_openai_skips_unparseable_chunks(stub_stream_httpx):
    stub_stream_httpx._next_response = _StubStreamResponse(
        200,
        [
            "data: this-is-not-json",
            "data: " + json.dumps({"choices": [{"delta": {"content": "ok"}}]}),
            "data: [DONE]",
        ],
    )
    cfg = LLMCallConfig(api_url="u", api_key="k", model="m", api_type="openai")
    out = [c async for c in stream_chat([{"role": "user", "content": "hi"}], config=cfg)]
    assert out == ["ok"]


@pytest.mark.asyncio
async def test_stream_chat_anthropic_yields_text_delta_and_stops_on_message_stop(stub_stream_httpx):
    stub_stream_httpx._next_response = _StubStreamResponse(
        200,
        [
            "event: message_start",
            "data: " + json.dumps({"type": "message_start", "message": {}}),
            "",
            "event: content_block_delta",
            "data: " + json.dumps(
                {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hel"}}
            ),
            "event: content_block_delta",
            "data: " + json.dumps(
                {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "lo"}}
            ),
            # Non-text delta (e.g. input_json_delta) should be ignored.
            "event: content_block_delta",
            "data: " + json.dumps(
                {"type": "content_block_delta", "delta": {"type": "input_json_delta", "partial_json": "{}"}}
            ),
            "event: message_stop",
            "data: " + json.dumps({"type": "message_stop"}),
            # Anything after message_stop is discarded.
            "event: content_block_delta",
            "data: " + json.dumps(
                {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "IGNORED"}}
            ),
        ],
    )
    cfg = LLMCallConfig(
        api_url="https://anthropic.example",
        api_key="k",
        model="claude-3",
        api_type="anthropic",
    )
    out = [c async for c in stream_chat([{"role": "user", "content": "hi"}], config=cfg)]
    assert out == ["Hel", "lo"]
    assert stub_stream_httpx.last_request["url"].endswith("/v1/messages")
    body = stub_stream_httpx.last_request["json"]
    assert body["stream"] is True
    assert body["max_tokens"] == 4096  # anthropic default backfill


@pytest.mark.asyncio
async def test_stream_chat_raises_on_missing_config():
    cfg = LLMCallConfig(api_url="", api_key="", model="m", api_type="openai")
    with pytest.raises(ValueError):
        async for _ in stream_chat([{"role": "user", "content": "hi"}], config=cfg):
            pass


@pytest.mark.asyncio
async def test_stream_chat_openai_http_error_raises(stub_stream_httpx):
    stub_stream_httpx._next_response = _StubStreamResponse(429, [])
    cfg = LLMCallConfig(api_url="u", api_key="k", model="m", api_type="openai")
    with pytest.raises(httpx.HTTPStatusError):
        async for _ in stream_chat([{"role": "user", "content": "hi"}], config=cfg):
            pass
