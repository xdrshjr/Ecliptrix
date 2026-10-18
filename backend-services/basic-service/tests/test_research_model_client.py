"""研究模型的真实流边界，不预缓冲 Response。"""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.models.web_research_models import WebResearchError


class Stream(httpx.AsyncByteStream):
    def __init__(self, content, gate=None):
        self.content, self.gate = content, gate
        self.reads, self.closed = 0, False

    async def __aiter__(self):
        self.reads += 1
        if self.gate:
            self.gate.set()
            await asyncio.Event().wait()
        for start in range(0, len(self.content), 8192):
            yield self.content[start : start + 8192]

    async def aclose(self):
        self.closed = True


def config(kind="openai", url="http://localhost:9999"):
    return SimpleNamespace(
        api_type=kind, api_url=url, api_key="private-key", model_name="research"
    )


def envelope(text="有效文本"):
    return {
        "choices": [{"message": {"content": text}, "finish_reason": "stop"}]
    }


async def call(raw, status=200, headers=None, kind="openai"):
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    stream = Stream(raw if isinstance(raw, bytes) else json.dumps(raw).encode())
    requests, dispatched = [], []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, headers=headers or {}, stream=stream)

    client = ResearchModelClient(
        transport=httpx.MockTransport(handler),
        on_dispatch=lambda: dispatched.append(True),
    )
    try:
        result = await client.complete(
            config(kind),
            [
                {"role": "system", "content": "系统"},
                {"role": "user", "content": "任务"},
            ],
            128,
            deadline=asyncio.get_running_loop().time() + 5,
        )
        return result, stream, requests, dispatched
    finally:
        assert stream.closed


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,code,category",
    [
        (302, "research_model_unavailable", "transient"),
        (401, "research_model_rejected", "configuration"),
        (403, "research_model_rejected", "configuration"),
        (429, "research_model_rate_limited", "transient"),
        (500, "research_model_unavailable", "transient"),
    ],
)
async def test_status_never_reads_body(status, code, category):
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    stream = Stream(b"secret provider error")
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            status,
            headers={"location": "https://elsewhere.test"},
            stream=stream,
        )

    client = ResearchModelClient(transport=httpx.MockTransport(handler))
    with pytest.raises(WebResearchError) as error:
        await client.complete(
            config(), [], 10, deadline=asyncio.get_running_loop().time() + 2
        )
    assert error.value.error_code == code
    assert error.value.failure_class == category
    assert stream.closed and stream.reads == 0 and len(requests) == 1
    assert "secret" not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "raw",
    [
        b"null",
        b"[]",
        b'{"x":NaN}',
        b'{"x":1,"x":2}',
        b"\xff",
        b'{"choices":[]}',
        b'{"choices":[null]}',
        json.dumps(envelope("\ud800")).encode(),
        json.dumps(envelope([{"type": "image", "text": "x"}])).encode(),
        json.dumps(envelope(None)).encode(),
    ],
)
async def test_invalid_envelopes(raw):
    with pytest.raises(
        WebResearchError, match="research_model_response_invalid"
    ):
        await call(raw)


