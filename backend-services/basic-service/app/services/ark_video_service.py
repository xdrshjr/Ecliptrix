"""
Service for Ark Seedance video generation via Ark API.
"""

import os
import logging
import subprocess
from datetime import date
from pathlib import Path
from typing import Dict, Optional

import aiofiles
import httpx

from app.config import settings
from app.models.ark_video_models import ArkVideoGenerateRequest, ArkVideoStatusResponse

logger = logging.getLogger(__name__)

ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"

# Model supports both text-to-video and image-to-video in one endpoint.
ARK_MODEL = "doubao-seedance-1-5-pro-251215"

# In-memory cache: ark_task_id -> status dict (avoids re-downloading completed tasks).
# Capped at _TASK_RESULTS_MAX_SIZE to prevent unbounded growth.
_task_results: Dict[str, dict] = {}
_TASK_RESULTS_MAX_SIZE = 200


def _cache_result(ark_task_id: str, result: dict) -> None:
    """Store completed task result; evict oldest entries when over limit."""
    if len(_task_results) >= _TASK_RESULTS_MAX_SIZE:
        # Remove the first (oldest) entry
        oldest_key = next(iter(_task_results))
        del _task_results[oldest_key]
    _task_results[ark_task_id] = result


def _parse_resolution(data: dict) -> tuple[Optional[int], Optional[int]]:
    """
    Extract (width, height) from Ark API response.
    The API returns resolution as a top-level string like "1280x720" or "720p",
    and may also return width/height directly.
    """
    # Try explicit fields first
    width = data.get("width")
    height = data.get("height")
    if width and height:
        return int(width), int(height)

    # Fall back to "resolution" string field
    resolution = data.get("resolution", "")
    if "x" in resolution:
        try:
            parts = resolution.split("x")
            return int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            pass

    # Alias patterns like "1280x720", "720p", "1080p"
    if "1080" in resolution:
        return 1920, 1080
    if "720" in resolution:
        return 1280, 720
    if "480" in resolution:
        return 854, 480

    return None, None


