"""The ONLY HTTP exit to the SkillRouter gateway (spec §3.3).

Rules enforced here so no adapter has to remember them:

* ``x-api-key`` is attached only to requests aimed at the configured origin;
* ``follow_redirects=False`` - a 3xx is followed manually ONCE, GET only and only
  when ``Location`` is same-origin (a paid POST is never re-sent);
* only idempotent GETs are retried (once); every POST is sent exactly once
  because the gateway has no idempotency key (a retry could bill twice);
* logs carry method/path/status/latency only - never keys, prompts or bodies;
* per-capability concurrency gates keep us under the gateway's 2-in-flight cap.

``AsyncRouterClient`` and ``SyncRouterClient`` share the request/response
helpers below; the sync flavour exists for the synchronous search services.
"""

from __future__ import annotations

import asyncio
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import httpx

from app.logger import get_logger
from app.services.net_env import loopback_env_kwargs
from app.services.skillrouter.config import RouterSnapshot, require_ready
from app.services.skillrouter.errors import RouterError, from_gateway

logger = get_logger(__name__)

TIMEOUT_META = 10.0
TIMEOUT_MEDIA = 180.0
TIMEOUT_POLL = 15.0
TIMEOUT_ASSET = 120.0
MAX_JSON_BYTES = 16 * 1024 * 1024
RETRY_STATUSES = frozenset({429, 502, 503, 504})
MAX_RETRY_DELAY = 5.0

#: capability -> max requests in flight from this process (gateway default is 2)
INFLIGHT_LIMITS: Dict[str, int] = {"ai_image": 2, "tts": 2, "ai_video_submit": 1}
USER_AGENT = "Ecliptrix/1.0 (+skillrouter-client)"


def _async_client_factory(timeout: float, trust_env: bool = True) -> httpx.AsyncClient:
    """Test seam: tests substitute a client bound to a transport."""
    return httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=trust_env)


def _sync_client_factory(timeout: float, trust_env: bool = True) -> httpx.Client:
    """Test seam (sync flavour)."""
    return httpx.Client(timeout=timeout, follow_redirects=False, trust_env=trust_env)


def env_kwargs(base_url: str) -> Dict[str, Any]:
    """Loopback gateways must never go through a system proxy (see ``net_env``);
    kept as the import-compatible name used by the adapters."""
    return loopback_env_kwargs(base_url)


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}".lower()


def is_same_origin(url: str, base_url: str) -> bool:
    return origin_of(url) == origin_of(base_url)


def absolute_url(snapshot: RouterSnapshot, path_or_url: str) -> str:
    """Resolve a gateway-relative path against ``base_url``."""
    if path_or_url.startswith(("http://", "https://")):
        return path_or_url
    return f"{snapshot.base_url}/{path_or_url.lstrip('/')}"


def api_url(snapshot: RouterSnapshot, path: str) -> str:
    return f"{snapshot.base_url}/api/v1/{path.lstrip('/')}"


def request_headers(snapshot: RouterSnapshot, url: str, extra: Optional[dict] = None) -> Dict[str, str]:
    """Headers for one request; the key is attached for same-origin URLs only."""
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if is_same_origin(url, snapshot.base_url):
        headers["x-api-key"] = snapshot.api_key
    if extra:
        headers.update(extra)
    return headers


def retry_after_seconds(response: httpx.Response) -> Optional[int]:
    raw = response.headers.get("retry-after", "")
    if raw.isdigit():
        return min(int(raw), 3600)
    return None


def interpret_response(response: httpx.Response) -> Any:
    """Unwrap ``{data}``; raise a typed :class:`RouterError` for any failure."""
    if len(response.content) > MAX_JSON_BYTES:
        raise RouterError("router_bad_response", 502, "Gateway response too large.")
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if 200 <= response.status_code < 300:
        if not isinstance(payload, dict) or "data" not in payload:
            raise RouterError("router_bad_response", 502, "Gateway response has no data field.")
        return payload["data"]
    error = payload.get("error") if isinstance(payload, dict) else None
    error = error if isinstance(error, dict) else {}
    code = str(error.get("code") or _code_from_status(response.status_code))
    details: Dict[str, Any] = {}
    resets = error.get("resetsAt") or error.get("resets_at")
    if isinstance(resets, (int, float)):
        details["resets_at"] = int(resets)
    details["request_sent"] = response.status_code >= 500
    raise from_gateway(code, response.status_code, str(error.get("message") or ""),
                       retry_after_seconds(response), details)


def _code_from_status(status: int) -> str:
    if status == 401:
        return "authentication_error"
    if status == 429:
        return "upstream_rate_limited"
    if status == 504:
        return "upstream_timeout"
    return "upstream_unavailable"


def transport_error(error: Exception) -> RouterError:
    """Map an httpx transport fault; ``request_sent`` tells paid callers whether
    the request may already have been accepted (never retry blindly)."""
    sent = not isinstance(error, (httpx.ConnectError, httpx.ConnectTimeout))
    if isinstance(error, httpx.TimeoutException):
        return RouterError("upstream_timeout", 504, "Timed out waiting for the gateway.",
                           details={"request_sent": sent})
    return RouterError("router_unreachable", 502, "Cannot reach the gateway.",
                       details={"request_sent": sent})


def _log(method: str, path: str, status: object, started: float) -> None:
    logger.info("skillrouter %s %s -> %s %.0fms", method, path, status,
                (time.monotonic() - started) * 1000)


