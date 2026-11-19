"""AI image generation through the SkillRouter gateway (spec §4.4).

The adapter turns one Seedream-shaped request into gateway calls and hands back
``RemoteImage`` items; ``ark_image_service`` keeps its storage layout, grid
packs and result models. Rules enforced here:

* sizes/counts come from the gateway ``limits`` (``sizes`` nearest-ratio
  mapping, ``maxCount`` batching) - never from local enums;
* batches run serially (the gateway admits two calls in flight) and a paid POST
  is sent exactly once; a failure in the FIRST batch propagates, a failure in a
  later batch returns what was already generated (and billed) plus a note;
* no ``model`` field is sent: the gateway picks its configured upstream;
* a reference larger than 6 MB (base64) is shrunk to a 2048 px JPEG q85;
* assets need the key, so each ``RemoteImage`` carries the snapshot that must be
  used to fetch it (``assets.download_asset`` - same origin, atomic).
"""

from __future__ import annotations

import base64
import binascii
import io
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, UnidentifiedImageError

from app.logger import get_logger
from app.services.skillrouter import catalog
from app.services.skillrouter.assets import asset_url
from app.services.skillrouter.client import AsyncRouterClient
from app.services.skillrouter.config import RouterSnapshot, require_ready
from app.services.skillrouter.errors import RouterError

logger = get_logger(__name__)

MAX_REFERENCE_BASE64 = 6 * 1024 * 1024
REFERENCE_LONG_EDGE = 2048
REFERENCE_JPEG_QUALITY = 85
DEFAULT_MAX_COUNT = 4
IMAGE_PATH = "media/images/generations"
MAX_IMAGE_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True)
class RemoteImage:
    """One generated image still to be downloaded.

    ``router`` is ``None`` for a public CDN URL (manual mode) and the snapshot
    whose key must authenticate the download for a gateway asset.
    """

    url: str
    router: Optional[RouterSnapshot] = field(default=None, repr=False)
    width: int = 0
    height: int = 0


@dataclass
class RouterImageResult:
    """Images of one request plus user-facing remarks (size mapping, partial failure)."""

    images: List[RemoteImage]
    notes: List[str] = field(default_factory=list)


def _parse_size(size: str) -> Optional[Tuple[int, int]]:
    parts = str(size).lower().split("x")
    if len(parts) != 2 or not all(part.isdigit() and int(part) > 0 for part in parts):
        return None
    return int(parts[0]), int(parts[1])


def nearest_size(requested: str, supported: List[str]) -> str:
    """Supported size closest to ``requested``: same aspect ratio first, then area.

    Returns ``requested`` unchanged when the gateway lists no usable sizes.
    """
    wanted = _parse_size(requested)
    candidates = [(size, _parse_size(size)) for size in supported]
    candidates = [(size, dims) for size, dims in candidates if dims]
    if not wanted or not candidates:
        return requested
    ratio, area = wanted[0] / wanted[1], wanted[0] * wanted[1]

    def distance(item: Tuple[str, Tuple[int, int]]) -> Tuple[float, int]:
        width, height = item[1]
        return round(abs(math.log((width / height) / ratio)), 4), abs(width * height - area)

    return min(candidates, key=distance)[0]


def shrink_reference(reference: str) -> str:
    """Return ``reference`` unchanged unless it is a data URI over 6 MB (base64).

    Oversized data URIs are re-encoded as JPEG q85 with the long edge at most
    2048 px (transparency flattened onto white).

    Raises:
        RouterError: ``invalid_request`` when the image cannot be decoded or is
            still over the limit after shrinking.
    """
    if not reference.startswith("data:"):
        return reference
    payload = reference.partition(",")[2]
    if len(payload) <= MAX_REFERENCE_BASE64:
        return reference
    try:
        image = Image.open(io.BytesIO(base64.b64decode(payload)))
        image.load()
    except (binascii.Error, ValueError, UnidentifiedImageError, OSError):
        raise RouterError("invalid_request", 422, "Reference image cannot be decoded.") from None
    rgba = image.convert("RGBA")
    flattened = Image.new("RGB", rgba.size, (255, 255, 255))
    flattened.paste(rgba, mask=rgba.split()[-1])
    flattened.thumbnail((REFERENCE_LONG_EDGE, REFERENCE_LONG_EDGE), Image.LANCZOS)
    buffer = io.BytesIO()
    flattened.save(buffer, format="JPEG", quality=REFERENCE_JPEG_QUALITY)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    if len(encoded) > MAX_REFERENCE_BASE64:
        raise RouterError("invalid_request", 422,
                          "Reference image is larger than 6 MB even after shrinking.")
    logger.info("skillrouter reference image shrunk to %dx%d", *flattened.size)
    return f"data:image/jpeg;base64,{encoded}"