async def create_task(request: ArkVideoGenerateRequest) -> str:
    """
    Submit a video generation task to the Ark platform.

    Returns the ark_task_id string.
    Raises ValueError if ARK_API_KEY is not configured.
    Raises httpx.HTTPStatusError or httpx.RequestError on network/API failure.
    """
    if not settings.ark_api_key:
        raise ValueError(
            "ARK_API_KEY is not configured. Set ARK_API_KEY in the backend .env file."
        )

    # Parameters are embedded in the prompt text (confirmed by Ark API spec)
    param_flags = (
        f"--duration {request.duration} "
        f"--camerafixed {str(request.camera_fixed).lower()} "
        f"--watermark {str(request.watermark).lower()}"
    )
    full_prompt = f"{request.prompt} {param_flags}"

    # Build content list
    content: list = [{"type": "text", "text": full_prompt}]
    if request.image_url:
        content.append({"type": "image_url", "image_url": {"url": request.image_url}})

    payload = {
        "model": ARK_MODEL,
        "content": content,
    }

    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(ARK_API_BASE, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    ark_task_id = data.get("id")
    if not ark_task_id:
        raise ValueError(f"Ark API response missing task ID: {data}")

    logger.info(f"Ark video task created: {ark_task_id}")
    return ark_task_id


async def get_status(ark_task_id: str) -> ArkVideoStatusResponse:
    """
    Query task status from Ark. On success, downloads the video to local storage.

    Returns an ArkVideoStatusResponse.
    """
    # Return cached result for completed tasks
    if ark_task_id in _task_results:
        cached = _task_results[ark_task_id]
        return ArkVideoStatusResponse(
            success=True,
            message="Task completed (cached)",
            status="succeeded",
            video_url=cached.get("video_url"),
            thumbnail_url=cached.get("thumbnail_url"),
            duration=cached.get("duration"),
            width=cached.get("width"),
            height=cached.get("height"),
        )

    if not settings.ark_api_key:
        raise ValueError("ARK_API_KEY is not configured.")

    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(f"{ARK_API_BASE}/{ark_task_id}", headers=headers)
        response.raise_for_status()
        data = response.json()

    task_status = data.get("status", "").lower()
    logger.info(f"Ark task {ark_task_id} status: {task_status}")

    if task_status == "succeeded":
        # Extract video URL — content is a dict: {"video_url": "https://..."}
        content = data.get("content", {})
        if isinstance(content, dict):
            video_remote_url: Optional[str] = content.get("video_url")
        else:
            video_remote_url = None

        if not video_remote_url:
            logger.error(
                f"Ark task {ark_task_id} succeeded but no video_url found. "
                f"Response keys: {list(data.keys())}, content keys: {list(content.keys()) if isinstance(content, dict) else type(content)}"
            )
            return ArkVideoStatusResponse(
                success=False,
                message="Task succeeded but no video URL returned",
                status="failed",
                error="No video URL in response",
            )

        # Duration and resolution are top-level fields
        duration_val = data.get("duration")
        duration: Optional[int] = int(duration_val) if duration_val is not None else None
        width, height = _parse_resolution(data)

        # Download video to local storage using async file I/O
        today_str = date.today().strftime("%Y%m%d")
        storage_root = settings.storage.root  # e.g. "static/uploads"
        local_dir = os.path.join(storage_root, "video", "ark", today_str)
        os.makedirs(local_dir, exist_ok=True)

        local_filename = f"{ark_task_id}.mp4"
        local_path = os.path.join(local_dir, local_filename)

        logger.info(f"Downloading Ark video {ark_task_id} to {local_path}")
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as dl_client:
            async with dl_client.stream("GET", video_remote_url) as stream_response:
                stream_response.raise_for_status()
                async with aiofiles.open(local_path, "wb") as f:
                    async for chunk in stream_response.aiter_bytes(chunk_size=65536):
                        await f.write(chunk)

        # Build local URL accessible via /api/storage/files/
        local_url = f"/api/storage/files/video/ark/{today_str}/{local_filename}"

        # Generate thumbnail via ffmpeg (same pattern as storage_service.py)
        thumbnail_url: Optional[str] = None
        try:
            thumb_filename = f"thumb_{ark_task_id}.jpg"
            thumb_path = os.path.join(local_dir, thumb_filename)
            # Seek to 1 second into the video (or 0 if very short)
            seek_time = 1 if (duration or 0) > 2 else 0
            ffmpeg_cmd = [
                "ffmpeg", "-ss", str(seek_time),
                "-i", local_path,
                "-vframes", "1",
                "-q:v", "2",
                "-vf", "scale=320:-1",
                "-y", thumb_path,
            ]
            ff_result = subprocess.run(ffmpeg_cmd, capture_output=True, timeout=30)
            if ff_result.returncode == 0 and Path(thumb_path).exists():
                thumbnail_url = f"/api/storage/files/video/ark/{today_str}/{thumb_filename}"
                logger.info(f"Ark video thumbnail generated: {thumb_path}")
            else:
                logger.warning(
                    f"ffmpeg thumbnail failed for {ark_task_id}: "
                    + (ff_result.stderr.decode(errors="replace")[:300] if ff_result.stderr else "")
                )
        except FileNotFoundError:
            logger.warning("ffmpeg not found — skipping Ark video thumbnail generation")
        except Exception as exc:
            logger.warning(f"Ark video thumbnail generation failed: {exc}")

        result = {
            "video_url": local_url,
            "thumbnail_url": thumbnail_url,
            "duration": duration,
            "width": width,
            "height": height,
        }
        _cache_result(ark_task_id, result)

        return ArkVideoStatusResponse(
            success=True,
            message="Video generation succeeded",
            status="succeeded",
            video_url=local_url,
            thumbnail_url=thumbnail_url,
            duration=duration,
            width=width,
            height=height,
        )

    elif task_status in ("failed", "cancelled", "canceled", "error", "timeout"):
        error_msg = (
            data.get("error", {}).get("message")
            or data.get("message")
            or f"Task {task_status}"
        )
        return ArkVideoStatusResponse(
            success=False,
            message=f"Task {task_status}",
            status="failed",
            error=error_msg,
        )

    else:
        # queued / running / processing / pending
        return ArkVideoStatusResponse(
            success=True,
            message="Task in progress",
            status="running",
        )
