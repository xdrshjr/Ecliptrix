"""
Media proxy service — same-origin streaming proxy for remote video/image
assets.

Spec: docs/plans/video-editor-playback-optimization/specs/05-backend-media-proxy.md

Solves three frontend pain points the player has when consuming third-party
CDN URLs directly:

  * cross-origin restrictions on ``<video>.crossOrigin`` + Range requests,
  * unreliable ``Accept-Ranges`` support on the upstream CDN,
  * unstable first-byte latency on cold cache.

The service streams upstream → client while also writing to a hot cache
directory. After a successful end-to-end transfer it hands the local path
off to :class:`MaterialDownloadService.store_external_download_async` so the
``cached_materials`` table reflects the new on-disk asset (and OSS upload
follows when ``OSS_ENABLED=true``).
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import os
import socket
import time
import weakref
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Dict, Optional, Tuple
from urllib.parse import urlparse

import httpx

from app.config import MediaProxyConfig, settings
from app.logger import get_logger
from app.services.material_download_service import (
    MaterialDownloadService,
    get_material_download_service,
)

logger = get_logger(__name__)


class MediaProxyError(Exception):
    """Base class for media proxy errors that carry an HTTP status + code."""

    def __init__(self, status_code: int, error_code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message


@dataclass(frozen=True)
class ProxyTarget:
    """Validated upstream destination derived from the request URL."""

    raw_url: str
    normalized_url: str
    host: str
    resolved_ip: str
    source: str
    source_id: str
    is_signed: bool


@dataclass
class ProxyStatus:
    cache_state: str  # 'absent' | 'partial' | 'cached'
    bytes_cached: int
    bytes_total: Optional[int]
    last_updated: Optional[str]
    material_id: Optional[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _match_wildcard(pattern: str, host: str) -> bool:
    """Match a left-prefix wildcard pattern (``*.foo.com`` or ``prefix*.foo.com``).

    Bare ``*`` is rejected because spec 05 §4.6 forbids it.
    """
    pattern = pattern.strip().lower()
    host = host.strip().lower()
    if not pattern or pattern == "*":
        return False
    if "*" not in pattern:
        return host == pattern
    # Convert the wildcard into a regex-ish split match: replace each `*`
    # with a "match anything except dot" check.
    parts = pattern.split("*")
    # Anchored at the start, then walk through.
    pos = 0
    if parts[0]:
        if not host.startswith(parts[0]):
            return False
        pos = len(parts[0])
    for part in parts[1:-1]:
        if not part:
            continue
        idx = host.find(part, pos)
        if idx < 0:
            return False
        pos = idx + len(part)
    if parts[-1]:
        if not host.endswith(parts[-1]):
            return False
        # Make sure the tail does not overlap with the head we already matched.
        if len(host) - len(parts[-1]) < pos:
            return False
    return True


def _is_private_ip(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        # If we cannot parse the address we treat it as unsafe.
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _ark_task_id_from_path(path: str) -> Optional[str]:
    """Extract the ARK task id from a TOS URL path, if present."""
    segments = [s for s in path.split("/") if s]
    for seg in segments:
        # ARK task ids look like ``cgt-...`` or hex prefixes.
        if seg.startswith("cgt-") or seg.startswith("cgt_"):
            return seg
    return None


def _pexels_id_from_path(path: str) -> Optional[str]:
    segments = [s for s in path.split("/") if s]
    for seg in segments:
        if seg.isdigit() and len(seg) >= 5:
            return seg
    return None


def _guess_extension(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext and len(ext) <= 5:
        return ext
    return ".mp4"


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class MediaProxyService:
    """Single-process media proxy.

    Multi-worker uvicorn deploys may briefly issue the same upstream fetch
    from each worker; the de-dup eventually settles via ``cached_materials``
    persistence, so we keep the implementation simple.
    """

    def __init__(
        self,
        config: Optional[MediaProxyConfig] = None,
        material_service: Optional[MaterialDownloadService] = None,
    ) -> None:
        self.config = config or settings.media_proxy
        self.material_svc = material_service or get_material_download_service()
        self._locks: "weakref.WeakValueDictionary[str, asyncio.Lock]" = (
            weakref.WeakValueDictionary()
        )
        self._rate_window: Dict[str, list[float]] = {}
        self._rate_lock = asyncio.Lock()
        Path(self.config.hot_cache_dir).mkdir(parents=True, exist_ok=True)

    # -------------------------------------------------------------- validation

    async def resolve_target(
        self, url: str, material_id: Optional[str] = None
    ) -> ProxyTarget:
        if not url or len(url) > 4096:
            raise MediaProxyError(400, "proxy.invalid_url", "URL is missing or too long")
        try:
            parsed = urlparse(url)
        except Exception as exc:  # pragma: no cover - defensive
            raise MediaProxyError(400, "proxy.invalid_url", str(exc)) from exc

        scheme = (parsed.scheme or "").lower()
        if scheme not in ("https", "http"):
            raise MediaProxyError(400, "proxy.invalid_url", "URL scheme is not http(s)")
        if scheme == "http" and not self.config.enable_http:
            raise MediaProxyError(
                400, "proxy.invalid_url", "Plain http is disabled in this environment"
            )

        host = (parsed.hostname or "").lower()
        if not host:
            raise MediaProxyError(400, "proxy.invalid_url", "URL has no host")

        if not any(_match_wildcard(p, host) for p in self.config.allowed_domains):
            raise MediaProxyError(
                403, "proxy.domain_not_allowed", f"Host '{host}' is not whitelisted"
            )

        try:
            infos = await asyncio.get_running_loop().getaddrinfo(
                host, None, type=socket.SOCK_STREAM
            )
        except socket.gaierror as exc:
            raise MediaProxyError(
                502, "proxy.upstream_error", f"DNS lookup failed for {host}: {exc}"
            ) from exc

        if not infos:
            raise MediaProxyError(
                502, "proxy.upstream_error", f"DNS lookup returned no records for {host}"
            )

        resolved_ip = infos[0][4][0]
        if _is_private_ip(resolved_ip):
            raise MediaProxyError(
                403,
                "proxy.domain_not_allowed",
                f"Resolved IP {resolved_ip} is in a private/reserved range",
            )

        is_signed = any(_match_wildcard(p, host) for p in self.config.signed_url_domains)
        # spec 05 §4.2 — normalized URL drops the query string except for
        # signed-URL domains where we instead use path + provider id.
        normalized = url.lower().strip().split("?")[0]

        source, source_id = self._classify(host, parsed.path, normalized, material_id)
        return ProxyTarget(
            raw_url=url,
            normalized_url=normalized,
            host=host,
            resolved_ip=resolved_ip,
            source=source,
            source_id=source_id,
            is_signed=is_signed,
        )

    def _classify(
        self,
        host: str,
        path: str,
        normalized_url: str,
        material_id: Optional[str],
    ) -> Tuple[str, str]:
        if material_id:
            return "external", material_id

        digest = hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()[:32]
        if host.endswith(".pexels.com") or "pexels.com" in host:
            pid = _pexels_id_from_path(path)
            return ("pexels", pid) if pid else ("generic", digest)
        if "volces.com" in host or "volcengineapi.com" in host:
            task_id = _ark_task_id_from_path(path)
            return ("ark", task_id) if task_id else ("generic", digest)
        return "generic", digest

    # -------------------------------------------------------------- rate limit

    async def check_rate_limit(self, client_ip: str) -> None:
        limit = self.config.per_ip_rate_limit_per_min
        if not limit or not client_ip:
            return
        now = time.monotonic()
        window_start = now - 60.0
        async with self._rate_lock:
            stamps = self._rate_window.setdefault(client_ip, [])
            # Drop expired entries while preserving order.
            while stamps and stamps[0] < window_start:
                stamps.pop(0)
            if len(stamps) >= limit:
                raise MediaProxyError(
                    429,
                    "proxy.rate_limited",
                    f"Per-IP limit ({limit}/min) exceeded",
                )
            stamps.append(now)
            # Cheap garbage collection: forget IPs that have not been seen in
            # the current window. Keeps the dict from growing forever.
            if len(self._rate_window) > 1024:
                stale = [
                    ip
                    for ip, items in self._rate_window.items()
                    if not items or items[-1] < window_start
                ]
                for ip in stale:
                    self._rate_window.pop(ip, None)

    # -------------------------------------------------------------- cache key

    def cache_path_for(self, target: ProxyTarget) -> Path:
        safe_id = (
            "".join(c for c in target.source_id if c.isalnum() or c in ("-", "_"))[:64]
            or "asset"
        )
        ext = _guess_extension(urlparse(target.raw_url).path)
        sub = Path(self.config.hot_cache_dir) / target.source
        sub.mkdir(parents=True, exist_ok=True)
        return sub / f"{safe_id}{ext}"

    def lock_for(self, target: ProxyTarget) -> asyncio.Lock:
        key = f"{target.source}:{target.source_id}"
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    def local_url_for_target(self, target: ProxyTarget, file_name: str) -> str:
        # CLAUDE.md: /api/storage/files/cached_materials/<source>/<basename>
        return f"/api/storage/files/cached_materials/{target.source}/{file_name}"

    # -------------------------------------------------------------- streaming

    async def stream_upstream(
        self,
        target: ProxyTarget,
        range_header: Optional[str],
    ) -> Tuple[
        int,
        Dict[str, str],
        AsyncIterator[bytes],
        "asyncio.Future[Tuple[bool, int]]",
    ]:
        """Open the upstream HTTPS stream and return ``(status, headers, body, done_future)``.

        ``done_future`` resolves once the streaming generator finishes; it
        carries ``(ok, bytes_streamed)`` so callers can update telemetry /
        ``cached_materials.proxy_bytes_cached``.
        """
        timeout = httpx.Timeout(
            self.config.fetch_timeout_seconds,
            connect=self.config.upstream_connect_timeout_seconds,
        )
        client = httpx.AsyncClient(timeout=timeout, follow_redirects=False)
        upstream_headers: Dict[str, str] = {}
        if range_header:
            upstream_headers["Range"] = range_header

        try:
            req = client.build_request("GET", target.raw_url, headers=upstream_headers)
            response = await client.send(req, stream=True)
        except httpx.TimeoutException as exc:
            await client.aclose()
            raise MediaProxyError(
                504, "proxy.upstream_timeout", f"Upstream timeout: {exc}"
            ) from exc
        except httpx.HTTPError as exc:
            await client.aclose()
            raise MediaProxyError(
                502, "proxy.upstream_error", f"Upstream error: {exc}"
            ) from exc

        if response.status_code >= 500:
            status_code = response.status_code
            await response.aclose()
            await client.aclose()
            raise MediaProxyError(
                502, "proxy.upstream_error", f"Upstream returned {status_code}"
            )

        # Size-cap check before we start streaming.
        max_bytes = self.config.max_size_mb * 1024 * 1024
        content_length = response.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > max_bytes:
            await response.aclose()
            await client.aclose()
            raise MediaProxyError(
                413, "proxy.payload_too_large", "Upstream Content-Length exceeds limit"
            )

        passthrough_headers = self._build_response_headers(response)
        done_future: "asyncio.Future[Tuple[bool, int]]" = asyncio.get_event_loop().create_future()

        async def _body() -> AsyncIterator[bytes]:
            total = 0
            ok = True
            try:
                async for chunk in response.aiter_bytes(self.config.stream_chunk_size):
                    total += len(chunk)
                    if total > max_bytes:
                        ok = False
                        break
                    yield chunk
            except Exception as exc:  # pragma: no cover - network-flake path
                ok = False
                logger.warning(f"media-proxy stream interrupted: {exc}")
            finally:
                try:
                    await response.aclose()
                finally:
                    await client.aclose()
                if not done_future.done():
                    done_future.set_result((ok, total))

        return response.status_code, passthrough_headers, _body(), done_future

    def _build_response_headers(self, upstream: httpx.Response) -> Dict[str, str]:
        passthrough = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
        }
        for name in ("content-type", "content-length", "content-range"):
            value = upstream.headers.get(name)
            if value:
                passthrough[name.title()] = value
        passthrough.setdefault("Content-Type", "application/octet-stream")
        return passthrough

    # -------------------------------------------------------------- write-through

    async def write_through(
        self,
        target: ProxyTarget,
        body_iter: AsyncIterator[bytes],
        cache_path: Path,
    ) -> AsyncIterator[bytes]:
        """Tee the upstream byte stream into ``cache_path`` as we forward it."""
        tmp_path = cache_path.with_suffix(cache_path.suffix + ".part")
        max_bytes = self.config.max_size_mb * 1024 * 1024
        total = 0
        f = open(tmp_path, "wb")
        try:
            async for chunk in body_iter:
                total += len(chunk)
                if total > max_bytes:
                    raise MediaProxyError(
                        413,
                        "proxy.payload_too_large",
                        "Aggregate proxy payload exceeded size cap",
                    )
                f.write(chunk)
                yield chunk
        except MediaProxyError:
            f.close()
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        except Exception:
            f.close()
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        else:
            f.close()
            try:
                tmp_path.replace(cache_path)
            except OSError as exc:
                logger.warning(f"media-proxy: failed to finalize cache file: {exc}")
                return
            try:
                await self.material_svc.store_external_download_async(
                    url=target.raw_url,
                    local_path=str(cache_path),
                    source=target.source,
                    source_id=target.source_id,
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning(f"media-proxy: store_external_download failed: {exc}")

    # -------------------------------------------------------------- status

    async def status(
        self, url: Optional[str], material_id: Optional[str] = None
    ) -> ProxyStatus:
        if not url and not material_id:
            return ProxyStatus("absent", 0, None, None, None)

        row = await self.material_svc.lookup_async(url=url)
        if row is None:
            return ProxyStatus("absent", 0, None, None, None)

        local_path = row.local_path or ""
        bytes_cached = 0
        cache_state = "absent"
        if local_path and os.path.exists(local_path):
            bytes_cached = os.path.getsize(local_path)
            cache_state = "cached" if (row.status or "") == "ready" else "partial"
        elif (row.status or "") in ("downloading", "pending"):
            cache_state = "partial"

        last_updated = row.updated_at.isoformat() if row.updated_at else None
        return ProxyStatus(
            cache_state=cache_state,
            bytes_cached=bytes_cached,
            bytes_total=row.file_size,
            last_updated=last_updated,
            material_id=str(row.id) if row.id else None,
        )


_singleton: Optional[MediaProxyService] = None


def get_media_proxy_service() -> MediaProxyService:
    global _singleton
    if _singleton is None:
        _singleton = MediaProxyService()
    return _singleton
