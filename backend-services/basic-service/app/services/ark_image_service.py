"""
Service for Ark Seedream image generation via Ark API.

Unlike the video API (async task-based with polling), the image API is
synchronous — it returns image URLs directly in the response.

The service has two shapes:

1. **Legacy mode** (``grid_mode=false`` or ``mode=basic``): generate N images
   and return them one-to-one. Retained for backward compatibility.
2. **Grid pack mode** (``grid_mode=true`` and ``mode in {character, scene}``):
   generate a single 3x3 composite via ARK, crop the 9 cells on disk, persist
   metadata and return a full :class:`ArkImagePack` alongside the composite.
"""

import json
import os
import logging
from datetime import date, datetime, timezone
from typing import List, Optional, Tuple
from uuid import uuid4

import aiofiles
import httpx

from app.config import settings
from app.models.ark_image_models import (
    ArkImageGenerateRequest,
    ArkImagePack,
    ArkImagePackFrame,
    ArkImageResult,
)
from app.services import grid_pack_service
from app.services.grid_pack_service import (
    CHARACTER_SUB_VIEWS,
    PACK_TYPE_CHARACTER,
    PACK_TYPE_SCENE,
    SCENE_SUB_VIEWS,
    build_character_grid_prompt,
    build_scene_grid_prompt,
    resolve_reference_to_base64_or_url,
)
from app.services.reference_compositor import (
    composite_references,
    position_labels,
    replace_mention_tags,
)

logger = logging.getLogger(__name__)

ARK_IMAGE_API = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
ARK_IMAGE_MODEL = "doubao-seedream-5-0-260128"
GRID_PACK_SIZE = "2048x2048"  # fixed per design — 3x3 grid, 1:1 total image


def _parse_size(size: str) -> Tuple[int, int]:
    parts = size.split("x")
    return int(parts[0]), int(parts[1])


def _build_prompt(mode: str, user_prompt: str) -> str:
    """Legacy single-image prompt builder (grid_mode=false path)."""
    if mode == "character":
        return (
            f"Character reference sheet of: {user_prompt}. "
            "Multiple views arranged in a grid: front view, side view, back view, "
            "three-quarter view, and facial close-up. "
            "Consistent character design across all views, clean white background, "
            "professional character turnaround sheet style."
        )
    elif mode == "scene":
        return (
            f"Scene reference sheet of: {user_prompt}. "
            "Multiple views arranged in a grid: panoramic wide shot, medium shot, "
            "detail close-up, and top-down bird's eye view. "
            "Consistent scene design and lighting across all views, "
            "professional environment concept art sheet style."
        )
    return user_prompt


def _should_generate_grid_pack(request: ArkImageGenerateRequest) -> bool:
    return request.grid_mode and request.mode in ("character", "scene")


async def _resolve_multi_references(
    request: ArkImageGenerateRequest,
) -> Tuple[Optional[str], str]:
    """Resolve reference images for multi-image support.

    Returns (normalized_reference, modified_prompt).
    Priority: reference_images > reference_image (backward compat).
    """
    ref_images = request.reference_images
    mentioned = request.mentioned_images
    prompt = request.prompt

    if ref_images and len(ref_images) > 1:
        composite_data_uri, position_desc = await composite_references(ref_images)
        modified_prompt = prompt
        if mentioned:
            labels = position_labels(len(ref_images))
            modified_prompt = replace_mention_tags(prompt, mentioned, labels)
        if position_desc:
            if mentioned:
                modified_prompt = f"{modified_prompt}\n{position_desc}"
            else:
                modified_prompt = (
                    f"{prompt}\n{position_desc} "
                    "Please synthesize elements from all reference areas."
                )
        return composite_data_uri, modified_prompt

    if ref_images and len(ref_images) == 1:
        normalized = await resolve_reference_to_base64_or_url(ref_images[0])
        return normalized, prompt

    if request.reference_image:
        normalized = await resolve_reference_to_base64_or_url(request.reference_image)
        return normalized, prompt

    return None, prompt


