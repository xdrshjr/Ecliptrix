"""
Media proxy router (spec 05).

Routes
------
* ``GET /api/media/proxy?u=<url>&material_id=<id>`` — streaming same-origin
  proxy with Range support.
* ``GET /api/media/proxy/status?u=<url>`` — cache status snapshot.

Both routes live under the ``/api/media`` prefix; spec 06's preview-proxy
router will be mounted alongside.
"""

from __future__ import annotations

import os
import time
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.logger import get_logger
from app.services.media_proxy_service import (
    MediaProxyError,
    ProxyTarget,
    get_media_proxy_service,
)

router = APIRouter(prefix="/media", tags=["Media Proxy"])
logger = get_logger(__name__)


def _client_ip(request: Request) -> str:
    # Trust ``X-Forwarded-For`` when present (Nginx in this project is the
    # canonical edge). Falls back to the direct peer otherwise.
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "")


@router.get("/proxy")
async def proxy(
    request: Request,
    u: str = Query(..., description="URL-encoded original CDN URL"),
    material_id: Optional[str] = Query(default=None, description="Optional cached_materials.id"),
    quality: str = Query(default="original", description="Spec 05 §3.1 — only 'original' accepted"),
    range_header: Optional[str] = Header(default=None, alias="Range"),
):
    svc = get_media_proxy_service()
    if quality != "original":
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "proxy.invalid_quality",
                "message": "Use /api/media/preview-proxy for non-original quality",
            },
        )

    try:
        await svc.check_rate_limit(_client_ip(request))
        target = await svc.resolve_target(u, material_id=material_id)
    except MediaProxyError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error_code": exc.error_code, "message": exc.message},
        ) from exc

    cache_path = svc.cache_path_for(target)

    # Cache hit: stream the local file directly. Range I/O is delegated to
    # the FastAPI StaticFiles mount via the X-Material-Local-Url header so
    # the client can avoid the proxy hop on the next request.
    if cache_path.exists() and not range_header:
        logger.info(
            "media_proxy.serve",
            extra={
                "cache_state": "hit",
                "upstream_latency_ms": 0,
                "bytes_total": cache_path.stat().st_size,
                "material_id": material_id,
            },
        )
        return _serve_local(svc, target, cache_path, full=True)
    if cache_path.exists() and range_header:
        logger.info(
            "media_proxy.serve",
            extra={
                "cache_state": "hit_range",
                "upstream_latency_ms": 0,
                "bytes_total": cache_path.stat().st_size,
                "material_id": material_id,
            },
        )
        return _serve_local(svc, target, cache_path, full=False, range_header=range_header)

    # Cache miss → fetch upstream while teeing into ``cache_path``. Per-key
    # lock means a second concurrent request waits for the first one to
    # finish writing before falling through to the cache-hit branch.
    lock = svc.lock_for(target)
    if lock.locked():
        await lock.acquire()
        try:
            if cache_path.exists():
                return _serve_local(
                    svc,
                    target,
                    cache_path,
                    full=not range_header,
                    range_header=range_header,
                )
        finally:
            lock.release()

    upstream_started = time.monotonic()
    try:
        status_code, headers, body_iter, _done = await svc.stream_upstream(
            target, range_header
        )
    except MediaProxyError as exc:
        logger.warning(
            "media_proxy.serve",
            extra={
                "cache_state": "miss_error",
                "upstream_latency_ms": int((time.monotonic() - upstream_started) * 1000),
                "bytes_total": None,
                "material_id": material_id,
                "error_code": exc.error_code,
            },
        )
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error_code": exc.error_code, "message": exc.message},
        ) from exc

    headers.setdefault("X-Proxy-Cache", "miss")
    headers["X-Material-Local-Url"] = svc.local_url_for_target(
        target, os.path.basename(cache_path)
    )
    try:
        upstream_latency_ms = int((time.monotonic() - upstream_started) * 1000)
        content_length_header = headers.get("Content-Length") or headers.get(
            "content-length"
        )
        bytes_total = int(content_length_header) if content_length_header else None
    except (TypeError, ValueError):
        bytes_total = None
        upstream_latency_ms = 0
    logger.info(
        "media_proxy.serve",
        extra={
            "cache_state": "miss",
            "upstream_latency_ms": upstream_latency_ms,
            "bytes_total": bytes_total,
            "material_id": material_id,
        },
    )

    async def _gen():
        async with lock:
            async for chunk in svc.write_through(target, body_iter, cache_path):
                yield chunk

    return StreamingResponse(_gen(), status_code=status_code, headers=headers)


@router.get("/proxy/status")
async def proxy_status(
    u: Optional[str] = Query(default=None),
    material_id: Optional[str] = Query(default=None),
):
    svc = get_media_proxy_service()
    info = await svc.status(u, material_id=material_id)
    return {
        "success": True,
        "data": {
            "cache_state": info.cache_state,
            "bytes_cached": info.bytes_cached,
            "bytes_total": info.bytes_total,
            "last_updated": info.last_updated,
            "material_id": info.material_id,
        },
    }


# ---------------------------------------------------------------------------
# Local-file streaming helpers
# ---------------------------------------------------------------------------


def _serve_local(
    svc,
    target: ProxyTarget,
    cache_path,
    *,
    full: bool,
    range_header: Optional[str] = None,
):
    file_size = cache_path.stat().st_size
    if full or not range_header:
        return StreamingResponse(
            _iter_file(cache_path, 0, file_size, svc.config.stream_chunk_size),
            status_code=200,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Type": _guess_content_type(cache_path),
                "Content-Length": str(file_size),
                "Cache-Control": "public, max-age=86400",
                "X-Proxy-Cache": "hit",
                "X-Material-Local-Url": svc.local_url_for_target(
                    target, os.path.basename(cache_path)
                ),
            },
        )

    start, end = _parse_range(range_header, file_size)
    length = end - start + 1
    return StreamingResponse(
        _iter_file(cache_path, start, length, svc.config.stream_chunk_size),
        status_code=206,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Type": _guess_content_type(cache_path),
            "Content-Length": str(length),
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Cache-Control": "public, max-age=86400",
            "X-Proxy-Cache": "hit",
            "X-Material-Local-Url": svc.local_url_for_target(
                target, os.path.basename(cache_path)
            ),
        },
    )


def _iter_file(path, offset: int, length: int, chunk_size: int):
    def _gen():
        with open(path, "rb") as f:
            f.seek(offset)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(chunk_size, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return _gen()


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    # Format: ``bytes=START-END`` or ``bytes=START-``
    try:
        unit, _, spec = range_header.partition("=")
        if unit.strip().lower() != "bytes":
            raise ValueError("only bytes ranges supported")
        first, _, last = spec.partition("-")
        start = int(first) if first else 0
        end = int(last) if last else file_size - 1
        if start < 0 or end >= file_size or start > end:
            raise ValueError("range out of bounds")
        return start, end
    except Exception as exc:
        raise HTTPException(
            status_code=416,
            detail={"error_code": "proxy.invalid_range", "message": str(exc)},
        ) from exc


def _guess_content_type(path) -> str:
    ext = os.path.splitext(str(path))[1].lower()
    return {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".m4v": "video/mp4",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")
