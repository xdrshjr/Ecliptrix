"""
Storyboard service — generates multi-cell storyboard images via ARK Seedream,
crops them into individual frames with Pillow, generates VL_LLM scene
descriptions, orchestrates batch video generation, and composes the final video
with FFmpeg.
"""

import asyncio
import base64
import json
import os
import shutil
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from uuid import uuid4

import re

import aiofiles
import httpx
from openai import OpenAI
from PIL import Image

from app.config import settings
from app.logger import get_logger
from app.models.ark_video_models import ArkVideoGenerateRequest
from app.models.storyboard_models import (
    StoryboardBatchVideoRequest,
    StoryboardComposeRequest,
    StoryboardFrame,
    StoryboardGenerateRequest,
    StoryboardPack,
)
from app.services import ark_video_service
from app.services.oss_client import get_oss_client

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ARK_IMAGE_API = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
ARK_IMAGE_MODEL = "doubao-seedream-5-0-260128"

STORYBOARD_IMAGE_SIZE = "2048x2048"
STORYBOARD_CROP_PADDING = 4  # pixels inward per edge to remove separator lines
STORYBOARD_MAX_CONCURRENT_DESCRIBE = int(os.getenv('STORYBOARD_MAX_CONCURRENT_DESCRIBE', '5'))
STORYBOARD_MAX_CONCURRENT_VIDEO = int(os.getenv('STORYBOARD_MAX_CONCURRENT_VIDEO', '3'))
STORYBOARD_STORAGE_DIR = "storyboard"

ASPECT_RATIOS = {
    "1:1": (1, 1),
    "16:9": (16, 9),
    "9:16": (9, 16),
    "4:3": (4, 3),
    "3:4": (3, 4),
}

# In-memory cache: pack_id -> { frame_index -> ark_task_id }
_pack_video_tasks: Dict[str, Dict[int, str]] = {}
_PACK_CACHE_MAX_SIZE = 100

