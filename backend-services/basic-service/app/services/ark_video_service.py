"""
Service for Ark Seedance video generation via Ark API.
"""

import asyncio
import base64
import os
import logging
from datetime import date
from pathlib import Path
from typing import Dict, Optional

import aiofiles
import httpx

from app.config import settings
from app.models.ark_video_models import ArkVideoGenerateRequest, ArkVideoStatusResponse
from app.services.oss_client import get_oss_client

logger = logging.getLogger(__name__)

ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"

# Model supports both text-to-video and image-to-video in one endpoint.
ARK_MODEL = "doubao-seedance-1-5-pro-251215"

_MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}

# In-memory cache: ark_task_id -> status dict (avoids re-downloading completed tasks).
# Capped at _TASK_RESULTS_MAX_SIZE to prevent unbounded growth.
_task_results: Dict[str, dict] = {}
_TASK_RESULTS_MAX_SIZE = 200

# Tracks in-progress background download tasks to avoid duplicates.
_pending_downloads: Dict[str, asyncio.Task] = {}

# Caches CDN URL info for tasks whose background download is still in progress.
# Allows subsequent polls to return CDN URL without re-querying the Ark API.
_cdn_urls: Dict[str, dict] = {}


async def _resolve_image_url(url: str) -> str:
    """
    Convert relative/local image URLs to base64 data URIs for ARK API compatibility.

    The ARK Seedance API requires publicly accessible image URLs or data URIs.
    Local server paths (e.g., /api/storage/files/images/xxx.jpg) are unreachable
    by the API server, so we convert them to base64 data URIs instead.
    """
    if not url:
        return url

    # Already in a format the ARK API can handle
    if (
        url.startswith("data:")
        or url.startswith("https://")
        or url.startswith("http://")
    ):
        return url

    # Handle relative storage URLs like /api/storage/files/...
    if url.startswith("/"):
        storage_root = getattr(settings, "storage", None)
        if storage_root and hasattr(storage_root, "root"):
            root = storage_root.root
        else:
            root = "static/uploads"

        # Strip leading /api/storage/files/ prefix to get relative file path
        if url.startswith("/api/storage/files/"):
            relative_path = url[len("/api/storage/files/") :]
        else:
            relative_path = url.lstrip("/")

        local_path = os.path.join(root, relative_path)

        if os.path.exists(local_path):
            try:
                async with aiofiles.open(local_path, "rb") as f:
                    file_data = await f.read()

                ext = os.path.splitext(local_path)[1].lower()
                mime_type = _MIME_MAP.get(ext, "image/jpeg")
                b64 = base64.b64encode(file_data).decode("ascii")
                data_uri = f"data:{mime_type};base64,{b64}"
                logger.info(
                    f"Resolved local image URL to base64 data URI "
                    f"(path={local_path}, size={len(file_data)} bytes, mime={mime_type})"
                )
                return data_uri
            except Exception as exc:
                logger.warning(
                    f"Failed to convert local image to base64: {local_path}: {exc}"
                )

        logger.warning(
            f"Local image file not found for URL '{url}' "
            f"(tried path: {local_path}). "
            f"ARK API requires publicly accessible URLs or data URIs."
        )

    return url


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


