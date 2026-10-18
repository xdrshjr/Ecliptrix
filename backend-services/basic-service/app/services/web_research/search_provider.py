"""固定搜索端点：先限制原始传输，再验证有限的消费字段。"""
import json
import ipaddress
import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.models.web_research_models import WebResearchError
from .provenance import clip_bytes

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
MAX_RESPONSE_BYTES = 1_048_576
MAX_ITEMS = 32


RETRY_AFTER_LIMIT = 2.0


def _retry_after(headers):
    """429 的 Retry-After，上限 2s；缺失或非数字按 0 处理（D-12）。"""
    try:
        return max(0.0, min(RETRY_AFTER_LIMIT, float(headers.get("retry-after", "0"))))
    except (TypeError, ValueError):
        return 0.0


def _check_status(status, headers=None):
    if status == 200:
        return
    codes = {401: "provider_rejected", 403: "provider_rejected",
             429: "provider_rate_limited", 432: "provider_quota_exceeded",
             433: "provider_quota_exceeded", 400: "provider_request_invalid",
             422: "provider_request_invalid"}
    error = WebResearchError(codes.get(status, "upstream_error"))
    if status == 429 and headers is not None:
        error.retry_after = _retry_after(headers)
    raise error


def _check_headers(headers):
    if headers.get("content-encoding", "identity").strip().lower() != "identity":
        raise WebResearchError("provider_response_invalid")
    content_type = headers.get("content-type")
    if content_type is not None:
        mime = content_type.split(";", 1)[0].strip().lower()
        if mime != "application/json" and not (
                mime.startswith("application/") and mime.endswith("+json")):
            raise WebResearchError("provider_response_invalid")
    try:
        length = int(headers.get("content-length", "0"))
    except ValueError:
        length = 0
    if length > MAX_RESPONSE_BYTES:
        raise WebResearchError("provider_response_too_large")


def _reject_constant(_value):
    raise ValueError("invalid_json_constant")


def _parse(raw):
    try:
        body = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise WebResearchError("provider_response_invalid") from None
    if not isinstance(body, dict):
        raise WebResearchError("provider_response_invalid")
    return body


async def fetch_search_response(api_key, payload):
    """不读取错误 body，不启动解压器，所有退出路径均关闭响应。"""
    timeout = httpx.Timeout(10, connect=5)
    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False,
                                     follow_redirects=False) as client:
            async with client.stream("POST", TAVILY_SEARCH_URL, json=payload,
                    headers={"Authorization": f"Bearer {api_key}",
                             "Accept-Encoding": "identity"}) as response:
                _check_status(response.status_code, response.headers)
                _check_headers(response.headers)
                raw = bytearray()
                async for chunk in response.aiter_raw(chunk_size=16384):
                    if len(chunk) > MAX_RESPONSE_BYTES - len(raw):
                        raise WebResearchError("provider_response_too_large")
                    raw.extend(chunk)
                return _parse(raw)
    except httpx.TimeoutException:
        raise WebResearchError("upstream_timeout") from None
    except httpx.HTTPError:
        raise WebResearchError("upstream_error") from None


@dataclass
class NormalizedSearchPayload:
    results: list
    images: list
    discarded_results: int
    discarded_images: int


def _text(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError("invalid_text")
    # JSON 转义代理对和直接传入的测试值统一成合法 Unicode。
    return value.encode("utf-16-le", "surrogatepass").decode("utf-16-le")


def _url(value):
    try:
        value = _text(value)
        if not 1 <= len(value) <= 4096 or any(
                ch.isspace() or unicodedata.category(ch) == "Cc" or ch == "\\"
                for ch in value):
            return None
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            return None
        if parts.username is not None or parts.password is not None:
            return None
        parts.port  # 触发非法端口校验，即使后续不使用显式端口。
        if not _valid_host(parts):
            return None
        return value
    except (ValueError, UnicodeError):
        return None


def _valid_host(parts):
    host = parts.hostname
    if parts.netloc.startswith("["):
        closing = parts.netloc.index("]")
        suffix = parts.netloc[closing + 1:]
        if suffix and not re.fullmatch(r":[0-9]+", suffix):
            return False
        ipaddress.IPv6Address(host)
        return True
    ascii_host = host.encode("idna").decode("ascii").rstrip(".")
    if len(ascii_host) > 253:
        return False
    return all(re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?",
                           label) for label in ascii_host.split("."))


def _member(item, image):
    if image and isinstance(item, str):
        item = {"url": item}
    if not isinstance(item, dict):
        return None
    url = _url(item.get("url"))
    if not url:
        return None
    try:
        if image:
            return {"url": url, "source_url": _url(item.get("source_url")) or url,
                    "description": clip_bytes(_text(item.get("description")), 256)}
        return {"url": url, "title": clip_bytes(_text(item.get("title")), 512),
                "content": clip_bytes(_text(item.get("content")), 400)}
    except (ValueError, UnicodeError):
        return None


def _collection(items, maximum, image=False):
    if not isinstance(items, list):
        raise WebResearchError("provider_response_invalid")
    results, seen, valid = [], set(), False
    for item in items[:MAX_ITEMS]:
        normalized = _member(item, image)
        if normalized is None:
            continue
        valid = True
        url = normalized["url"]
        if url not in seen and len(results) < maximum:
            results.append(normalized)
        seen.add(url)
    if items and not valid:
        raise WebResearchError("provider_response_invalid")
    return results, len(items) - len(results)


def normalize_search_payload(payload, options):
    if not isinstance(payload, dict):
        raise WebResearchError("provider_response_invalid")
    results, discarded_results = _collection(
        payload.get("results"), options["max_results"])
    images, discarded_images = [], 0
    if options["include_images"]:
        images, discarded_images = _collection(payload.get("images", []), 12, True)
    return NormalizedSearchPayload(results, images, discarded_results,
                                   discarded_images)