VL_SYSTEM_PROMPT = (
    "你是一个专业的视频分镜描述专家。请根据图片内容生成一段适合视频生成的详细场景描述。"
    "描述应包含: 主体、动作、场景环境、光线氛围、镜头角度。"
    "描述长度: 2-4句话。语言: 中文。"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _storage_root() -> str:
    """Return the configured storage root (e.g. 'static/uploads')."""
    return settings.storage.root


def _storyboard_base_dir() -> str:
    """Return the base directory for all storyboard packs."""
    return os.path.join(_storage_root(), STORYBOARD_STORAGE_DIR)


_SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


def _validate_pack_id(pack_id: str) -> None:
    """Raise ValueError if pack_id contains path traversal characters."""
    if not pack_id or not _SAFE_ID_PATTERN.match(pack_id):
        raise ValueError(f"Invalid pack_id: {pack_id!r}")


def _pack_dir(pack_id: str) -> Optional[str]:
    """Locate the directory for a given pack_id by scanning date dirs."""
    _validate_pack_id(pack_id)
    base = _storyboard_base_dir()
    if not os.path.isdir(base):
        return None
    for date_dir in sorted(os.listdir(base), reverse=True):
        candidate = os.path.join(base, date_dir, pack_id)
        if os.path.isdir(candidate):
            return candidate
    return None


def _frame_url(date_str: str, pack_id: str, filename: str) -> str:
    """Build a serving URL for a storyboard frame image."""
    return f"/api/storage/files/{STORYBOARD_STORAGE_DIR}/{date_str}/{pack_id}/{filename}"


def _parse_grid_size(grid_size: str) -> tuple[int, int]:
    """Parse '3x3' → (3, 3)."""
    parts = grid_size.split("x")
    return int(parts[0]), int(parts[1])


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

def build_storyboard_prompt(
    user_prompt: str, rows: int, cols: int, aspect_ratio: str = "1:1"
) -> str:
    """Build the system prompt instructing Seedream to generate an NxN grid."""
    ratio_instruction = ""
    if aspect_ratio != "1:1" and aspect_ratio in ASPECT_RATIOS:
        w, h = ASPECT_RATIOS[aspect_ratio]
        orientation = "横屏/landscape" if w > h else "竖屏/portrait"
        ratio_instruction = (
            f"- Each cell's content should be composed for a {aspect_ratio} ({orientation}) viewing format, "
            "with subjects and key elements centered accordingly\n"
        )

    return (
        f"Create a {rows}x{cols} grid storyboard image.\n\n"
        "LAYOUT REQUIREMENTS:\n"
        f"- The image must be divided into exactly {rows} rows and {cols} columns\n"
        "- Each cell must be exactly the same size\n"
        "- There must be thin white separator lines (about 2-3 pixels wide) between each cell\n"
        "- The cells must fill the entire image with no margins\n"
        f"{ratio_instruction}\n"
        "STRICT VISUAL-ONLY REQUIREMENTS:\n"
        "- Each cell must contain ONLY visual imagery — absolutely NO text, subtitles, captions, watermarks, or any written characters\n"
        "- Do NOT include any numbers, numerical labels, or index annotations in any cell\n"
        "- Every cell must be pure visual content with no overlaid text or symbols of any kind\n\n"
        "CONTENT:\n"
        f"{user_prompt}\n\n"
        "Each cell should contain a distinct scene or frame as described above.\n"
        "The overall style should be consistent across all cells.\n"
    )


# ---------------------------------------------------------------------------
# Image cropping
# ---------------------------------------------------------------------------

def _crop_cell_to_aspect_ratio(cell: Image.Image, aspect_ratio: str) -> Image.Image:
    """Center-crop a cell image to match the target aspect ratio."""
    if aspect_ratio == "1:1" or aspect_ratio not in ASPECT_RATIOS:
        return cell
    target_w, target_h = ASPECT_RATIOS[aspect_ratio]
    w, h = cell.size
    target_ratio = target_w / target_h
    current_ratio = w / h
    if current_ratio > target_ratio:
        # Too wide — crop width
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        return cell.crop((left, 0, left + new_w, h))
    elif current_ratio < target_ratio:
        # Too tall — crop height
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        return cell.crop((0, top, w, top + new_h))
    return cell


def crop_storyboard(
    image_path: str, rows: int, cols: int, output_dir: str,
    aspect_ratio: str = "1:1",
) -> List[dict]:
    """Crop a storyboard grid image into individual frame PNGs.

    Each cell is cropped with *STORYBOARD_CROP_PADDING* pixels inward on every
    edge to discard white separator lines produced by Seedream.

    Returns a list of frame-info dicts suitable for metadata.json.
    """
    img = Image.open(image_path)
    width, height = img.size

    cell_width = width // cols
    cell_height = height // rows
    padding = STORYBOARD_CROP_PADDING

    frames: List[dict] = []
    index = 0
    for row in range(rows):
        for col in range(cols):
            left = col * cell_width + padding
            upper = row * cell_height + padding
            right = (col + 1) * cell_width - padding
            lower = (row + 1) * cell_height - padding

            cell = img.crop((left, upper, right, lower))
            cell = _crop_cell_to_aspect_ratio(cell, aspect_ratio)
            filename = f"frame_{index + 1:03d}.png"
            cell.save(os.path.join(output_dir, filename))

            frames.append({
                "index": index,
                "filename": filename,
                "row": row,
                "col": col,
            })
            index += 1

    logger.info(f"Cropped storyboard into {len(frames)} frames at {output_dir}")
    return frames


# ---------------------------------------------------------------------------
# Storyboard generation (ARK Seedream)
# ---------------------------------------------------------------------------

async def generate_storyboard(request: StoryboardGenerateRequest) -> StoryboardPack:
    """Generate a storyboard image, crop it, and persist the pack."""

    if not settings.ark_api_key:
        raise ValueError(
            "ARK_API_KEY is not configured. Set ARK_API_KEY in the backend .env file."
        )

    rows, cols = _parse_grid_size(request.grid_size)
    aspect_ratio = getattr(request, "aspect_ratio", "1:1") or "1:1"
    final_prompt = build_storyboard_prompt(request.prompt, rows, cols, aspect_ratio)

    # Prepare ARK request payload
    payload: dict = {
        "model": ARK_IMAGE_MODEL,
        "prompt": final_prompt,
        "size": STORYBOARD_IMAGE_SIZE,
        "n": 1,
        "response_format": "url",
        "watermark": False,
    }

    # Handle optional reference image (base64 data URI → URL for the API)
    reference_image_url: Optional[str] = None
    if request.reference_image:
        payload["image_urls"] = [request.reference_image]
        # We'll save the reference image alongside the pack later if needed
        reference_image_url = request.reference_image

    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }

    logger.info(
        f"Storyboard generation: grid={request.grid_size}, "
        f"prompt='{request.prompt[:60]}...'"
    )

    # Call ARK Seedream API
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(ARK_IMAGE_API, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    items = data.get("data", [])
    if not items or not items[0].get("url"):
        raise ValueError(f"ARK Seedream returned no image data: {data}")

    remote_url = items[0]["url"]

    # Create pack directory
    pack_id = uuid4().hex[:16]
    today_str = date.today().strftime("%Y%m%d")
    pack_directory = os.path.join(_storyboard_base_dir(), today_str, pack_id)
    os.makedirs(pack_directory, exist_ok=True)

    # Download the generated image
    original_path = os.path.join(pack_directory, "original.png")
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as dl_client:
            dl_resp = await dl_client.get(remote_url)
            dl_resp.raise_for_status()
            async with aiofiles.open(original_path, "wb") as f:
                await f.write(dl_resp.content)
        logger.info(f"Storyboard image downloaded to {original_path}")
    except Exception as exc:
        logger.error(f"Failed to download storyboard image: {exc}")
        raise ValueError(f"Failed to download generated image: {exc}") from exc

    # Crop into individual frames
    frame_dicts = crop_storyboard(original_path, rows, cols, pack_directory, aspect_ratio)

    # Build frame metadata with URLs
    original_image_url = _frame_url(today_str, pack_id, "original.png")
    frames: List[StoryboardFrame] = []
    for fd in frame_dicts:
        frames.append(StoryboardFrame(
            index=fd["index"],
            filename=fd["filename"],
            url=_frame_url(today_str, pack_id, fd["filename"]),
            row=fd["row"],
            col=fd["col"],
        ))

    # Save reference image alongside pack if provided
    saved_reference_url: Optional[str] = None
    if request.reference_image and request.reference_image.startswith("data:"):
        try:
            # Extract base64 payload from data URI
            header, b64_data = request.reference_image.split(",", 1)
            ref_bytes = base64.b64decode(b64_data)
            ref_path = os.path.join(pack_directory, "reference.png")
            async with aiofiles.open(ref_path, "wb") as f:
                await f.write(ref_bytes)
            saved_reference_url = _frame_url(today_str, pack_id, "reference.png")
        except Exception as exc:
            logger.warning(f"Failed to save reference image: {exc}")

    # Write metadata.json
    now_iso = datetime.now(timezone.utc).isoformat()
    metadata = {
        "pack_id": pack_id,
        "prompt": request.prompt,
        "grid_size": request.grid_size,
        "aspect_ratio": aspect_ratio,
        "frame_count": len(frames),
        "created_at": now_iso,
        "reference_image": saved_reference_url,
        "original_image_url": original_image_url,
        "frames": [fd for fd in frame_dicts],
    }
    metadata_path = os.path.join(pack_directory, "metadata.json")
    async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(metadata, ensure_ascii=False, indent=2))

    # Optional OSS upload
    oss_client = get_oss_client()
    if oss_client:
        try:
            for filename in os.listdir(pack_directory):
                if filename.endswith((".png", ".json")):
                    local_file = os.path.join(pack_directory, filename)
                    rel = f"{STORYBOARD_STORAGE_DIR}/{today_str}/{pack_id}/{filename}"
                    content_type = "image/png" if filename.endswith(".png") else "application/json"
                    await oss_client.upload_file(local_file, rel, content_type)
            logger.info(f"Storyboard pack {pack_id} uploaded to OSS")
        except Exception as oss_exc:
            logger.warning(f"OSS upload failed for storyboard pack {pack_id}: {oss_exc}")

    pack = StoryboardPack(
        pack_id=pack_id,
        prompt=request.prompt,
        grid_size=request.grid_size,
        aspect_ratio=aspect_ratio,
        frame_count=len(frames),
        created_at=now_iso,
        original_image_url=original_image_url,
        reference_image_url=saved_reference_url,
        frames=frames,
    )

    logger.info(f"Storyboard pack created: {pack_id}, {len(frames)} frames")
    return pack


