"""Authenticated, same-origin asset download (spec §3.3 ``assets.py``).

Gateway assets (``/api/v1/media/assets/{id}``) need the key, so they can never
be handed to a consumer that fetches anonymously: we download them here, write
``<dest>.part`` and rename atomically once the byte count checks out.

Safety: only URLs on the configured ``base_url`` origin are fetched; the key
header is attached to those only; a 3xx is followed once and only when its
``Location`` is same-origin again (otherwise ``router_redirect_blocked``).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import httpx

from app.services.skillrouter import client as client_module
from app.services.skillrouter.client import (
    TIMEOUT_ASSET, absolute_url, env_kwargs, is_same_origin, request_headers,
    retry_after_seconds, transport_error,
)
from app.services.skillrouter.config import RouterSnapshot
from app.services.skillrouter.errors import RouterError

DEFAULT_MAX_BYTES = 256 * 1024 * 1024
_CHUNK = 1024 * 256


def asset_url(snapshot: RouterSnapshot, relative_or_absolute: str) -> str:
    """Absolute asset URL, refusing anything that is not on the gateway origin."""
    url = absolute_url(snapshot, relative_or_absolute)
    if not is_same_origin(url, snapshot.base_url):
        raise RouterError("router_redirect_blocked", 502, "Asset URL is not on the gateway origin.")
    return url


async def _open(client: httpx.AsyncClient, snapshot: RouterSnapshot, url: str):
    """Send the GET; follow ONE same-origin redirect. Returns an open stream context."""
    request = client.build_request("GET", url, headers=request_headers(
        snapshot, url, {"Accept": "*/*"}))
    response = await client.send(request, stream=True)
    if response.is_redirect:
        target = absolute_url(snapshot, response.headers.get("location", ""))
        await response.aclose()
        if not response.headers.get("location") or not is_same_origin(target, snapshot.base_url):
            raise RouterError("router_redirect_blocked", 502, "Asset redirect refused.")
        response = await client.send(client.build_request(
            "GET", target, headers=request_headers(snapshot, target, {"Accept": "*/*"})), stream=True)
    return response


async def download_asset(
    snapshot: RouterSnapshot, url: str, dest: Path, *, max_bytes: int = DEFAULT_MAX_BYTES,
) -> int:
    """Download one gateway asset to ``dest`` and return the byte count.

    Raises:
        RouterError: not same-origin, HTTP error, oversize, truncated or empty body.
    """
    target = asset_url(snapshot, url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    try:
        written = await _stream_to(snapshot, target, part, max_bytes)
        os.replace(part, dest)
        return written
    finally:
        part.unlink(missing_ok=True)


async def _stream_to(snapshot: RouterSnapshot, url: str, part: Path, max_bytes: int) -> int:
    try:
        async with client_module._async_client_factory(
                TIMEOUT_ASSET, **env_kwargs(snapshot.base_url)) as http:
            response = await _open(http, snapshot, url)
            try:
                return await _write_body(response, part, max_bytes)
            finally:
                await response.aclose()
    except httpx.HTTPError as error:
        raise transport_error(error) from None


async def _write_body(response: httpx.Response, part: Path, max_bytes: int) -> int:
    if response.status_code != 200:
        code = {401: "authentication_error", 404: "not_found",
                429: "upstream_rate_limited"}.get(
                    response.status_code, "upstream_unavailable")
        raise RouterError(code, response.status_code, "Asset download failed.",
                          retry_after=retry_after_seconds(response))
    expected: Optional[int] = None
    header = response.headers.get("content-length", "")
    if header.isdigit():
        expected = int(header)
        if expected > max_bytes:
            raise RouterError("router_asset_too_large", 422, "Asset exceeds the size limit.")
    written = 0
    with open(part, "wb") as handle:
        async for chunk in response.aiter_bytes(_CHUNK):
            written += len(chunk)
            if written > max_bytes:
                raise RouterError("router_asset_too_large", 422, "Asset exceeds the size limit.")
            handle.write(chunk)
    if written == 0 or (expected is not None and written != expected):
        raise RouterError("upstream_unavailable", 502, "Asset download was empty or truncated.")
    return written