@pytest.mark.asyncio
async def test_protocol_text_blocks_and_surrogates():
    result, _, requests, dispatched = await call(
        envelope(
            [
                {"type": "text", "text": "A\u0000\n"},
                {"type": "text", "text": "\ud83d\ude00"},
            ]
        )
    )
    assert result == "A\n😀"
    assert requests[0].headers["accept-encoding"] == "identity"
    assert requests[0].url.path == "/v1/chat/completions" and dispatched == [
        True
    ]
    result, _, requests, _ = await call(
        {
            "content": [
                {"type": "thinking", "thinking": "unused"},
                {"type": "text", "text": "正文"},
            ],
            "stop_reason": "end_turn",
        },
        kind="anthropic",
    )
    assert result == "正文" and requests[0].url.path == "/v1/messages"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload,kind",
    [
        (
            {"choices": [{"message": {"content": "x", "tool_calls": [{}]}}]},
            "openai",
        ),
        (
            {
                "choices": [
                    {"message": {"content": "x"}, "finish_reason": "length"}
                ]
            },
            "openai",
        ),
        ({"content": [{"type": "tool_use"}]}, "anthropic"),
        (
            {
                "content": [{"type": "text", "text": "x"}],
                "stop_reason": "max_tokens",
            },
            "anthropic",
        ),
    ],
)
async def test_incomplete_outputs(payload, kind):
    with pytest.raises(
        WebResearchError, match="research_model_output_incomplete"
    ):
        await call(payload, kind=kind)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers,code",
    [
        ({"content-length": "524289"}, "research_model_response_too_large"),
        ({"content-length": "-1"}, "research_model_response_invalid"),
        ({"content-length": "1"}, "research_model_response_invalid"),
        ({"content-encoding": "gzip"}, "research_model_response_invalid"),
        ({"content-type": "text/html"}, "research_model_response_invalid"),
    ],
)
async def test_headers(headers, code):
    with pytest.raises(WebResearchError, match=code):
        await call(envelope(), headers=headers)


@pytest.mark.asyncio
async def test_exact_raw_limit_and_text_limit():
    payload = json.dumps(envelope("x")).encode()
    exact = payload + b" " * (524288 - len(payload))
    assert (await call(exact))[0] == "x"
    with pytest.raises(
        WebResearchError, match="research_model_response_too_large"
    ):
        await call(exact + b" ")
    assert len((await call(envelope("x" * 32768)))[0]) == 32768
    with pytest.raises(
        WebResearchError, match="research_model_response_too_large"
    ):
        await call(envelope("x" * 32769))


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [True, False])
async def test_slow_stream_cancel_and_timeout_close(cancel):
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    gate = asyncio.Event()
    stream = Stream(b"", gate)
    client = ResearchModelClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, stream=stream)
        )
    )
    task = asyncio.create_task(
        client.complete(
            config(),
            [],
            10,
            deadline=asyncio.get_running_loop().time()
            + (10 if cancel else 0.03),
        )
    )
    await gate.wait()
    if cancel:
        task.cancel()
    with pytest.raises(asyncio.CancelledError if cancel else WebResearchError):
        await task
    assert stream.closed


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "https://x:wrong",
        "https://u:p@x",
        "https://x/?secret=y",
        "https://x/#x",
        "https://x/\\x",
        "https://x/\nx",
    ],
)
async def test_invalid_configuration_never_dispatches(url):
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    attempts = []
    client = ResearchModelClient(on_dispatch=lambda: attempts.append(True))
    with pytest.raises(WebResearchError, match="configuration_invalid"):
        await client.complete(
            config(url=url),
            [],
            10,
            deadline=asyncio.get_running_loop().time() + 2,
        )
    assert attempts == []


@pytest.mark.asyncio
async def test_path_headers_timeouts_and_exact_json_length():
    result, _, requests, _ = await call(
        envelope(),
        headers={
            "content-length": str(len(json.dumps(envelope()).encode())),
            "content-type": "application/problem+json; charset=utf-8",
        },
    )
    request = requests[0]
    assert result == "有效文本"
    assert request.extensions["timeout"]["connect"] <= 5
    assert request.extensions["timeout"]["read"] <= 10
    payload = json.loads(request.content)
    assert (
        payload["max_tokens"] == 128
        and "tools" not in payload
        and "stream" not in payload
    )


@pytest.mark.asyncio
async def test_zero_padded_length_remains_bounded_without_int_conversion_failure():
    payload = json.dumps(envelope()).encode()
    assert (
        await call(
            payload, headers={"content-length": "0" * 5000 + str(len(payload))}
        )
    )[0] == "有效文本"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        b'{"choices":[{"message":{"content":"x"}}],"ignored":1e999}',
        b'{"ignored":' + b"[" * 70 + b"0" + b"]" * 70 + b"}",
        {"choices": [{"message": {"role": "user", "content": "x"}}]},
        {"choices": [{"message": {"content": []}}]},
        {"choices": [{"message": {"content": [None]}}]},
        {"choices": [{"message": {"content": "x"}, "finish_reason": []}]},
    ],
)
async def test_nonfinite_depth_and_additional_envelope_shapes(payload):
    with pytest.raises(
        WebResearchError, match="research_model_response_invalid"
    ):
        await call(payload)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["deadline", "cancel"])
