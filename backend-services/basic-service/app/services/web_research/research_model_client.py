"""辅助模型的有界 HTTP 边界；不解释报告或执行供应商工具。"""
import asyncio
import json
import math
import re
from urllib.parse import urlsplit

import httpx

from app.models.web_research_models import WebResearchError

RAW_LIMIT = 524288
TEXT_LIMIT = 32768
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
# 零宽与双向控制符可以在视觉上伪装来源边界（spec D-09）。
INVISIBLE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")
# 全角尖括号无法闭合提示块，但会被模型读成标记；统一中和为原文符号。
PROMPT_BRACKETS = str.maketrans({"<": "＜", ">": "＞"})


def sanitize_for_prompt_block(text):
    """外部网页文本进入提示块前的中性化；不改变可读语义（§3.5 / D-09）。"""
    return INVISIBLE.sub("", text).translate(PROMPT_BRACKETS)


def normalize_unicode(text):
    """合并合法代理对，拒绝孤立代理项，并保留换行和制表符。"""
    if not isinstance(text, str):
        raise ValueError("invalid_text")
    normalized = text.encode("utf-16", "surrogatepass").decode("utf-16")
    return CONTROL.sub("", INVISIBLE.sub("", normalized))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_key")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError("invalid_constant")


def _check_depth(value, depth=0):
    if depth > 64:
        raise ValueError("invalid_depth")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("invalid_constant")
    if isinstance(value, dict):
        for child in value.values():
            _check_depth(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _check_depth(child, depth + 1)


def strict_json_object(raw):
    result = json.loads(
        raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant
    )
    if not isinstance(result, dict):
        raise ValueError("invalid_object")
    _check_depth(result)
    return result


def validate_model_text(text):
    try:
        text = normalize_unicode(text)
        if not text.strip():
            raise ValueError("empty_text")
    except (ValueError, UnicodeError, RecursionError):
        raise WebResearchError("research_model_response_invalid") from None
    if len(text.encode("utf-8")) > TEXT_LIMIT:
        raise WebResearchError("research_model_response_too_large")
    return text


def _valid_endpoint(parsed):
    return (
        parsed.scheme in {"http", "https"}
        and bool(parsed.hostname)
        and parsed.username is None
        and parsed.password is None
    )


def validate_model_config(config):
    """只校验可信模型配置，不使用网页抓取的公网限制。"""
    try:
        url = config.api_url
        if not isinstance(url, str) or re.search(
            r"[\x00-\x20\x7f-\x9f\\]", url
        ):
            raise ValueError("invalid_url")
        parsed = urlsplit(url)
        if not _valid_endpoint(parsed) or "?" in url or "#" in url:
            raise ValueError("invalid_url")
        _ = parsed.port
        if config.api_type not in {"openai", "anthropic"}:
            raise ValueError("invalid_protocol")
        httpx.URL(url)
    except (ValueError, httpx.InvalidURL):
        raise WebResearchError("configuration_invalid") from None


def _request(config, messages, output):
    validate_model_config(config)
    url = config.api_url.rstrip("/")
    endpoint = (
        "/messages" if config.api_type == "anthropic" else "/chat/completions"
    )
    if not url.endswith(endpoint):
        url += endpoint if url.endswith("/v1") else "/v1" + endpoint
    headers = {"Accept-Encoding": "identity"}
    payload = {"model": config.model_name, "max_tokens": output}
    if config.api_type == "anthropic":
        headers.update(
            {"x-api-key": config.api_key, "anthropic-version": "2023-06-01"}
        )
        payload.update(
            system=messages[0]["content"] if messages else "",
            messages=messages[1:],
        )
    else:
        headers["Authorization"] = "Bearer " + config.api_key
        payload.update(messages=messages, temperature=0.2)
    return url, headers, payload


def _response_length(response):
    status = response.status_code
    if status != 200:
        code = {
            401: "research_model_rejected",
            403: "research_model_rejected",
            429: "research_model_rate_limited",
        }.get(status, "research_model_unavailable")
        raise WebResearchError(code)
    if (
        response.headers.get("content-encoding", "identity").lower().strip()
        != "identity"
    ):
        raise WebResearchError("research_model_response_invalid")
    content_type = response.headers.get("content-type")
    if content_type is not None:
        media = content_type.split(";", 1)[0].strip().lower()
        if not re.fullmatch(
            r"application/(?:json|[a-z0-9!#$&^_.+-]+\+json)", media
        ):
            raise WebResearchError("research_model_response_invalid")
    length = response.headers.get("content-length")
    if length is None:
        return None
    if not re.fullmatch(r"[0-9]+", length):
        raise WebResearchError("research_model_response_invalid")
    length = length.lstrip("0") or "0"
    if len(length) > 6 or int(length) > RAW_LIMIT:
        raise WebResearchError("research_model_response_too_large")
    return int(length)


async def _read_response(response):
    length = _response_length(response)
    raw = bytearray()
    async for chunk in response.aiter_raw(chunk_size=16384):
        if len(chunk) > RAW_LIMIT - len(raw):
            raise WebResearchError("research_model_response_too_large")
        raw.extend(chunk)
    if length is not None and len(raw) != length:
        raise WebResearchError("research_model_response_invalid")
    return raw


def _openai_text(result):
    choices = result.get("choices")
    if not isinstance(choices, list) or not 1 <= len(choices) <= 8:
        raise ValueError("invalid_choices")
    choice = choices[0]
    if not isinstance(choice, dict) or not isinstance(
        choice.get("message"), dict
    ):
        raise ValueError("invalid_message")
    message = _openai_message(choice)
    reason = choice.get("finish_reason")
    if reason in ("length", "content_filter", "tool_calls", "function_call"):
        raise WebResearchError("research_model_output_incomplete")
    if reason not in (None, "stop"):
        raise ValueError("invalid_finish_reason")
    content = message.get("content")
    if isinstance(content, str):
        return content
    return _text_blocks(content, anthropic=False)


def _openai_message(choice):
    message = choice["message"]
    if "role" in message and message["role"] != "assistant":
        raise ValueError("invalid_role")
    if any(
        message.get(key) for key in ("tool_calls", "function_call", "refusal")
    ):
        raise WebResearchError("research_model_output_incomplete")
    return message


def _text_blocks(content, anthropic):
    if not isinstance(content, list) or not 1 <= len(content) <= 32:
        raise ValueError("invalid_content")
    return "".join(_block_text(block, anthropic) for block in content)


def _block_text(block, anthropic):
    if not isinstance(block, dict):
        raise ValueError("invalid_block")
    kind = block.get("type")
    if anthropic and kind in ("thinking", "redacted_thinking"):
        return ""
    if anthropic and kind == "tool_use":
        raise WebResearchError("research_model_output_incomplete")
    if kind != "text" or not isinstance(block.get("text"), str):
        raise ValueError("invalid_block")
    return normalize_unicode(block["text"])


def _parse_response(raw, api_type):
    try:
        result = strict_json_object(raw.decode("utf-8"))
        if api_type == "openai":
            text = _openai_text(result)
        else:
            reason = result.get("stop_reason")
            if reason in ("max_tokens", "tool_use", "refusal"):
                raise WebResearchError("research_model_output_incomplete")
            if reason not in (None, "end_turn", "stop_sequence"):
                raise ValueError("invalid_stop_reason")
            text = _text_blocks(result.get("content"), anthropic=True)
        return validate_model_text(text)
    except (ValueError, UnicodeError, RecursionError):
        raise WebResearchError("research_model_response_invalid") from None


def _check_deadline(deadline):
    if asyncio.get_running_loop().time() >= deadline:
        raise WebResearchError("research_model_timeout")


async def _close_completely(close):
    """关闭可以收束，但重复取消不能留下半关闭的连接。"""
    task = asyncio.create_task(close())
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
        except Exception:
            break
    if cancelled:
        if not task.cancelled():
            task.exception()
        raise asyncio.CancelledError
    task.result()


class _ClosingStream(httpx.AsyncByteStream):
    def __init__(self, stream):
        self.stream = stream

    def __aiter__(self):
        return self.stream.__aiter__()

    async def aclose(self):
        # aiter_raw 在 EOF 也会主动关闭；屏障须位于这个共同边界。
        await _close_completely(self.stream.aclose)


async def _close_exchange(context, client):
    try:
        if context is not None:
            await context.__aexit__(None, None, None)
    finally:
        await client.aclose()


class ResearchModelClient:
    def __init__(self, transport=None, on_dispatch=None):
        self.transport = transport
        self.on_dispatch = on_dispatch

    async def complete(self, config, messages, output, *, deadline):
        _check_deadline(deadline)
        request = _request(config, messages, output)
        _check_deadline(deadline)
        try:
            async with asyncio.timeout_at(deadline):
                raw = await self._exchange(request, deadline)
                _check_deadline(deadline)
                text = _parse_response(raw, config.api_type)
                _check_deadline(deadline)
                await asyncio.sleep(0)
                _check_deadline(deadline)
                return text
        except (TimeoutError, httpx.TimeoutException):
            raise WebResearchError("research_model_timeout") from None
        except httpx.RemoteProtocolError:
            raise WebResearchError("research_model_response_invalid") from None
        except httpx.HTTPError:
            raise WebResearchError("research_model_unavailable") from None

    async def _exchange(self, request, deadline):
        url, headers, payload = request
        remaining = deadline - asyncio.get_running_loop().time()
        timeout = httpx.Timeout(min(10, remaining), connect=min(5, remaining))
        client = httpx.AsyncClient(
            transport=self.transport,
            trust_env=False,
            follow_redirects=False,
            timeout=timeout,
        )
        context, cancelled = None, False
        try:
            await client.__aenter__()
            _check_deadline(deadline)
            if self.on_dispatch:
                self.on_dispatch()
            pending = client.stream("POST", url, headers=headers, json=payload)
            response = await pending.__aenter__()
            context = pending
            response.stream = _ClosingStream(response.stream)
            return await _read_response(response)
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            try:
                await _close_completely(
                    lambda: _close_exchange(context, client)
                )
            except BaseException:
                if cancelled:
                    raise asyncio.CancelledError from None
                raise