async def _call_ark(payload: dict) -> str:
    """POST to ARK Seedream and return the first result URL."""
    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(ARK_IMAGE_API, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    items = data.get("data", [])
    if not items or not items[0].get("url"):
        raise ValueError(f"ARK Seedream returned no image data: {data}")
    return items[0]["url"]


async def _generate_grid_pack(
    request: ArkImageGenerateRequest,
) -> Tuple[ArkImagePack, ArkImageResult]:
    """Generate a 3x3 grid pack for character/scene modeling and persist it.

    Returns (pack, composite_image_result).
    """
    pack_type = PACK_TYPE_CHARACTER if request.mode == "character" else PACK_TYPE_SCENE
    sub_views = (
        CHARACTER_SUB_VIEWS if pack_type == PACK_TYPE_CHARACTER else SCENE_SUB_VIEWS
    )

    if pack_type == PACK_TYPE_CHARACTER:
        final_prompt = build_character_grid_prompt(request.prompt, request.aspect_ratio)
    else:
        final_prompt = build_scene_grid_prompt(request.prompt, request.aspect_ratio)

    payload = {
        "model": ARK_IMAGE_MODEL,
        "prompt": final_prompt,
        "size": GRID_PACK_SIZE,
        "n": 1,
        "response_format": "url",
        "watermark": request.watermark,
    }

    normalized_reference: Optional[str] = None
    resolved_prompt = request.prompt
    normalized_reference, resolved_prompt = await _resolve_multi_references(request)
    if normalized_reference:
        payload["image"] = normalized_reference
        if resolved_prompt != request.prompt:
            if pack_type == PACK_TYPE_CHARACTER:
                final_prompt = build_character_grid_prompt(
                    resolved_prompt, request.aspect_ratio
                )
            else:
                final_prompt = build_scene_grid_prompt(
                    resolved_prompt, request.aspect_ratio
                )
            payload["prompt"] = final_prompt
        logger.info(
            f"Grid pack reference image attached (normalized, {len(normalized_reference)} chars)"
        )

    request_reference_image = (
        request.reference_images[0]
        if request.reference_images and len(request.reference_images) == 1
        else request.reference_image
    )

    logger.info(
        f"Ark grid pack generation: pack_type={pack_type}, prompt='{request.prompt[:50]}...'"
    )

    remote_url = await _call_ark(payload)

    # Persist the pack on disk.
    pack_id = uuid4().hex[:16]
    today_str = date.today().strftime("%Y%m%d")
    pack_dir = os.path.join(
        grid_pack_service.pack_base_dir(pack_type), today_str, pack_id
    )
    os.makedirs(pack_dir, exist_ok=True)

    original_path = os.path.join(pack_dir, "original.png")
    # Use the locally imported httpx so tests that monkey-patch
    # ``ark_image_service.httpx.AsyncClient`` can intercept the download too.
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as dl_client:
        dl_resp = await dl_client.get(remote_url)
        dl_resp.raise_for_status()
        async with aiofiles.open(original_path, "wb") as f:
            await f.write(dl_resp.content)

    frame_dicts = grid_pack_service.crop_grid(
        image_path=original_path,
        rows=3,
        cols=3,
        output_dir=pack_dir,
        aspect_ratio=request.aspect_ratio,
    )

    # Persist reference alongside pack so the UI can still show what the user
    # sent in. Mirrors storyboard behavior (data URI → reference.png).
    saved_reference_url: Optional[str] = None
    if request_reference_image:
        raw = request_reference_image
        source = normalized_reference or raw
        if source and source.startswith("data:"):
            try:
                import base64

                _, b64_data = source.split(",", 1)
                ref_bytes = base64.b64decode(b64_data)
                ref_path = os.path.join(pack_dir, "reference.png")
                async with aiofiles.open(ref_path, "wb") as f:
                    await f.write(ref_bytes)
                saved_reference_url = grid_pack_service.frame_url(
                    pack_type, today_str, pack_id, "reference.png"
                )
            except Exception as exc:
                logger.warning(f"Failed to save reference image: {exc}")
        else:
            saved_reference_url = raw

    # Attach sub_view labels to frames and build response model.
    for i, fd in enumerate(frame_dicts):
        if i < len(sub_views):
            fd["sub_view"] = sub_views[i]

    original_image_url = grid_pack_service.frame_url(
        pack_type, today_str, pack_id, "original.png"
    )
    now_iso = datetime.now(timezone.utc).isoformat()

    frames_model: List[ArkImagePackFrame] = []
    for fd in frame_dicts:
        frames_model.append(
            ArkImagePackFrame(
                index=fd["index"],
                filename=fd["filename"],
                url=grid_pack_service.frame_url(
                    pack_type, today_str, pack_id, fd["filename"]
                ),
                row=fd["row"],
                col=fd["col"],
                sub_view=fd.get("sub_view"),
            )
        )

    metadata = {
        "pack_id": pack_id,
        "pack_type": pack_type,
        "prompt": request.prompt,
        "grid_size": "3x3",
        "aspect_ratio": request.aspect_ratio,
        "frame_count": len(frames_model),
        "sub_views": sub_views,
        "created_at": now_iso,
        "reference_image": saved_reference_url,
        "original_image_url": original_image_url,
        "frames": frame_dicts,
    }
    await grid_pack_service.write_pack_metadata(pack_dir, metadata)

    pack = ArkImagePack(
        pack_id=pack_id,
        pack_type=pack_type,
        prompt=request.prompt,
        grid_size="3x3",
        aspect_ratio=request.aspect_ratio,
        frame_count=len(frames_model),
        created_at=now_iso,
        original_image_url=original_image_url,
        reference_image_url=saved_reference_url,
        frames=frames_model,
    )

    # Provide the composite as an ArkImageResult for backward-compatible callers.
    composite = ArkImageResult(
        image_url=original_image_url,
        local_url=original_image_url,
        width=2048,
        height=2048,
    )
    return pack, composite


async def _generate_legacy_images(
    request: ArkImageGenerateRequest,
    *, defer_download: bool = False,
) -> List[ArkImageResult]:
    """Legacy (non-grid) single-image generation path."""
    width, height = _parse_size(request.size)

    normalized_reference, resolved_prompt = await _resolve_multi_references(request)
    final_prompt = _build_prompt(request.mode, resolved_prompt)

    payload = {
        "model": ARK_IMAGE_MODEL,
        "prompt": final_prompt,
        "size": request.size,
        "n": request.count,
        "response_format": "url",
        "watermark": request.watermark,
    }

    if normalized_reference:
        payload["image"] = normalized_reference
        logger.info(
            f"Ark image reference attached (normalized, {len(normalized_reference)} chars)"
        )

    if request.mode in ("character", "scene"):
        payload["n"] = 1

    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }

    logger.info(
        f"Ark image generation (legacy): prompt='{final_prompt[:50]}...', "
        f"size={request.size}, count={request.count}"
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(ARK_IMAGE_API, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    items = data.get("data", [])
    if not items:
        logger.warning(f"Ark image API returned empty data: {data}")
        return []

    if defer_download:
        return [ArkImageResult(image_url=item["url"], width=width,
                               height=height)
                for item in items if item.get("url")]

    today_str = date.today().strftime("%Y%m%d")
    storage_root = settings.storage.root
    local_dir = os.path.join(storage_root, "images", "ark", today_str)
    os.makedirs(local_dir, exist_ok=True)

    results: List[ArkImageResult] = []

    for item in items:
        remote_url = item.get("url", "")
        if not remote_url:
            continue

        file_id = uuid4().hex[:12]
        local_filename = f"{file_id}.png"
        local_path = os.path.join(local_dir, local_filename)

        try:
            async with httpx.AsyncClient(
                timeout=60.0, follow_redirects=True
            ) as dl_client:
                dl_resp = await dl_client.get(remote_url)
                dl_resp.raise_for_status()
                async with aiofiles.open(local_path, "wb") as f:
                    await f.write(dl_resp.content)
            logger.info(f"Ark image downloaded to {local_path}")
        except Exception as exc:
            logger.warning(f"Failed to download Ark image: {exc}, using CDN URL")
            results.append(
                ArkImageResult(
                    image_url=remote_url,
                    local_url=None,
                    width=width,
                    height=height,
                )
            )
            continue

        local_url = f"/api/storage/files/images/ark/{today_str}/{local_filename}"

        final_url = local_url

        results.append(
            ArkImageResult(
                image_url=final_url,
                local_url=local_url,
                width=width,
                height=height,
            )
        )

    logger.info(f"Ark image generation complete: {len(results)} images")
    return results


async def generate_images(
    request: ArkImageGenerateRequest,
) -> List[ArkImageResult]:
    """Backward-compatible entry point (legacy callers only use ``images``).

    Equivalent to calling :func:`generate_images_with_pack` and discarding the
    pack.
    """
    images, _pack = await generate_images_with_pack(request)
    return images


async def generate_images_with_pack(
    request: ArkImageGenerateRequest,
    *, defer_download: bool = False,
) -> Tuple[List[ArkImageResult], Optional[ArkImagePack]]:
    """Generate images; if grid_mode + character/scene, also persist a pack.

    Returns (images, pack). In grid mode, ``images`` contains exactly one
    entry (the composite) and ``pack`` carries the 9 cropped frames.
    """
    if not settings.ark_api_key:
        raise ValueError(
            "ARK_API_KEY is not configured. Set ARK_API_KEY in the backend .env file."
        )

    if _should_generate_grid_pack(request):
        pack, composite = await _generate_grid_pack(request)
        return [composite], pack

    results = await _generate_legacy_images(request, defer_download=defer_download)
    return results, None
