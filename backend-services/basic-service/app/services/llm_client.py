"""Unified LLM chat client supporting OpenAI-compatible and Anthropic-compatible protocols.

Each LLM config group (`LLM_*`, `FAST_LLM_*`, `VIDEO_CUT_LLM_*`, `VL_LLM_*`,
`AGENT_LLM_API_XX_*`) carries an `api_type` (``openai`` | ``anthropic``).
The client dispatches request shape, endpoint path, auth headers and response
parsing based on that field, so callers only deal with OpenAI-style messages.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, List, Literal, Optional

import httpx

from app.logger import get_logger

logger = get_logger(__name__)

ApiType = Literal["openai", "anthropic"]

_DEFAULT_ANTHROPIC_VERSION = "2023-06-01"
_DEFAULT_ANTHROPIC_MAX_TOKENS = 4096


@dataclass(frozen=True)
class LLMCallConfig:
    """Config snapshot for a single LLM call."""

    api_url: str
    api_key: str
    model: str
    api_type: ApiType = "openai"


def normalize_api_type(value: Optional[str]) -> ApiType:
    """Normalize user-supplied api_type to a supported literal, default ``openai``."""
    v = (value or "").strip().lower()
    if v == "anthropic":
        return "anthropic"
    return "openai"


def _split_system_messages(
    messages: List[Dict[str, Any]],
) -> tuple[Optional[str], List[Dict[str, Any]]]:
    """Extract system prompt(s) for Anthropic which wants them at top level."""
    system_chunks: List[str] = []
    rest: List[Dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content", "")
        if role == "system":
            if isinstance(content, str) and content:
                system_chunks.append(content)
            elif isinstance(content, list):
                # Multimodal system content: keep only text parts for Anthropic system field.
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text = part.get("text") or ""
                        if text:
                            system_chunks.append(text)
        else:
            rest.append(m)
    system = "\n\n".join(system_chunks) if system_chunks else None
    return system, rest


async def call_chat(
    messages: List[Dict[str, Any]],
    *,
    config: LLMCallConfig,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
    timeout: float = 90.0,
) -> str:
    """Call an LLM chat endpoint and return the assistant text content.

    Raises:
        ValueError: config missing, unsupported api_type, or malformed response.
        httpx.HTTPStatusError: upstream non-2xx status.
    """
    if not config.api_key or not config.api_url:
        raise ValueError("LLM api_key and api_url must be configured")

    logger.debug(
        f"LLM call: type={config.api_type} model={config.model} "
        f"url={config.api_url} max_tokens={max_tokens}"
    )

    if config.api_type == "anthropic":
        return await _call_anthropic(
            messages,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )
    # default / openai
    return await _call_openai(
        messages,
        config=config,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
    )


async def _call_openai(
    messages: List[Dict[str, Any]],
    *,
    config: LLMCallConfig,
    temperature: float,
    max_tokens: Optional[int],
    timeout: float,
) -> str:
    url = config.api_url.rstrip("/") + "/chat/completions"
    payload: dict = {
        "model": config.model,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens

    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json()

    try:
        text = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        logger.error(f"Unexpected OpenAI LLM response shape: {body}")
        raise ValueError(f"Invalid OpenAI LLM response: {exc}") from exc
    return text or ""


async def _call_anthropic(
    messages: List[Dict[str, Any]],
    *,
    config: LLMCallConfig,
    temperature: float,
    max_tokens: Optional[int],
    timeout: float,
) -> str:
    url = config.api_url.rstrip("/") + "/v1/messages"
    system, rest = _split_system_messages(messages)
    payload: dict = {
        "model": config.model,
        "messages": rest,
        "temperature": temperature,
        "max_tokens": max_tokens or _DEFAULT_ANTHROPIC_MAX_TOKENS,
    }
    if system:
        payload["system"] = system

    # Dual auth headers: native Anthropic uses `x-api-key`; some compat vendors
    # (e.g. Zhipu open.bigmodel.cn/api/anthropic) use `Authorization: Bearer`.
    # Sending both is safe — each server reads the one it knows.
    headers = {
        "x-api-key": config.api_key,
        "Authorization": f"Bearer {config.api_key}",
        "anthropic-version": _DEFAULT_ANTHROPIC_VERSION,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json()

    try:
        blocks = body["content"]
        if not isinstance(blocks, list):
            raise TypeError(f"content is not a list: {type(blocks).__name__}")
        parts = [
            b.get("text", "")
            for b in blocks
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        text = "".join(parts)
    except (KeyError, TypeError) as exc:
        logger.error(f"Unexpected Anthropic LLM response shape: {body}")
        raise ValueError(f"Invalid Anthropic LLM response: {exc}") from exc
    return text


async def stream_chat(
    messages: List[Dict[str, Any]],
    *,
    config: LLMCallConfig,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
    timeout: float = 60.0,
) -> AsyncIterator[str]:
    """Stream an LLM chat response, yielding text chunks as they arrive.

    Abstracts OpenAI- vs Anthropic-format SSE. Callers see a flat stream of
    assistant text pieces regardless of the upstream protocol, and wrap those
    pieces in whatever envelope their client expects.
    """
    if not config.api_key or not config.api_url:
        raise ValueError("LLM api_key and api_url must be configured")

    logger.debug(
        f"LLM stream: type={config.api_type} model={config.model} "
        f"url={config.api_url} max_tokens={max_tokens}"
    )

    if config.api_type == "anthropic":
        agen = _stream_anthropic(
            messages,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )
    else:
        agen = _stream_openai(
            messages,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )

    async for chunk in agen:
        if chunk:
            yield chunk


async def _stream_openai(
    messages: List[Dict[str, Any]],
    *,
    config: LLMCallConfig,
    temperature: float,
    max_tokens: Optional[int],
    timeout: float,
) -> AsyncIterator[str]:
    url = config.api_url.rstrip("/") + "/chat/completions"
    payload: dict = {
        "model": config.model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens

    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code != 200:
                err = (await resp.aread()).decode("utf-8", errors="replace")
                logger.error(
                    f"OpenAI stream upstream error {resp.status_code}: {err[:500]}"
                )
                raise httpx.HTTPStatusError(
                    f"OpenAI stream status {resp.status_code}: {err[:200]}",
                    request=resp.request,
                    response=resp,
                )
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    logger.warning(f"OpenAI stream: invalid JSON chunk: {data[:200]}")
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                piece = delta.get("content")
                if piece:
                    yield piece


async def _stream_anthropic(
    messages: List[Dict[str, Any]],
    *,
    config: LLMCallConfig,
    temperature: float,
    max_tokens: Optional[int],
    timeout: float,
) -> AsyncIterator[str]:
    url = config.api_url.rstrip("/") + "/v1/messages"
    system, rest = _split_system_messages(messages)
    payload: dict = {
        "model": config.model,
        "messages": rest,
        "temperature": temperature,
        "max_tokens": max_tokens or _DEFAULT_ANTHROPIC_MAX_TOKENS,
        "stream": True,
    }
    if system:
        payload["system"] = system

    headers = {
        "x-api-key": config.api_key,
        "Authorization": f"Bearer {config.api_key}",
        "anthropic-version": _DEFAULT_ANTHROPIC_VERSION,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code != 200:
                err = (await resp.aread()).decode("utf-8", errors="replace")
                logger.error(
                    f"Anthropic stream upstream error {resp.status_code}: {err[:500]}"
                )
                raise httpx.HTTPStatusError(
                    f"Anthropic stream status {resp.status_code}: {err[:200]}",
                    request=resp.request,
                    response=resp,
                )
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line.split(":", 1)[1].strip()
                if not data:
                    continue
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    logger.warning(
                        f"Anthropic stream: invalid JSON chunk: {data[:200]}"
                    )
                    continue
                etype = obj.get("type")
                if etype == "content_block_delta":
                    delta = obj.get("delta") or {}
                    if delta.get("type") == "text_delta":
                        piece = delta.get("text")
                        if piece:
                            yield piece
                elif etype == "message_stop":
                    break