# --- concurrency gates ------------------------------------------------------

_async_gates: Dict[tuple, asyncio.Semaphore] = {}
_thread_gates: Dict[str, threading.Semaphore] = {}
_gate_lock = threading.Lock()


def _async_gate(name: Optional[str]) -> Optional[asyncio.Semaphore]:
    if name not in INFLIGHT_LIMITS:
        return None
    key = (id(asyncio.get_running_loop()), name)
    gate = _async_gates.get(key)
    if gate is None:
        gate = _async_gates[key] = asyncio.Semaphore(INFLIGHT_LIMITS[name])
    return gate


@contextmanager
def _thread_gate(name: Optional[str]):
    if name not in INFLIGHT_LIMITS:
        yield
        return
    with _gate_lock:
        gate = _thread_gates.setdefault(name, threading.Semaphore(INFLIGHT_LIMITS[name]))
    with gate:
        yield


class AsyncRouterClient:
    """Async gateway client. Create one per call site; it holds no connection."""

    def __init__(self, snapshot: Optional[RouterSnapshot] = None) -> None:
        self.snapshot = snapshot or require_ready()

    async def get(self, path: str, *, timeout: float = TIMEOUT_META, retry: bool = True) -> Any:
        """Idempotent GET with at most one retry."""
        attempts = 2 if retry else 1
        last: Optional[RouterError] = None
        for attempt in range(attempts):
            try:
                return await self._once("GET", path, None, timeout)
            except RouterError as error:
                last = error
                if attempt + 1 >= attempts or not _is_retryable_get(error):
                    raise
                await asyncio.sleep(min(float(error.retry_after or 0.5), MAX_RETRY_DELAY))
        raise last  # pragma: no cover - loop always returns or raises

    async def post(
        self, path: str, body: Dict[str, Any], *,
        timeout: float = TIMEOUT_MEDIA, gate: Optional[str] = None,
    ) -> Any:
        """Paid POST: sent exactly once, optionally behind a concurrency gate."""
        semaphore = _async_gate(gate)
        if semaphore is None:
            return await self._once("POST", path, body, timeout)
        async with semaphore:
            return await self._once("POST", path, body, timeout)

    async def _once(self, method: str, path: str, body: Optional[dict], timeout: float) -> Any:
        url = api_url(self.snapshot, path)
        started = time.monotonic()
        try:
            async with _async_client_factory(timeout, **env_kwargs(self.snapshot.base_url)) as client:
                response = await client.request(
                    method, url, json=body, headers=request_headers(self.snapshot, url))
                response = await self._follow_once(client, method, url, response)
        except httpx.HTTPError as error:
            _log(method, path, type(error).__name__, started)
            raise transport_error(error) from None
        _log(method, path, response.status_code, started)
        return interpret_response(response)

    async def _follow_once(self, client, method, url, response):
        if not response.is_redirect:
            return response
        target = response.headers.get("location", "")
        target = absolute_url(self.snapshot, target) if target else ""
        if method != "GET" or not target or not is_same_origin(target, self.snapshot.base_url):
            raise RouterError("router_redirect_blocked", 502, "Gateway redirect refused.")
        return await client.request("GET", target, headers=request_headers(self.snapshot, target))


class SyncRouterClient:
    """Blocking flavour for the synchronous search services (same rules)."""

    def __init__(self, snapshot: Optional[RouterSnapshot] = None) -> None:
        self.snapshot = snapshot or require_ready()

    def post(self, path: str, body: Dict[str, Any], *, timeout: float = TIMEOUT_MEDIA,
             gate: Optional[str] = None, idempotent: bool = False) -> Any:
        """POST once; ``idempotent=True`` (search pages) allows one retry."""
        attempts = 2 if idempotent else 1
        for attempt in range(attempts):
            try:
                with _thread_gate(gate):
                    return self._once("POST", path, body, timeout)
            except RouterError as error:
                if attempt + 1 >= attempts or not _is_retryable_get(error):
                    raise
                time.sleep(min(float(error.retry_after or 0.5), MAX_RETRY_DELAY))
        raise RuntimeError("unreachable")  # pragma: no cover

    def get(self, path: str, *, timeout: float = TIMEOUT_META) -> Any:
        for attempt in range(2):
            try:
                return self._once("GET", path, None, timeout)
            except RouterError as error:
                if attempt == 1 or not _is_retryable_get(error):
                    raise
                time.sleep(min(float(error.retry_after or 0.5), MAX_RETRY_DELAY))
        raise RuntimeError("unreachable")  # pragma: no cover

    def _once(self, method: str, path: str, body: Optional[dict], timeout: float) -> Any:
        url = api_url(self.snapshot, path)
        started = time.monotonic()
        try:
            with _sync_client_factory(timeout, **env_kwargs(self.snapshot.base_url)) as client:
                response = client.request(
                    method, url, json=body, headers=request_headers(self.snapshot, url))
        except httpx.HTTPError as error:
            _log(method, path, type(error).__name__, started)
            raise transport_error(error) from None
        _log(method, path, response.status_code, started)
        if response.is_redirect:
            raise RouterError("router_redirect_blocked", 502, "Gateway redirect refused.")
        return interpret_response(response)


def _is_retryable_get(error: RouterError) -> bool:
    """Transport faults and 429/502/503/504 are worth one more idempotent try."""
    if error.code in ("router_unreachable", "upstream_timeout"):
        return True
    return error.http_status in RETRY_STATUSES and error.code != "quota_exceeded"