async def _download_and_cache(
    ark_task_id: str,
    video_remote_url: str,
    duration: Optional[int],
    width: Optional[int],
    height: Optional[int],
) -> None:
    """
    Background task: download video from ARK CDN to local storage, upload to OSS, and extract thumbnail.
    Uses asyncio.create_subprocess_exec for non-blocking ffmpeg execution.
    Uploads both video and thumbnail to OSS when OSS is enabled; falls back to local URLs otherwise.
    Updates _task_results cache when complete so subsequent polls return the final URL.
    """
    try:
        today_str = date.today().strftime("%Y%m%d")
        storage_root = settings.storage.root  # e.g. "static/uploads"
        local_dir = os.path.join(storage_root, "video", "ark", today_str)
        os.makedirs(local_dir, exist_ok=True)

        local_filename = f"{ark_task_id}.mp4"
        local_path = os.path.join(local_dir, local_filename)

        # Skip download if file already exists (e.g. after server restart)
        if not Path(local_path).exists():
            logger.info(
                f"Background: downloading Ark video {ark_task_id} to {local_path}"
            )
            async with httpx.AsyncClient(
                timeout=120.0, follow_redirects=True
            ) as dl_client:
                async with dl_client.stream("GET", video_remote_url) as stream_response:
                    stream_response.raise_for_status()
                    async with aiofiles.open(local_path, "wb") as f:
                        async for chunk in stream_response.aiter_bytes(
                            chunk_size=65536
                        ):
                            await f.write(chunk)
            logger.info(f"Background: Ark video {ark_task_id} downloaded")
        else:
            logger.info(
                f"Background: Ark video {ark_task_id} already exists locally, skipping download"
            )

        local_url = f"/api/storage/files/video/ark/{today_str}/{local_filename}"
        video_relative_path = f"video/ark/{today_str}/{local_filename}"

        # Upload video to OSS (fall back to local URL on failure or when OSS is disabled)
        final_video_url = local_url
        oss_client = get_oss_client()
        if oss_client:
            try:
                final_video_url = await oss_client.upload_file(
                    local_path, video_relative_path, "video/mp4"
                )
                logger.info(
                    f"Background: Ark video {ark_task_id} uploaded to OSS: {final_video_url}"
                )
            except Exception as oss_exc:
                logger.warning(
                    f"Background: OSS upload failed for Ark video {ark_task_id}: {oss_exc}, "
                    "falling back to local URL"
                )

        # Generate thumbnail via ffmpeg — use asyncio subprocess to avoid blocking event loop
        thumbnail_url: Optional[str] = None
        try:
            thumb_filename = f"thumb_{ark_task_id}.jpg"
            thumb_path = os.path.join(local_dir, thumb_filename)

            if not Path(thumb_path).exists():
                seek_time = 1 if (duration or 0) > 2 else 0
                ffmpeg_cmd = [
                    "ffmpeg",
                    "-ss",
                    str(seek_time),
                    "-i",
                    local_path,
                    "-vframes",
                    "1",
                    "-q:v",
                    "2",
                    "-vf",
                    "scale=320:-1",
                    "-y",
                    thumb_path,
                ]
                process = await asyncio.create_subprocess_exec(
                    *ffmpeg_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await asyncio.wait_for(process.communicate(), timeout=30)
                if process.returncode == 0 and Path(thumb_path).exists():
                    thumbnail_url = (
                        f"/api/storage/files/video/ark/{today_str}/{thumb_filename}"
                    )
                    logger.info(
                        f"Background: Ark video thumbnail generated: {thumb_path}"
                    )
                else:
                    logger.warning(
                        f"Background: ffmpeg thumbnail failed for {ark_task_id}: "
                        + (stderr.decode(errors="replace")[:300] if stderr else "")
                    )
            else:
                thumbnail_url = (
                    f"/api/storage/files/video/ark/{today_str}/{thumb_filename}"
                )
                logger.info(
                    f"Background: Ark video thumbnail already exists: {thumb_path}"
                )

            # Upload thumbnail to OSS if generated successfully
            if thumbnail_url and oss_client:
                try:
                    thumb_relative_path = f"video/ark/{today_str}/{thumb_filename}"
                    thumbnail_url = await oss_client.upload_file(
                        thumb_path, thumb_relative_path, "image/jpeg"
                    )
                    logger.info(
                        f"Background: Ark thumbnail {ark_task_id} uploaded to OSS: {thumbnail_url}"
                    )
                except Exception as oss_exc:
                    logger.warning(
                        f"Background: OSS thumbnail upload failed for {ark_task_id}: {oss_exc}, "
                        "falling back to local URL"
                    )
        except FileNotFoundError:
            logger.warning(
                "Background: ffmpeg not found — skipping Ark video thumbnail generation"
            )
        except asyncio.TimeoutError:
            logger.warning(f"Background: ffmpeg thumbnail timed out for {ark_task_id}")
            try:
                process.kill()
                await process.wait()
            except Exception:
                pass
        except Exception as exc:
            logger.warning(f"Background: Ark video thumbnail generation failed: {exc}")

        result = {
            "video_url": final_video_url,
            "thumbnail_url": thumbnail_url,
            "duration": duration,
            "width": width,
            "height": height,
        }
        _cache_result(ark_task_id, result)
        logger.info(
            f"Background: Ark video {ark_task_id} processing complete, final URL: {final_video_url}"
        )

    except asyncio.CancelledError:
        logger.info(f"Background: Ark video {ark_task_id} download cancelled")
        raise
    except Exception as exc:
        logger.error(
            f"Background: Ark video {ark_task_id} download/processing failed: {exc}"
        )
    finally:
        _pending_downloads.pop(ark_task_id, None)
        _cdn_urls.pop(ark_task_id, None)


async def create_task(request: ArkVideoGenerateRequest) -> str:
    """
    Submit a video generation task to the Ark platform.

    Supports three generation modes:
    - "description": Uses image_url/image_urls as reference images (first_frame/last_frame roles).
      Ratio is "adaptive" when images are present, otherwise uses request.aspect_ratio.
    - "keyframe": Uses first_frame_url (required) and last_frame_url (optional).
      Ratio is always forced to "adaptive". image_url/image_urls are ignored.
    - "reference": Uses image_url/image_urls as style/content references.
      Images are sent with first_frame/last_frame roles (ARK API requirement in
      structured mode). Ratio is "adaptive" when images are present.

    Returns the ark_task_id string.
    Raises ValueError if ARK_API_KEY is not configured or if keyframe mode is missing first_frame_url.
    Raises httpx.HTTPStatusError or httpx.RequestError on network/API failure.
    """
    if not settings.ark_api_key:
        raise ValueError(
            "ARK_API_KEY is not configured. Set ARK_API_KEY in the backend .env file."
        )

    # Build content list — always starts with the text prompt
    content: list = [{"type": "text", "text": request.prompt}]

    if request.mode == "keyframe":
        # --- Keyframe mode ---
        # first_frame_url is required; last_frame_url is optional.
        # image_url / image_urls are intentionally ignored in this mode.
        if not request.first_frame_url:
            raise ValueError(
                "first_frame_url is required when mode is 'keyframe'. "
                "Provide a URL or base64 data URI for the first frame image."
            )

        resolved_first = await _resolve_image_url(request.first_frame_url)
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": resolved_first},
                "role": "first_frame",
            }
        )

        if request.last_frame_url:
            resolved_last = await _resolve_image_url(request.last_frame_url)
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": resolved_last},
                    "role": "last_frame",
                }
            )

        # Keyframe mode always uses adaptive ratio (API requirement when images are present)
        ratio = "adaptive"
        image_count = 1 + (1 if request.last_frame_url else 0)

    elif request.mode == "reference":
        # --- Reference mode ---
        # ARK Seedance API requires "role" on every image in structured mode
        # (with top-level duration/ratio/resolution). The only valid roles are
        # "first_frame" and "last_frame". Reference images are mapped to these
        # roles so the API accepts them — functionally equivalent to style/content reference.
        all_images = list(request.image_urls or [])
        if request.image_url and request.image_url not in all_images:
            all_images.insert(0, request.image_url)

        image_roles = ["first_frame", "last_frame"]
        for i, img_url in enumerate(all_images[:2]):
            resolved_url = await _resolve_image_url(img_url)
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": resolved_url},
                    "role": image_roles[i],
                }
            )

        ratio = "adaptive" if all_images else request.aspect_ratio
        image_count = len(all_images[:2])

    else:
        # --- Description mode (default) ---
        # Preserves existing behavior: merge image_urls and image_url, assign first_frame/last_frame roles.
        # first_frame_url / last_frame_url are intentionally ignored in this mode.
        all_images = list(request.image_urls or [])
        if request.image_url and request.image_url not in all_images:
            all_images.insert(0, request.image_url)

        # Ark API requires role for each image: first_frame for first, last_frame for second
        image_roles = ["first_frame", "last_frame"]
        for i, img_url in enumerate(all_images[:2]):
            resolved_url = await _resolve_image_url(img_url)
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": resolved_url},
                    "role": image_roles[i],
                }
            )

        # When images are present, ratio must be "adaptive" (API requirement)
        ratio = "adaptive" if all_images else request.aspect_ratio
        image_count = len(all_images[:2])

    # duration, ratio, resolution are top-level payload fields (not prompt flags)
    payload: dict = {
        "model": ARK_MODEL,
        "content": content,
        "duration": request.duration,
        "ratio": ratio,
        "resolution": request.resolution,
    }

    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }

    logger.info(
        f"Ark video task request: model={ARK_MODEL}, mode={request.mode}, "
        f"images={image_count}, ratio={ratio}, duration={request.duration}"
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(ARK_API_BASE, json=payload, headers=headers)
        if response.status_code != 200:
            error_body = response.text
            logger.error(f"Ark API error {response.status_code}: {error_body}")
            logger.error(
                f"Ark API failed payload (mode={request.mode}): "
                f"ratio={ratio}, duration={request.duration}, "
                f"content_types={[c.get('type') for c in content]}"
            )
            try:
                error_json = response.json()
                ark_error_msg = (
                    error_json.get("error", {}).get("message")
                    if isinstance(error_json.get("error"), dict)
                    else error_json.get("message", "")
                )
            except Exception:
                ark_error_msg = error_body[:500]
            raise httpx.HTTPStatusError(
                f"Ark API {response.status_code}: {ark_error_msg or error_body[:300]}",
                request=response.request,
                response=response,
            )
        data = response.json()

    ark_task_id = data.get("id")
    if not ark_task_id:
        raise ValueError(f"Ark API response missing task ID: {data}")

    logger.info(f"Ark video task created: {ark_task_id} (mode={request.mode})")
    return ark_task_id


async def get_status(ark_task_id: str) -> ArkVideoStatusResponse:
    """
    Query task status from Ark.

    On first successful poll: returns CDN URL immediately and starts a background
    task to download the video to local storage + extract thumbnail.

    On subsequent polls (after background download completes): returns local URL
    and server-side thumbnail from cache.
    """
    # Return cached result (local URL + thumbnail) if background download completed
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

    # Background download in progress — return CDN URL without re-querying Ark API
    if ark_task_id in _cdn_urls:
        cdn = _cdn_urls[ark_task_id]
        return ArkVideoStatusResponse(
            success=True,
            message="Video generation succeeded",
            status="succeeded",
            video_url=cdn["video_url"],
            thumbnail_url=None,
            duration=cdn.get("duration"),
            width=cdn.get("width"),
            height=cdn.get("height"),
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
        duration: Optional[int] = (
            int(duration_val) if duration_val is not None else None
        )
        width, height = _parse_resolution(data)

        # Start background download+thumbnail task if not already running
        if ark_task_id not in _pending_downloads:
            _cdn_urls[ark_task_id] = {
                "video_url": video_remote_url,
                "duration": duration,
                "width": width,
                "height": height,
            }
            task = asyncio.create_task(
                _download_and_cache(
                    ark_task_id, video_remote_url, duration, width, height
                )
            )
            _pending_downloads[ark_task_id] = task
            logger.info(
                f"Ark task {ark_task_id}: started background download, "
                "returning CDN URL immediately for instant playback"
            )

        # Return CDN URL immediately — frontend can play video right away.
        # thumbnail_url is None here; the frontend generates it client-side via canvas.
        return ArkVideoStatusResponse(
            success=True,
            message="Video generation succeeded",
            status="succeeded",
            video_url=video_remote_url,
            thumbnail_url=None,
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
