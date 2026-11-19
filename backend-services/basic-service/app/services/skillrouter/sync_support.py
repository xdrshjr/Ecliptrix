"""Helpers for the synchronous seams (TTS worker threads, search services).

The catalogue cache in ``catalog.py`` is asyncio based; synchronous callers
cannot await it. ``blocking_limits`` reads that cache first (no I/O) and only
on a cold cache performs one blocking ``GET /capabilities`` of its own, kept in
a tiny TTL cache so a burst of worker threads does not fan out requests.
``run_blocking`` runs a coroutine to completion from any thread, including one
that already hosts an event loop.
"""

from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Awaitable, Dict, Tuple, TypeVar

from app.services.skillrouter import catalog
from app.services.skillrouter.client import SyncRouterClient
from app.services.skillrouter.config import get_snapshot

T = TypeVar("T")

_CACHE_TTL_SECONDS = 60.0
_cache: Dict[Tuple[str, str], Tuple[float, Dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def run_blocking(coroutine: Awaitable[T]) -> T:
    """Run ``coroutine`` to completion from synchronous code.

    Uses ``asyncio.run`` on a thread without a running loop; when called from a
    thread that already runs a loop it hops to a helper thread instead, because
    ``asyncio.run`` would raise there.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)  # type: ignore[arg-type]
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coroutine).result()  # type: ignore[arg-type]


def reset_sync_cache() -> None:
    """Drop the blocking limits cache (test isolation)."""
    with _cache_lock:
        _cache.clear()


def blocking_limits(gateway_capability: str) -> Dict[str, Any]:
    """``limits`` of one gateway capability for synchronous callers.

    Returns ``{}`` only when the gateway does not list the capability.

    Raises:
        RouterError: the gateway could not be reached or rejected the key.
    """
    cached = catalog.capability_limits(gateway_capability)
    if cached:
        return cached
    snapshot = get_snapshot()
    key = (snapshot.revision, gateway_capability)
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < _CACHE_TTL_SECONDS:
            return hit[1]
    raw = SyncRouterClient(snapshot).get("capabilities")
    limits: Dict[str, Any] = {}
    for item in catalog.normalize_capabilities(raw):
        if item.get("id") == gateway_capability and isinstance(item.get("limits"), dict):
            limits = item["limits"]
    with _cache_lock:
        _cache[key] = (time.monotonic(), limits)
    return limits
