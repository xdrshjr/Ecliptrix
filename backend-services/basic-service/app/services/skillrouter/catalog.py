"""Capability + model catalogue cache (spec §3.3 ``catalog.py``).

In-memory, 60 s TTL, stale-while-revalidate, single-flight per kind, keyed by
the configuration ``revision`` (a new key/base URL invalidates it). A failed
refresh keeps the previous value and marks it ``stale``; the status surface
reads the cache only and never waits on the network for longer than a bound.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.logger import get_logger
from app.services.skillrouter.client import AsyncRouterClient
from app.services.skillrouter.config import RouterSnapshot, get_snapshot
from app.services.skillrouter.constants import ROUTER_CAPABILITY_MAP
from app.services.skillrouter.errors import RouterError

logger = get_logger(__name__)

TTL_SECONDS = 60.0
KNOWN_GATEWAY_CAPABILITIES = frozenset(ROUTER_CAPABILITY_MAP.values()) - {"llm"}


@dataclass
class CatalogResult:
    """A cache read: ``data`` is never ``None``; ``error`` is a gateway code."""

    data: List[Dict[str, Any]]
    stale: bool = False
    fetched_at: Optional[float] = None
    error: Optional[str] = None


@dataclass
class _Entry:
    revision: str = ""
    data: Optional[List[Dict[str, Any]]] = None
    fetched_at: float = 0.0
    stale: bool = False
    error: Optional[str] = None
    flight: Optional["asyncio.Future"] = field(default=None, repr=False)

    def is_fresh(self, revision: str) -> bool:
        return (self.revision == revision and self.data is not None
                and not self.stale and time.monotonic() - self.fetched_at < TTL_SECONDS)


_entries: Dict[str, _Entry] = {"capabilities": _Entry(), "models": _Entry()}
_last_verified: Optional[Dict[str, Any]] = None


def reset() -> None:
    """Drop all cached state (test isolation and key/base-url change)."""
    global _last_verified
    _entries["capabilities"] = _Entry()
    _entries["models"] = _Entry()
    _last_verified = None


def record_verification(outcome: str) -> None:
    """Remember the latest verification outcome (in memory, zero secrets)."""
    global _last_verified
    _last_verified = {"ok": outcome == "ok", "outcome": outcome, "at": int(time.time() * 1000)}


def last_verified() -> Optional[Dict[str, Any]]:
    return dict(_last_verified) if _last_verified else None


def normalize_capabilities(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        raise RouterError("router_bad_response", 502, "Capabilities list is malformed.")
    return [item for item in raw if isinstance(item, dict)
            and item.get("id") in KNOWN_GATEWAY_CAPABILITIES]


def _normalize_models(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        raise RouterError("router_bad_response", 502, "Models list is malformed.")
    models: List[Dict[str, Any]] = []
    for item in raw:
        model_id = item.get("id") if isinstance(item, dict) else None
        if not isinstance(model_id, str) or not model_id:
            continue
        provider = str(item.get("provider") or "openai").lower()
        is_route = provider == "route"
        models.append({
            "id": model_id,
            "label": str(item.get("display_name") or model_id),
            "protocol": "anthropic" if provider == "anthropic" else "openai",
            "isRoute": is_route,
        })
    return models


async def _fetch(kind: str, snapshot: RouterSnapshot) -> List[Dict[str, Any]]:
    client = AsyncRouterClient(snapshot)
    if kind == "capabilities":
        return normalize_capabilities(await client.get("capabilities"))
    return _normalize_models(await client.get("models"))


async def _refresh(kind: str, snapshot: RouterSnapshot) -> None:
    entry = _entries[kind]
    try:
        data = await _fetch(kind, snapshot)
    except RouterError as error:
        if entry.revision != snapshot.revision:
            entry.data = None
        entry.revision, entry.stale, entry.error = snapshot.revision, True, error.code
        if error.code == "authentication_error" and kind == "capabilities":
            record_verification("invalid_credentials")
        return
    except Exception as error:  # noqa: BLE001 - a refresh must never raise out of the task
        logger.warning("skillrouter %s refresh failed: %s", kind, type(error).__name__)
        entry.revision, entry.stale, entry.error = snapshot.revision, True, "router_bad_response"
        return
    entry.revision, entry.data, entry.fetched_at = snapshot.revision, data, time.monotonic()
    entry.stale, entry.error = False, None
    if kind == "capabilities":
        record_verification("ok")


def _start_flight(kind: str, snapshot: RouterSnapshot) -> "asyncio.Future":
    entry = _entries[kind]
    if entry.flight is not None and not entry.flight.done():
        return entry.flight

    async def run() -> None:
        try:
            await _refresh(kind, snapshot)
        finally:
            entry.flight = None

    entry.flight = asyncio.ensure_future(run())
    return entry.flight


def _result(kind: str, snapshot: RouterSnapshot) -> CatalogResult:
    entry = _entries[kind]
    usable = entry.revision == snapshot.revision and entry.data is not None
    fetched = (time.time() - (time.monotonic() - entry.fetched_at)) if usable else None
    return CatalogResult(
        data=list(entry.data) if usable else [],
        stale=entry.stale or not usable, fetched_at=fetched, error=entry.error,
    )


async def _get(kind: str, force: bool, wait: float) -> CatalogResult:
    snapshot = get_snapshot()
    if not snapshot.has_key:
        return CatalogResult(data=[], stale=True, error="router_key_missing")
    entry = _entries[kind]
    if not force and entry.is_fresh(snapshot.revision):
        return _result(kind, snapshot)
    flight = _start_flight(kind, snapshot)
    has_old = entry.revision == snapshot.revision and entry.data is not None
    if has_old and not force:
        return _result(kind, snapshot)  # stale-while-revalidate
    try:
        await asyncio.wait_for(asyncio.shield(flight), timeout=wait)
    except asyncio.TimeoutError:
        pass
    return _result(kind, snapshot)


async def get_capabilities(force: bool = False, wait: float = 10.0) -> CatalogResult:
    """Gateway capability list (availability, limits, quota)."""
    return await _get("capabilities", force, wait)


async def get_models(force: bool = False, wait: float = 10.0) -> CatalogResult:
    """Gateway model list normalised to ``{id,label,protocol,isRoute}``."""
    return await _get("models", force, wait)


def cached_capabilities() -> CatalogResult:
    """Cache-only read (no I/O); empty and stale when nothing is cached."""
    return _result("capabilities", get_snapshot())


def cached_models_snapshot() -> List[Dict[str, Any]]:
    """Cache-only model list for the current configuration (``[]`` when cold)."""
    return _result("models", get_snapshot()).data


def capability_entry(gateway_capability: str) -> Optional[Dict[str, Any]]:
    for item in cached_capabilities().data:
        if item.get("id") == gateway_capability:
            return item
    return None


def capability_limits(gateway_capability: str) -> Dict[str, Any]:
    """``limits`` block of one capability from the cache (``{}`` when unknown)."""
    entry = capability_entry(gateway_capability)
    limits = entry.get("limits") if entry else None
    return limits if isinstance(limits, dict) else {}


async def ensure_limits(gateway_capability: str) -> Dict[str, Any]:
    """Limits of a capability, fetching the catalogue once when it is cold."""
    limits = capability_limits(gateway_capability)
    if limits:
        return limits
    await get_capabilities()
    return capability_limits(gateway_capability)