async def test_synchronous_parse_cannot_publish_late_success(monkeypatch, kind):
    import app.services.web_research.research_model_client as module

    parse = module._parse_response
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 10

    def delayed(*args):
        text = parse(*args)
        if kind == "deadline":
            # 响应读取并解析后才推进时钟，避免客户端启动耗尽短预算而未发送。
            monkeypatch.setattr(loop, "time", lambda: deadline + 1)
        else:
            asyncio.get_running_loop().call_soon(asyncio.current_task().cancel)
        return text

    monkeypatch.setattr(module, "_parse_response", delayed)
    stream = Stream(json.dumps(envelope()).encode())
    client = module.ResearchModelClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, stream=stream)
        )
    )
    error_type = (
        asyncio.CancelledError if kind == "cancel" else WebResearchError
    )
    with pytest.raises(error_type):
        await client.complete(
            config(),
            [],
            10,
            deadline=deadline,
        )
    assert stream.reads == 1
    assert stream.closed


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exception,code",
    [
        (httpx.ConnectError("private"), "research_model_unavailable"),
        (httpx.ReadTimeout("private"), "research_model_timeout"),
        (
            httpx.RemoteProtocolError("private"),
            "research_model_response_invalid",
        ),
    ],
)
async def test_transport_errors_do_not_retry(exception, code):
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    attempts = []

    def handler(_):
        raise exception

    client = ResearchModelClient(
        transport=httpx.MockTransport(handler),
        on_dispatch=lambda: attempts.append(True),
    )
    with pytest.raises(WebResearchError, match=code) as caught:
        await client.complete(
            config(), [], 10, deadline=asyncio.get_running_loop().time() + 2
        )
    assert attempts == [True] and "private" not in str(caught.value)


@pytest.mark.asyncio
async def test_expired_deadline_never_dispatches():
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    attempts = []
    with pytest.raises(WebResearchError, match="research_model_timeout"):
        await ResearchModelClient(
            on_dispatch=lambda: attempts.append(True)
        ).complete(
            config(), [], 10, deadline=asyncio.get_running_loop().time() - 1
        )
    assert attempts == []


@pytest.mark.asyncio
@pytest.mark.parametrize("eof", [False, True])
async def test_repeated_cancellation_waits_for_response_and_transport_close(
    eof,
):
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    reading, closing, release = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )

    class ClosingStream(Stream):
        async def aclose(self):
            closing.set()
            await release.wait()
            self.closed = True

    stream = ClosingStream(
        json.dumps(envelope()).encode(), None if eof else reading
    )

    class ClosingTransport(httpx.MockTransport):
        closed = False

        async def aclose(self):
            self.closed = True

    transport = ClosingTransport(lambda _: httpx.Response(200, stream=stream))
    client = ResearchModelClient(transport=transport)
    task = asyncio.create_task(
        client.complete(
            config(), [], 10, deadline=asyncio.get_running_loop().time() + 10
        )
    )
    await (closing.wait() if eof else reading.wait())
    task.cancel()
    await closing.wait()
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert stream.closed and transport.closed


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel_during_close", [False, True])
async def test_close_failure_cannot_override_cancellation(cancel_during_close):
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    reading, closing, release = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )

    class FailingCloseStream(Stream):
        async def aclose(self):
            closing.set()
            await release.wait()
            raise httpx.ReadError("private closing failure")

    stream = FailingCloseStream(
        json.dumps(envelope()).encode(),
        None if cancel_during_close else reading,
    )
    client = ResearchModelClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, stream=stream)
        )
    )
    task = asyncio.create_task(
        client.complete(
            config(), [], 10, deadline=asyncio.get_running_loop().time() + 10
        )
    )
    await (closing.wait() if cancel_during_close else reading.wait())
    task.cancel()
    await closing.wait()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