# ---------------------------------------------------------------------------
# VL_LLM frame description generation
# ---------------------------------------------------------------------------

async def generate_frame_descriptions(
    pack_id: str, frame_indices: Optional[List[int]] = None
) -> List[dict]:
    """Use VL_LLM to generate scene descriptions for storyboard frames.

    Concurrency is limited to STORYBOARD_MAX_CONCURRENT_DESCRIBE parallel
    requests.  Single-frame failures are logged but do not block others.
    """
    pack_directory = _pack_dir(pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Storyboard pack not found: {pack_id}")

    metadata_path = os.path.join(pack_directory, "metadata.json")
    async with aiofiles.open(metadata_path, "r", encoding="utf-8") as f:
        metadata = json.loads(await f.read())

    all_frames: List[dict] = metadata.get("frames", [])
    if frame_indices is not None:
        target_frames = [fr for fr in all_frames if fr["index"] in frame_indices]
    else:
        target_frames = list(all_frames)

    if not target_frames:
        return []

    # Validate VL LLM configuration
    if not settings.vl_llm_api_key or not settings.vl_llm_api_url:
        raise ValueError("VL_LLM_API_KEY and VL_LLM_API_URL must be configured for frame descriptions")

    vl_client = OpenAI(
        api_key=settings.vl_llm_api_key,
        base_url=settings.vl_llm_api_url,
    )

    semaphore = asyncio.Semaphore(STORYBOARD_MAX_CONCURRENT_DESCRIBE)
    results: List[dict] = []

    async def _describe_one(frame_info: dict) -> dict:
        async with semaphore:
            idx = frame_info["index"]
            filename = frame_info["filename"]
            frame_path = os.path.join(pack_directory, filename)

            if not os.path.exists(frame_path):
                logger.warning(f"Frame file missing: {frame_path}")
                return {"index": idx, "description": None}

            try:
                # Read and encode frame image
                async with aiofiles.open(frame_path, "rb") as img_f:
                    img_bytes = await img_f.read()
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                image_data_uri = f"data:image/png;base64,{b64}"

                # Call VL_LLM (synchronous OpenAI client in a thread)
                completion = await asyncio.to_thread(
                    vl_client.chat.completions.create,
                    model=settings.vl_llm_model,
                    messages=[
                        {"role": "system", "content": VL_SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": image_data_uri}},
                                {"type": "text", "text": "请描述这个分镜画面"},
                            ],
                        },
                    ],
                    timeout=30,
                )
                desc = completion.choices[0].message.content.strip()
                logger.info(f"Frame {idx} description generated ({len(desc)} chars)")
                return {"index": idx, "description": desc}

            except Exception as exc:
                logger.error(f"VL_LLM description failed for frame {idx}: {exc}")
                return {"index": idx, "description": None}

    # Run all descriptions concurrently (limited by semaphore)
    tasks = [_describe_one(fr) for fr in target_frames]
    results = await asyncio.gather(*tasks)

    # Update metadata.json with new descriptions
    desc_map = {r["index"]: r["description"] for r in results if r["description"]}
    if desc_map:
        for fr in metadata["frames"]:
            if fr["index"] in desc_map:
                fr["description"] = desc_map[fr["index"]]
        async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(metadata, ensure_ascii=False, indent=2))
        logger.info(f"Updated metadata for pack {pack_id} with {len(desc_map)} descriptions")

    return results


