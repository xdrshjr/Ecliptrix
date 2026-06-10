"""Composition-side media resolution orchestration (spec 05 §2.3 / §2.5).

This is the ORCHESTRATION layer that decides, per composition item URL, which
local file the export pipeline reads. It composes two pre-existing pieces and
does NOT reimplement either:

  1. the ``cached_materials`` persistent cache (composite-key / cache_url disk
     hint / legacy exact-URL lookup), via ``material_download_service``; and
  2. ``local_media_resolver.resolve_media_reference(allow_remote=False)`` — the
     authoritative same-origin → local-disk mapper with the whitelist + path
     traversal guard.

The HARD policy of spec 05 lives here: when neither the cache nor the local
resolver can produce a file, we raise :class:`NonLocalMediaError` — we do NOT
fall back to downloading the asset. The user must localize the material first.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Callable, Optional

from app.logger import get_logger
from app.services.local_media_resolver import (
    LocalMediaResolveError,
    resolve_media_reference,
)

logger = get_logger(__name__)


class NonLocalMediaError(ValueError):
    """Raised when a composition URL cannot be resolved to a local file.

    The export pipeline is local-only (spec 05 §2.3): a URL that is neither in
    ``cached_materials`` nor resolvable to a whitelisted local path is a hard
    error rather than a silent network download.
    """


@dataclass(frozen=True)
class ResolvedItemPath:
    """Where a single composition item's media was found, and how."""

    url: str
    local_path: str
    #: 'cache' = cached_materials hit, 'local' = local_media_resolver hit.
    origin: str


# A callable that maps a URL to a cached local path (or None). Matches
# MaterialDownloadService.resolve_cached_path / lookup_by_url semantics; injected
# so the resolver is unit-testable without the DB-backed cache service.
CacheLookup = Callable[[str], Optional[str]]


def resolve_local_media(url: str, cache_lookup: Optional[CacheLookup] = None) -> ResolvedItemPath:
    """Resolve a single composition item URL to a validated local file path.

    Resolution order (spec 05 §2.3):
      1. cached_materials hit (when ``cache_lookup`` is provided and returns an
         existing file);
      2. ``local_media_resolver.resolve_media_reference(allow_remote=False)``.

    Args:
        url: the composition item URL (same-origin/relative/loopback local ref).
        cache_lookup: optional URL→local-path lookup against the persistent
            cache. A returned path is honoured only when it exists on disk.

    Returns:
        The resolved local path and the origin that produced it.

    Raises:
        NonLocalMediaError: when neither source yields a local file.
    """
    if cache_lookup is not None:
        cached = _safe_cache_lookup(cache_lookup, url)
        if cached:
            return ResolvedItemPath(url=url, local_path=cached, origin="cache")

    try:
        resolved = resolve_media_reference(url, allow_remote=False)
    except LocalMediaResolveError as exc:
        raise NonLocalMediaError(
            f"media reference '{url}' is not a local file and the local export "
            f"pipeline does not download remote assets — localize the material "
            f"first (cause: {exc})"
        ) from exc

    return ResolvedItemPath(url=url, local_path=str(resolved.path), origin="local")


def _safe_cache_lookup(cache_lookup: CacheLookup, url: str) -> Optional[str]:
    """Call the injected cache lookup, tolerating its failures (cache is advisory)."""
    try:
        path = cache_lookup(url)
    except Exception as exc:  # noqa: BLE001 — a cache miss must never break export
        logger.warning(f"Cache lookup failed for {url}: {exc}")
        return None
    if path and os.path.exists(path):
        return path
    return None
