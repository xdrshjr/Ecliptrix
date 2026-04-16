"""
Reference image compositing service — tiles multiple reference images into a
single composite grid image so that ARK Seedream (which only accepts a single
`image` field) can consume multi-reference inputs.

Layout strategies by image count:
  1 → original image, no compositing
  2 → side-by-side (1×2)
  3 → top row 1 + bottom row 2 (1+2)
  4 → 2×2 grid
"""

from __future__ import annotations

import base64
import io
import math
from typing import List, Optional, Tuple

from PIL import Image

from app.logger import get_logger
from app.services.grid_pack_service import resolve_reference_to_base64_or_url

logger = get_logger(__name__)

CELL_SIZE = 512
GAP = 8
BG_COLOR = (255, 255, 255)


def position_labels(count: int) -> List[str]:
    """Return human-readable position labels for *count* images."""
    if count <= 1:
        return []
    if count == 2:
        return ["left", "right"]
    if count == 3:
        return ["top", "bottom-left", "bottom-right"]
    return ["top-left", "top-right", "bottom-left", "bottom-right"]


def _position_labels(count: int) -> List[str]:
    """Backward-compat alias for position_labels."""
    return position_labels(count)


def _layout(count: int) -> Tuple[int, int]:
    """Return (rows, cols) for the given image count."""
    if count <= 1:
        return (1, 1)
    if count == 2:
        return (1, 2)
    if count == 3:
        return (2, 2)
    return (2, 2)


def _slot_positions(rows: int, cols: int, count: int) -> List[Tuple[int, int]]:
    """Row-major slot positions, only *count* slots filled."""
    slots: List[Tuple[int, int]] = []
    for r in range(rows):
        for c in range(cols):
            if len(slots) >= count:
                break
            slots.append((r, c))
        if len(slots) >= count:
            break
    return slots


async def _load_image(ref: str) -> Image.Image:
    """Normalize a reference value and load it as a PIL Image."""
    normalized = await resolve_reference_to_base64_or_url(ref)
    if not normalized:
        raise ValueError(f"Could not resolve reference image: {ref[:80]}")

    if normalized.startswith("data:"):
        header, b64_data = normalized.split(",", 1)
        img_bytes = base64.b64decode(b64_data)
        return Image.open(io.BytesIO(img_bytes)).convert("RGB")

    import httpx

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(normalized)
        resp.raise_for_status()
        return Image.open(io.BytesIO(resp.content)).convert("RGB")


def _composite_images(images: List[Image.Image]) -> Tuple[Image.Image, str]:
    """Tile images into a composite and return (composite_image, description).

    All images are resized to CELL_SIZE×CELL_SIZE before placement.
    """
    count = len(images)
    if count == 0:
        raise ValueError("No images to composite")
    if count == 1:
        return images[0], ""

    rows, cols = _layout(count)
    positions = _slot_positions(rows, cols, count)
    labels = position_labels(count)

    canvas_w = cols * CELL_SIZE + (cols - 1) * GAP
    canvas_h = rows * CELL_SIZE + (rows - 1) * GAP
    canvas = Image.new("RGB", (canvas_w, canvas_h), BG_COLOR)

    for i, (img, (r, c)) in enumerate(zip(images, positions)):
        resized = img.resize((CELL_SIZE, CELL_SIZE), Image.LANCZOS)
        x = c * (CELL_SIZE + GAP)
        y = r * (CELL_SIZE + GAP)
        canvas.paste(resized, (x, y))

    grid_desc = f"{rows}x{cols}" if rows != 1 else f"1x{cols}"
    parts = [f"{labels[i]} area" for i in range(len(labels))]
    description = (
        f"Reference image is a {grid_desc} collage grid. " + "; ".join(parts) + "."
    )
    return canvas, description


async def composite_references(
    images: List[str],
) -> Tuple[str, str]:
    """Composite multiple reference images into one.

    Args:
        images: List of image references (data URIs, URLs, or local paths).

    Returns:
        (composite_base64_data_uri, position_description)
        - composite_base64_data_uri: base64 data URI of the composite image.
        - position_description: Text describing where each image is placed,
          suitable for appending to the prompt.
    """
    count = len(images)
    if count == 0:
        raise ValueError("No reference images provided")
    if count == 1:
        normalized = await resolve_reference_to_base64_or_url(images[0])
        if not normalized:
            raise ValueError("Could not resolve single reference image")
        return normalized, ""

    loaded: List[Image.Image] = []
    for ref in images:
        img = await _load_image(ref)
        loaded.append(img)

    composite, description = _composite_images(loaded)

    buf = io.BytesIO()
    composite.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    data_uri = f"data:image/png;base64,{b64}"

    logger.info(
        f"Composited {count} reference images into {composite.size[0]}x{composite.size[1]} grid"
    )
    return data_uri, description


def replace_mention_tags(
    prompt: str,
    mentioned_images: dict,
    position_labels: List[str],
) -> str:
    """Replace @[name] tags in prompt with position-based descriptions.

    Args:
        prompt: User prompt containing @[name] tags.
        mentioned_images: Mapping of tag → image URL.
        position_labels: Labels like ["left area", "right area"].

    Returns:
        Prompt with @[name] replaced by position references.
    """
    tag_list = list(mentioned_images.keys())
    for i, tag in enumerate(tag_list):
        if i < len(position_labels):
            replacement = f"[{position_labels[i]} reference image]"
            prompt = prompt.replace(tag, replacement)
    return prompt