# ---------------------------------------------------------------------------
# Batch video generation
# ---------------------------------------------------------------------------

async def batch_generate_videos(request: StoryboardBatchVideoRequest) -> List[dict]:
    """Submit video generation tasks for storyboard frames via ark_video_service.

    Each segment uses description mode with the frame image as reference.
    Concurrency is limited to STORYBOARD_MAX_CONCURRENT_VIDEO.
    """
    pack_directory = _pack_dir(request.pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Storyboard pack not found: {request.pack_id}")

    metadata_path = os.path.join(pack_directory, "metadata.json")
    async with aiofiles.open(metadata_path, "r", encoding="utf-8") as f:
        metadata = json.loads(await f.read())

    # Build a lookup: index -> frame info
    frame_map = {fr["index"]: fr for fr in metadata.get("frames", [])}

    # Determine the date directory for URL construction
    # pack_directory looks like: .../storyboard/{date}/{pack_id}
    date_str = Path(pack_directory).parent.name

    semaphore = asyncio.Semaphore(STORYBOARD_MAX_CONCURRENT_VIDEO)
    task_results: List[dict] = []

    async def _submit_one(segment) -> dict:
        async with semaphore:
            frame_info = frame_map.get(segment.frame_index)
            if not frame_info:
                logger.warning(f"Frame index {segment.frame_index} not found in pack {request.pack_id}")
                return {"frame_index": segment.frame_index, "ark_task_id": None, "error": "Frame not found"}

            # Read frame image as base64 data URI since ARK API needs a reachable URL
            # and local serving paths (/api/storage/files/...) are not publicly accessible.
            frame_path = os.path.join(pack_directory, frame_info["filename"])
            try:
                async with aiofiles.open(frame_path, "rb") as img_file:
                    img_bytes = await img_file.read()
                import base64
                frame_data_uri = f"data:image/png;base64,{base64.b64encode(img_bytes).decode()}"
            except Exception as exc:
                logger.error(f"Failed to read frame image {frame_path}: {exc}")
                return {"frame_index": segment.frame_index, "ark_task_id": None, "error": f"Cannot read frame image: {exc}"}

            try:
                ark_request = ArkVideoGenerateRequest(
                    prompt=segment.description,
                    mode="description",
                    image_urls=[frame_data_uri],
                    duration=segment.duration,
                )
                ark_task_id = await ark_video_service.create_task(ark_request)
                logger.info(f"Video task created for frame {segment.frame_index}: {ark_task_id}")
                return {"frame_index": segment.frame_index, "ark_task_id": ark_task_id}
            except Exception as exc:
                logger.error(f"Failed to create video task for frame {segment.frame_index}: {exc}")
                return {"frame_index": segment.frame_index, "ark_task_id": None, "error": str(exc)}

    tasks = [_submit_one(seg) for seg in request.segments]
    task_results = await asyncio.gather(*tasks)

    # Cache task mappings
    if len(_pack_video_tasks) >= _PACK_CACHE_MAX_SIZE:
        oldest = next(iter(_pack_video_tasks))
        del _pack_video_tasks[oldest]

    _pack_video_tasks[request.pack_id] = {
        r["frame_index"]: r["ark_task_id"]
        for r in task_results
        if r.get("ark_task_id")
    }

    logger.info(f"Batch video: {len(task_results)} tasks submitted for pack {request.pack_id}")
    return task_results


async def get_batch_video_status(pack_id: str) -> List[dict]:
    """Query the current status of all video tasks associated with a pack."""
    task_map = _pack_video_tasks.get(pack_id)
    if not task_map:
        return []

    statuses: List[dict] = []
    for frame_index, ark_task_id in task_map.items():
        try:
            status_resp = await ark_video_service.get_status(ark_task_id)
            statuses.append({
                "frame_index": frame_index,
                "ark_task_id": ark_task_id,
                "status": status_resp.status,
                "video_url": status_resp.video_url,
                "thumbnail_url": status_resp.thumbnail_url,
                "error": status_resp.error,
            })
        except Exception as exc:
            logger.error(f"Failed to query status for task {ark_task_id}: {exc}")
            statuses.append({
                "frame_index": frame_index,
                "ark_task_id": ark_task_id,
                "status": "failed",
                "video_url": None,
                "thumbnail_url": None,
                "error": str(exc),
            })

    return statuses


# ---------------------------------------------------------------------------
# Video composition (FFmpeg concat)
# ---------------------------------------------------------------------------

async def compose_storyboard_video(request: StoryboardComposeRequest) -> dict:
    """Concatenate storyboard videos into a single video using FFmpeg.

    Attempts lossless stream copy first.  Falls back to re-encoding if that
    fails (e.g. mixed codecs).  Returns a dict with video_url and thumbnail_url.
    """
    pack_directory = _pack_dir(request.pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Storyboard pack not found: {request.pack_id}")

    # Create temporary working directory
    tmp_dir = tempfile.mkdtemp(prefix="storyboard_compose_")
    try:
        # Resolve all video files to local paths
        local_videos: List[str] = []
        storage_root = _storage_root()

        for i, video_url in enumerate(request.video_urls):
            # Convert serving URL to local filesystem path
            if video_url.startswith("/api/storage/files/"):
                relative = video_url[len("/api/storage/files/"):]
                # Prevent path traversal via ".." segments
                if ".." in relative:
                    raise ValueError(f"Invalid video URL (path traversal): {video_url}")
                local_path = os.path.join(storage_root, relative)
            elif os.path.isabs(video_url) and os.path.exists(video_url):
                # Only allow absolute paths under the storage root
                normalized = os.path.normpath(video_url)
                if not normalized.startswith(os.path.normpath(storage_root)):
                    raise ValueError(f"Video path is outside storage root: {video_url}")
                local_path = video_url
            else:
                # Download remote URL
                local_path = os.path.join(tmp_dir, f"input_{i:03d}.mp4")
                async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as dl:
                    resp = await dl.get(video_url)
                    resp.raise_for_status()
                    async with aiofiles.open(local_path, "wb") as f:
                        await f.write(resp.content)
                logger.info(f"Downloaded video {i} to {local_path}")

            if not os.path.exists(local_path):
                raise FileNotFoundError(f"Video file not found: {local_path} (url={video_url})")
            local_videos.append(local_path)

        # Build FFmpeg concat list
        concat_list_path = os.path.join(tmp_dir, "concat_list.txt")
        async with aiofiles.open(concat_list_path, "w", encoding="utf-8") as f:
            for vp in local_videos:
                # Use forward slashes and escape single quotes for FFmpeg
                safe_path = vp.replace("\\", "/").replace("'", "'\\''")
                await f.write(f"file '{safe_path}'\n")

        output_path = os.path.join(tmp_dir, "composed.mp4")

        # Try stream copy first (fast, lossless)
        copy_cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list_path,
            "-c", "copy",
            output_path,
        ]
        success = await _run_ffmpeg(copy_cmd, timeout=300)

        # Fallback: re-encode if stream copy failed
        if not success or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            logger.warning("Stream copy failed, falling back to re-encode")
            encode_cmd = [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", concat_list_path,
                "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                output_path,
            ]
            success = await _run_ffmpeg(encode_cmd, timeout=600)
            if not success or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                raise RuntimeError("FFmpeg composition failed (both stream copy and re-encode)")

        # Move composed video to pack directory
        final_video = os.path.join(pack_directory, "composed.mp4")
        shutil.copy2(output_path, final_video)

        # Determine URL components
        date_str = Path(pack_directory).parent.name
        video_url = _frame_url(date_str, request.pack_id, "composed.mp4")

        # Generate thumbnail
        thumbnail_url: Optional[str] = None
        thumb_path = os.path.join(pack_directory, "composed_thumb.jpg")
        thumb_cmd = [
            "ffmpeg", "-y", "-ss", "1",
            "-i", final_video,
            "-vframes", "1", "-q:v", "2",
            "-vf", "scale=320:-1",
            thumb_path,
        ]
        if await _run_ffmpeg(thumb_cmd, timeout=30):
            thumbnail_url = _frame_url(date_str, request.pack_id, "composed_thumb.jpg")
            logger.info(f"Composed video thumbnail generated: {thumb_path}")

        # Optional OSS upload
        oss_client = get_oss_client()
        if oss_client:
            try:
                rel_video = f"{STORYBOARD_STORAGE_DIR}/{date_str}/{request.pack_id}/composed.mp4"
                video_url = await oss_client.upload_file(final_video, rel_video, "video/mp4")
                if thumbnail_url and os.path.exists(thumb_path):
                    rel_thumb = f"{STORYBOARD_STORAGE_DIR}/{date_str}/{request.pack_id}/composed_thumb.jpg"
                    thumbnail_url = await oss_client.upload_file(thumb_path, rel_thumb, "image/jpeg")
            except Exception as oss_exc:
                logger.warning(f"OSS upload failed for composed video: {oss_exc}")

        logger.info(f"Storyboard video composed for pack {request.pack_id}: {video_url}")
        return {"video_url": video_url, "thumbnail_url": thumbnail_url}

    finally:
        # Clean up temp directory
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


async def _run_ffmpeg(cmd: List[str], timeout: int = 300) -> bool:
    """Run an FFmpeg command asynchronously.  Returns True on success."""
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        if process.returncode != 0:
            stderr_text = stderr.decode(errors="replace")[:500] if stderr else ""
            logger.warning(f"FFmpeg failed (rc={process.returncode}): {stderr_text}")
            return False
        return True
    except FileNotFoundError:
        logger.error("ffmpeg executable not found — is FFmpeg installed?")
        return False
    except asyncio.TimeoutError:
        logger.error(f"FFmpeg timed out after {timeout}s")
        try:
            process.kill()
            await process.wait()
        except Exception:
            pass
        return False
    except Exception as exc:
        logger.error(f"FFmpeg execution error: {exc}")
        return False


# ---------------------------------------------------------------------------
# Pack CRUD
# ---------------------------------------------------------------------------

async def list_packs() -> List[StoryboardPack]:
    """Scan storage directories and return all storyboard packs sorted by creation date."""
    base = _storyboard_base_dir()
    packs: List[StoryboardPack] = []

    if not os.path.isdir(base):
        return packs

    for date_dir_name in sorted(os.listdir(base), reverse=True):
        date_dir = os.path.join(base, date_dir_name)
        if not os.path.isdir(date_dir):
            continue
        for pack_id in os.listdir(date_dir):
            pack_path = os.path.join(date_dir, pack_id)
            meta_path = os.path.join(pack_path, "metadata.json")
            if not os.path.isfile(meta_path):
                continue
            try:
                async with aiofiles.open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.loads(await f.read())

                frames = [
                    StoryboardFrame(
                        index=fr["index"],
                        filename=fr["filename"],
                        url=_frame_url(date_dir_name, pack_id, fr["filename"]),
                        row=fr["row"],
                        col=fr["col"],
                        description=fr.get("description"),
                    )
                    for fr in meta.get("frames", [])
                ]

                packs.append(StoryboardPack(
                    pack_id=meta["pack_id"],
                    prompt=meta.get("prompt", ""),
                    grid_size=meta.get("grid_size", ""),
                    aspect_ratio=meta.get("aspect_ratio", "1:1"),
                    frame_count=meta.get("frame_count", len(frames)),
                    created_at=meta.get("created_at", ""),
                    original_image_url=meta.get(
                        "original_image_url",
                        _frame_url(date_dir_name, pack_id, "original.png"),
                    ),
                    reference_image_url=meta.get("reference_image"),
                    frames=frames,
                ))
            except Exception as exc:
                logger.warning(f"Failed to read storyboard pack at {pack_path}: {exc}")

    # Sort newest first
    packs.sort(key=lambda p: p.created_at, reverse=True)
    return packs


async def get_pack(pack_id: str) -> StoryboardPack:
    """Load a single storyboard pack by ID."""
    pack_directory = _pack_dir(pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Storyboard pack not found: {pack_id}")

    meta_path = os.path.join(pack_directory, "metadata.json")
    if not os.path.isfile(meta_path):
        raise FileNotFoundError(f"metadata.json missing for pack: {pack_id}")

    async with aiofiles.open(meta_path, "r", encoding="utf-8") as f:
        meta = json.loads(await f.read())

    date_str = Path(pack_directory).parent.name

    frames = [
        StoryboardFrame(
            index=fr["index"],
            filename=fr["filename"],
            url=_frame_url(date_str, pack_id, fr["filename"]),
            row=fr["row"],
            col=fr["col"],
            description=fr.get("description"),
        )
        for fr in meta.get("frames", [])
    ]

    return StoryboardPack(
        pack_id=meta["pack_id"],
        prompt=meta.get("prompt", ""),
        grid_size=meta.get("grid_size", ""),
        aspect_ratio=meta.get("aspect_ratio", "1:1"),
        frame_count=meta.get("frame_count", len(frames)),
        created_at=meta.get("created_at", ""),
        original_image_url=meta.get(
            "original_image_url",
            _frame_url(date_str, pack_id, "original.png"),
        ),
        reference_image_url=meta.get("reference_image"),
        frames=frames,
    )


async def delete_pack(pack_id: str) -> None:
    """Delete a storyboard pack directory and optionally its OSS counterpart."""
    pack_directory = _pack_dir(pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Storyboard pack not found: {pack_id}")

    date_str = Path(pack_directory).parent.name

    # Remove local directory
    shutil.rmtree(pack_directory, ignore_errors=True)
    logger.info(f"Deleted storyboard pack directory: {pack_directory}")

    # Clean up in-memory caches
    _pack_video_tasks.pop(pack_id, None)

    # Remove from OSS if enabled
    oss_client = get_oss_client()
    if oss_client:
        try:
            prefix = f"{STORYBOARD_STORAGE_DIR}/{date_str}/{pack_id}/"
            # oss2 does not provide async list — run in thread
            await asyncio.to_thread(_oss_delete_prefix, oss_client, prefix)
            logger.info(f"Deleted OSS objects for storyboard pack {pack_id}")
        except Exception as exc:
            logger.warning(f"Failed to delete OSS objects for pack {pack_id}: {exc}")


def _oss_delete_prefix(oss_client, prefix: str) -> None:
    """Delete all OSS objects under a given prefix (synchronous)."""
    try:
        import oss2
        for obj in oss2.ObjectIterator(oss_client.bucket, prefix=oss_client.cfg.key_prefix + prefix):
            oss_client.bucket.delete_object(obj.key)
    except Exception as exc:
        logger.warning(f"OSS prefix deletion error: {exc}")