def _request_body(prompt: str, size: str, count: int, reference: Optional[str],
                  watermark: bool) -> Dict[str, Any]:
    body: Dict[str, Any] = {"prompt": prompt, "size": size, "count": count,
                            "watermark": watermark}
    if reference:
        body["referenceImage"] = reference
    return body


def _to_remote_images(snapshot: RouterSnapshot, data: Any, size: str) -> List[RemoteImage]:
    assets = data.get("assets") if isinstance(data, dict) else None
    if not isinstance(assets, list):
        raise RouterError("router_bad_response", 502, "Image response has no assets list.")
    fallback = _parse_size(size) or (0, 0)
    images: List[RemoteImage] = []
    for item in assets:
        url = item.get("url") if isinstance(item, dict) else None
        if not isinstance(url, str) or not url:
            continue
        width, height = item.get("width"), item.get("height")
        images.append(RemoteImage(
            url=asset_url(snapshot, url), router=snapshot,
            width=width if isinstance(width, int) and width > 0 else fallback[0],
            height=height if isinstance(height, int) and height > 0 else fallback[1],
        ))
    return images


def _batch_sizes(count: int, max_count: int) -> List[int]:
    sizes = [max_count] * (count // max_count)
    return sizes + ([count % max_count] if count % max_count else [])


async def _run_batches(snapshot: RouterSnapshot, body: Dict[str, Any],
                       batches: List[int], size: str) -> RouterImageResult:
    client = AsyncRouterClient(snapshot)
    result = RouterImageResult(images=[])
    for index, batch in enumerate(batches):
        try:
            data = await client.post(IMAGE_PATH, {**body, "count": batch}, gate="ai_image")
        except RouterError as error:
            if index == 0:
                raise
            result.notes.append(
                f"Stopped after {len(result.images)} image(s): {error.code}.")
            logger.warning("skillrouter image batch %d failed: %s", index + 1, error.code)
            break
        result.images.extend(_to_remote_images(snapshot, data, size))
        failed = data.get("failed") if isinstance(data, dict) else 0
        if isinstance(failed, int) and failed > 0:
            result.notes.append(f"{failed} image(s) in batch {index + 1} failed upstream.")
            logger.warning("skillrouter image batch %d: %d failed", index + 1, failed)
    return result


async def generate_via_router(
    *, prompt: str, size: str, count: int = 1,
    reference: Optional[str] = None, watermark: bool = True,
) -> RouterImageResult:
    """Generate ``count`` images and return their gateway asset references.

    Raises:
        RouterError: gateway/transport failure of the first batch, a reference
            that cannot be sent, or a response without any image.
    """
    snapshot = require_ready()
    limits = await catalog.ensure_limits("ai_image")
    if not limits:
        raise RouterError("capability_unavailable", 503,
                          "SkillRouter did not list the ai_image capability.")
    used_size = nearest_size(size, [str(s) for s in limits.get("sizes", [])])
    max_count = limits.get("maxCount")
    max_count = max_count if isinstance(max_count, int) and max_count >= 1 else DEFAULT_MAX_COUNT
    body = _request_body(prompt, used_size, count, shrink_reference(reference or ""), watermark)
    result = await _run_batches(snapshot, body, _batch_sizes(max(1, count), max_count), used_size)
    if not result.images:
        raise RouterError("invalid_provider_response", 502, "Gateway returned no images.")
    if used_size != size:
        result.notes.insert(0, f"Generated at {used_size}; {size} is not offered by SkillRouter.")
        logger.info("skillrouter image size mapped %s -> %s", size, used_size)
    return result
