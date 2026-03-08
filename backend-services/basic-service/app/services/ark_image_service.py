"""
Service for Ark Seedream image generation via Ark API.

Unlike the video API (async task-based with polling), the image API is
synchronous — it returns image URLs directly in the response.
"""

import os
import logging
from datetime import date
from typing import List
from uuid import uuid4

import aiofiles
import httpx

from app.config import settings
from app.models.ark_image_models import ArkImageGenerateRequest, ArkImageResult
from app.services.oss_client import get_oss_client

logger = logging.getLogger(__name__)

ARK_IMAGE_API = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
ARK_IMAGE_MODEL = "doubao-seedream-5-0-260128"


def _parse_size(size: str) -> tuple[int, int]:
    """Parse 'WxH' string into (width, height)."""
    parts = size.split("x")
    return int(parts[0]), int(parts[1])


def _build_prompt(mode: str, user_prompt: str) -> str:
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


async def generate_images(request: ArkImageGenerateRequest) -> List[ArkImageResult]:
    """
    Generate images using the Ark Seedream API.

    Returns a list of ArkImageResult with image URLs.
    Raises ValueError if ARK_API_KEY is not configured.
    Raises httpx.HTTPStatusError or httpx.RequestError on network/API failure.
    """
    if not settings.ark_api_key:
        raise ValueError(
            "ARK_API_KEY is not configured. Set ARK_API_KEY in the backend .env file."
        )

    width, height = _parse_size(request.size)
    final_prompt = _build_prompt(request.mode, request.prompt)

    payload = {
        "model": ARK_IMAGE_MODEL,
        "prompt": final_prompt,
        "size": request.size,
        "n": request.count,
        "response_format": "url",
        "watermark": request.watermark,
    }

    if request.reference_image:
        payload["image_urls"] = [request.reference_image]

    if request.mode in ("character", "scene"):
        payload["n"] = 1

    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }

    logger.info(f"Ark image generation: prompt='{final_prompt[:50]}...', size={request.size}, count={request.count}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(ARK_IMAGE_API, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    # API response format: { "data": [ { "url": "..." }, ... ] }
    items = data.get("data", [])
    if not items:
        logger.warning(f"Ark image API returned empty data: {data}")
        return []

    today_str = date.today().strftime("%Y%m%d")
    storage_root = settings.storage.root
    local_dir = os.path.join(storage_root, "images", "ark", today_str)
    os.makedirs(local_dir, exist_ok=True)

    oss_client = get_oss_client()
    results: List[ArkImageResult] = []

    for item in items:
        remote_url = item.get("url", "")
        if not remote_url:
            continue

        # Download image to local storage
        file_id = uuid4().hex[:12]
        local_filename = f"{file_id}.png"
        local_path = os.path.join(local_dir, local_filename)

        try:
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as dl_client:
                dl_resp = await dl_client.get(remote_url)
                dl_resp.raise_for_status()
                async with aiofiles.open(local_path, "wb") as f:
                    await f.write(dl_resp.content)
            logger.info(f"Ark image downloaded to {local_path}")
        except Exception as exc:
            logger.warning(f"Failed to download Ark image: {exc}, using CDN URL")
            results.append(ArkImageResult(
                image_url=remote_url,
                local_url=None,
                width=width,
                height=height,
            ))
            continue

        local_url = f"/api/storage/files/images/ark/{today_str}/{local_filename}"
        relative_path = f"images/ark/{today_str}/{local_filename}"

        # Upload to OSS if enabled
        final_url = local_url
        if oss_client:
            try:
                final_url = await oss_client.upload_file(local_path, relative_path, "image/png")
                logger.info(f"Ark image uploaded to OSS: {final_url}")
            except Exception as oss_exc:
                logger.warning(f"OSS upload failed for Ark image: {oss_exc}, falling back to local URL")

        results.append(ArkImageResult(
            image_url=final_url,
            local_url=local_url,
            width=width,
            height=height,
        ))

    logger.info(f"Ark image generation complete: {len(results)} images")
    return results
