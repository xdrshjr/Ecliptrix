"""Frame / reference-image preparation for the gateway video request (spec §4.5).

The gateway takes frames as an ``https`` URL or an inline data URI and caps the
whole POST body at 8 MB. Local files are therefore inlined here (reusing the
manual path's validator for format and the 300-6000 px / 0.4-2.5 ratio rules)
and, when the body would still not fit, re-encoded smaller. Nothing here talks
to the network.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
from io import BytesIO
from typing import Any, Dict, List, Sequence, Tuple

from PIL import Image

from app.services.ark_video_payload import resolve_image_url
from app.services.credential_errors import VideoError

#: Gateway body cap is 8 MiB; stay clear of it so envelope overhead never tips it.
MAX_BODY_BYTES = 8_000_000
#: (long edge, JPEG quality) tried in order until the body fits.
SHRINK_STEPS: Tuple[Tuple[int, int], ...] = ((2048, 85), (1280, 80), (1024, 70))
_DATA_URI = re.compile(r"data:(image/[a-z]+);base64,([A-Za-z0-9+/=]+)")


def body_size(body: Dict[str, Any]) -> int:
    """Bytes the JSON body will occupy on the wire."""
    return len(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _too_large() -> VideoError:
    return VideoError(
        "router_invalid_request", 422, field="image_urls", reason="request_too_large",
        retryable=False, integration_id="skillrouter",
    )


def _shrink_one(data_uri: str, long_edge: int, quality: int) -> str:
    match = _DATA_URI.fullmatch(data_uri)
    if not match:
        return data_uri
    with Image.open(BytesIO(base64.b64decode(match[2]))) as image:
        image = image.convert("RGB")
        image.thumbnail((long_edge, long_edge))
        buffer = BytesIO()
        image.save(buffer, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def shrink_inline_images(
    body: Dict[str, Any], long_edge: int, quality: int,
) -> Dict[str, Any]:
    """Return a copy of ``body`` with every inline frame re-encoded smaller."""
    shrunk = dict(body)
    for field in ("firstFrameUrl", "lastFrameUrl"):
        if isinstance(shrunk.get(field), str):
            shrunk[field] = _shrink_one(shrunk[field], long_edge, quality)
    if shrunk.get("referenceImageUrls"):
        shrunk["referenceImageUrls"] = [
            _shrink_one(url, long_edge, quality) for url in shrunk["referenceImageUrls"]]
    return shrunk


def fit_body(body: Dict[str, Any]) -> Dict[str, Any]:
    """Make ``body`` fit the gateway cap, shrinking inline frames if needed.

    Raises:
        VideoError: ``router_invalid_request`` when even the smallest step is too big.
    """
    if body_size(body) <= MAX_BODY_BYTES:
        return body
    for long_edge, quality in SHRINK_STEPS:
        candidate = shrink_inline_images(body, long_edge, quality)
        if body_size(candidate) <= MAX_BODY_BYTES:
            return candidate
    raise _too_large()


async def resolve_frame_fields(images: Sequence[Tuple[str, str]]) -> Dict[str, Any]:
    """Map ``[(url, role)]`` from ``normalize_images`` to gateway frame fields.

    Local storage URLs become data URIs; http(s) URLs pass through unchanged.
    """
    fields: Dict[str, Any] = {}
    references: List[str] = []
    cache: Dict[str, str] = {}
    for url, role in images:
        if url not in cache:
            cache[url] = await resolve_image_url(url)
        resolved = cache[url]
        if role == "first_frame":
            fields["firstFrameUrl"] = resolved
        elif role == "last_frame":
            fields["lastFrameUrl"] = resolved
        else:
            references.append(resolved)
    if references:
        fields["referenceImageUrls"] = references
    return fields


async def fit_body_async(body: Dict[str, Any]) -> Dict[str, Any]:
    """``fit_body`` off the event loop (image re-encoding is CPU bound)."""
    return await asyncio.to_thread(fit_body, body)
