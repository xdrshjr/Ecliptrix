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
from app.services.llm_client import LLMCallConfig, call_chat, normalize_api_type
from app.models.ark_video_models import ArkVideoGenerateRequest
from app.models.storyboard_models import (
    GenerateScriptRequest,
    ReviseScriptRequest,
    ScriptMessage,
    ScriptShot,
    StoryboardBatchVideoRequest,
    StoryboardComposeRequest,
    StoryboardCreateFromShotsRequest,
    StoryboardFrame,
    StoryboardGenerateRequest,
    StoryboardPack,
    compute_optimal_grid,
)
from app.services import ark_video_service, grid_pack_service
from app.services.grid_pack_service import (
    ASPECT_RATIOS as _GRID_ASPECT_RATIOS,
    GRID_CROP_PADDING as _GRID_CROP_PADDING,
    PACK_TYPE_STORYBOARD,
)
from app.services.oss_client import get_oss_client
from app.services.reference_compositor import (
    composite_references,
    position_labels,
    replace_mention_tags,
)

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ARK_IMAGE_API = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
ARK_IMAGE_MODEL = "doubao-seedream-5-0-260128"

STORYBOARD_IMAGE_SIZE = "2048x2048"
STORYBOARD_CROP_PADDING = 4  # pixels inward per edge to remove separator lines
STORYBOARD_MAX_CONCURRENT_DESCRIBE = int(
    os.getenv("STORYBOARD_MAX_CONCURRENT_DESCRIBE", "5")
)
STORYBOARD_MAX_CONCURRENT_VIDEO = int(os.getenv("STORYBOARD_MAX_CONCURRENT_VIDEO", "3"))
STORYBOARD_STORAGE_DIR = "storyboard"

ASPECT_RATIOS = {
    "1:1": (1, 1),
    "16:9": (16, 9),
    "9:16": (9, 16),
    "4:3": (4, 3),
    "3:4": (3, 4),
}

# In-memory cache: pack_id -> { frame_index -> [job_id, ...] }
# After the queue refactor, the second-level list holds storyboard_video_queue
# job_ids (one per repeat). The field name keeps the term "tasks" for legacy
# reasons. The old ark_task_id identifiers are looked up via the job state.
_pack_video_tasks: Dict[str, Dict[int, List[str]]] = {}
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
    return (
        f"/api/storage/files/{STORYBOARD_STORAGE_DIR}/{date_str}/{pack_id}/{filename}"
    )


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
    """Build the system prompt instructing Seedream to generate an NxN grid.

    Delegates to :func:`grid_pack_service.build_grid_prompt`; retained as a
    thin wrapper for backward compatibility with tests and callers.
    """
    return grid_pack_service.build_grid_prompt(
        user_prompt=user_prompt,
        rows=rows,
        cols=cols,
        aspect_ratio=aspect_ratio,
    )


# ---------------------------------------------------------------------------
# Image cropping
# ---------------------------------------------------------------------------


def _crop_cell_to_aspect_ratio(cell: Image.Image, aspect_ratio: str) -> Image.Image:
    """Back-compat shim — delegates to grid_pack_service."""
    return grid_pack_service.crop_cell_to_aspect_ratio(cell, aspect_ratio)


def crop_storyboard(
    image_path: str,
    rows: int,
    cols: int,
    output_dir: str,
    aspect_ratio: str = "1:1",
) -> List[dict]:
    """Crop a storyboard grid image into individual frame PNGs.

    Back-compat wrapper around :func:`grid_pack_service.crop_grid`.
    """
    return grid_pack_service.crop_grid(
        image_path=image_path,
        rows=rows,
        cols=cols,
        output_dir=output_dir,
        aspect_ratio=aspect_ratio,
    )


# ---------------------------------------------------------------------------
# Storyboard script generation (LLM)
# ---------------------------------------------------------------------------


_SCRIPT_MAX_CONCURRENT = int(os.getenv("STORYBOARD_SCRIPT_MAX_CONCURRENT", "3"))
_script_semaphore: Optional[asyncio.Semaphore] = None


def _get_script_semaphore() -> asyncio.Semaphore:
    global _script_semaphore
    if _script_semaphore is None:
        _script_semaphore = asyncio.Semaphore(_SCRIPT_MAX_CONCURRENT)
    return _script_semaphore


def build_storyboard_script_system_prompt(
    frame_count: int, aspect_ratio: str, locale: str
) -> str:
    """System prompt that instructs the LLM to output N scripted shots as JSON."""
    lang = "Chinese (中文)" if locale == "zh" else "English"
    example = (
        '{"shots":[{"index":0,"script":"..."},{"index":1,"script":"..."}]}'
    )
    return (
        "You are a professional screenwriter crafting a short storyboard script.\n"
        f"You must produce EXACTLY {frame_count} sequential scenes (shots) that tell a coherent story.\n"
        f"Target aspect ratio per shot: {aspect_ratio}. Output language: {lang}.\n\n"
        "REQUIREMENTS:\n"
        "1. Return ONLY valid JSON, no markdown fences, no commentary.\n"
        f"2. The JSON must have a single top-level key 'shots' with exactly {frame_count} items.\n"
        "3. Each item: {\"index\": <0-based int>, \"script\": \"<scene paragraph>\"}.\n"
        "4. Each script paragraph: 2-4 sentences, ~40-120 characters, visually concrete\n"
        "   (subject + action + setting + mood). No numbering inside the script text.\n"
        "5. Scenes must progress logically (beginning → middle → end).\n"
        "6. Indexes must be unique and cover 0.." + str(frame_count - 1) + ".\n\n"
        f"Example schema: {example}"
    )


_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def _extract_shots_from_text(text: str, frame_count: int) -> List[ScriptShot]:
    """Best-effort parse of an LLM response into ScriptShot list."""
    if not text:
        return []

    # Try fenced ```json {...} ```
    candidate_blocks: List[str] = []
    m = _JSON_BLOCK_RE.search(text)
    if m:
        candidate_blocks.append(m.group(1))
    # Try raw first/last braces
    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        candidate_blocks.append(text[first : last + 1])

    for block in candidate_blocks:
        try:
            obj = json.loads(block)
            shots_raw = obj.get("shots") if isinstance(obj, dict) else None
            if isinstance(shots_raw, list) and shots_raw:
                parsed: List[ScriptShot] = []
                for i, s in enumerate(shots_raw):
                    if not isinstance(s, dict):
                        continue
                    idx = s.get("index")
                    script_text = s.get("script") or s.get("content") or ""
                    if not isinstance(script_text, str):
                        continue
                    if not isinstance(idx, int):
                        idx = i
                    parsed.append(ScriptShot(index=idx, script=script_text.strip()))
                if parsed:
                    # Normalize indexes and trim/pad to frame_count
                    parsed.sort(key=lambda x: x.index)
                    normalized = [
                        ScriptShot(index=i, script=parsed[i].script)
                        for i in range(min(len(parsed), frame_count))
                    ]
                    return normalized
        except Exception:
            continue

    # Fallback: split by blank lines / numbered lines
    paragraphs = [
        p.strip().lstrip("0123456789.、)） :：-").strip()
        for p in re.split(r"\n\s*\n|\n(?=\s*\d+[\.:、)])", text)
        if p.strip()
    ]
    if len(paragraphs) >= frame_count:
        return [
            ScriptShot(index=i, script=paragraphs[i])
            for i in range(frame_count)
        ]
    return []


async def _call_llm_for_shots(
    messages: List[Dict[str, str]],
    frame_count: int,
    max_tokens: Optional[int] = None,
) -> tuple[List[ScriptShot], str]:
    """Call the general LLM (OpenAI- or Anthropic-compatible) and parse shots."""
    llm_config = LLMCallConfig(
        api_url=settings.llm_api_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        api_type=normalize_api_type(settings.llm_api_type),
    )

    async with _get_script_semaphore():
        raw_text = await call_chat(
            messages,
            config=llm_config,
            temperature=0.7,
            max_tokens=max_tokens,
            timeout=90.0,
        )

    logger.info(
        f"Storyboard script LLM raw response ({len(raw_text)} chars): {raw_text[:400]!r}"
    )
    shots = _extract_shots_from_text(raw_text, frame_count)
    if len(shots) != frame_count:
        logger.warning(
            f"Script parsing yielded {len(shots)} shots, expected {frame_count}"
        )
    return shots, raw_text


async def generate_storyboard_script_initial(
    request: GenerateScriptRequest,
) -> tuple[List[ScriptShot], str]:
    """First-pass script generation from prompt + frame count."""
    system_prompt = build_storyboard_script_system_prompt(
        request.frame_count, request.aspect_ratio, request.locale
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"Theme / subject: {request.prompt}\n"
                f"Return a JSON object with exactly {request.frame_count} shots."
            ),
        },
    ]
    max_tokens = request.frame_count * 200 + 500
    return await _call_llm_for_shots(messages, request.frame_count, max_tokens)


async def revise_storyboard_script(
    request: ReviseScriptRequest,
) -> tuple[List[ScriptShot], str]:
    """Revise an existing script given chat history + user instruction."""
    system_prompt = build_storyboard_script_system_prompt(
        request.frame_count, request.aspect_ratio, request.locale
    )
    current_json = json.dumps(
        {"shots": [s.model_dump() for s in request.current_draft]},
        ensure_ascii=False,
    )
    messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.append(
        {
            "role": "assistant",
            "content": f"Current draft: {current_json}",
        }
    )
    for m in request.history:
        messages.append({"role": m.role, "content": m.content})
    messages.append(
        {
            "role": "user",
            "content": (
                f"{request.user_message}\n\n"
                f"Return the ENTIRE revised shot list as JSON with exactly "
                f"{request.frame_count} shots."
            ),
        }
    )
    max_tokens = request.frame_count * 200 + 500
    return await _call_llm_for_shots(messages, request.frame_count, max_tokens)


# ---------------------------------------------------------------------------
# Storyboard generation (ARK Seedream)
# ---------------------------------------------------------------------------


async def generate_storyboard(request: StoryboardGenerateRequest) -> StoryboardPack:
    """Generate a storyboard image, crop it, and persist the pack."""

    if not settings.ark_api_key:
        raise ValueError(
            "ARK_API_KEY is not configured. Set ARK_API_KEY in the backend .env file."
        )

    # grid_size is guaranteed to be set by model_validator (from frame_count or default)
    rows, cols = _parse_grid_size(request.grid_size)
    requested_frame_count = (
        request.frame_count
    )  # may be None if grid_size was provided directly
    aspect_ratio = getattr(request, "aspect_ratio", "1:1") or "1:1"

    resolved_prompt = request.prompt
    normalized_reference: Optional[str] = None

    if request.reference_images and len(request.reference_images) > 1:
        composite_data_uri, position_desc = await composite_references(
            request.reference_images
        )
        normalized_reference = composite_data_uri
        if request.mentioned_images:
            labels = position_labels(len(request.reference_images))
            resolved_prompt = replace_mention_tags(
                resolved_prompt, request.mentioned_images, labels
            )
        if position_desc:
            if request.mentioned_images:
                resolved_prompt = f"{resolved_prompt}\n{position_desc}"
            else:
                resolved_prompt = (
                    f"{resolved_prompt}\n{position_desc} "
                    "Please synthesize elements from all reference areas."
                )
    elif request.reference_images and len(request.reference_images) == 1:
        normalized_reference = (
            await grid_pack_service.resolve_reference_to_base64_or_url(
                request.reference_images[0]
            )
        )
    elif request.reference_image:
        normalized_reference = (
            await grid_pack_service.resolve_reference_to_base64_or_url(
                request.reference_image
            )
        )

    # If caller provided a per-frame script (new two-step flow), fold the shot
    # list into the prompt so Seedream can tell frame-by-frame stories.
    effective_prompt = resolved_prompt
    if request.frame_scripts:
        expected = request.frame_count or (rows * cols)
        if len(request.frame_scripts) != expected:
            raise ValueError(
                f"frame_scripts length ({len(request.frame_scripts)}) "
                f"does not match frame_count ({expected})"
            )
        scene_prefix = "第" if request.locale == "zh" else "Scene "
        scene_suffix = "幕：" if request.locale == "zh" else ": "
        scene_lines = [
            f"{scene_prefix}{i + 1}{scene_suffix}{script}"
            for i, script in enumerate(request.frame_scripts)
        ]
        effective_prompt = (
            f"{resolved_prompt}\n\nSHOT LIST (render each cell in row-major order):\n"
            + "\n".join(scene_lines)
        )

    final_prompt = build_storyboard_prompt(effective_prompt, rows, cols, aspect_ratio)

    # Prepare ARK request payload
    payload: dict = {
        "model": ARK_IMAGE_MODEL,
        "prompt": final_prompt,
        "size": STORYBOARD_IMAGE_SIZE,
        "n": 1,
        "response_format": "url",
        "watermark": False,
    }

    if normalized_reference:
        payload["image"] = normalized_reference
        logger.info(
            f"Storyboard reference image attached (normalized, {len(normalized_reference)} chars)"
        )

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
    frame_dicts = crop_storyboard(
        original_path, rows, cols, pack_directory, aspect_ratio
    )

    # Truncate to requested frame_count (discard excess cells)
    if requested_frame_count and requested_frame_count < len(frame_dicts):
        # Remove excess frame files from disk
        for excess in frame_dicts[requested_frame_count:]:
            excess_path = os.path.join(pack_directory, excess["filename"])
            if os.path.exists(excess_path):
                os.remove(excess_path)
        frame_dicts = frame_dicts[:requested_frame_count]

    # Build frame metadata with URLs — attach bound scripts if provided.
    original_image_url = _frame_url(today_str, pack_id, "original.png")
    frame_scripts = request.frame_scripts or []
    frames: List[StoryboardFrame] = []
    for fd in frame_dicts:
        script_text = (
            frame_scripts[fd["index"]]
            if fd["index"] < len(frame_scripts)
            else None
        )
        if script_text:
            fd["script"] = script_text
            fd["description"] = script_text  # mirror for legacy consumers
        frames.append(
            StoryboardFrame(
                index=fd["index"],
                filename=fd["filename"],
                url=_frame_url(today_str, pack_id, fd["filename"]),
                row=fd["row"],
                col=fd["col"],
                description=script_text,
                script=script_text,
            )
        )

    # Save reference image alongside pack if provided. Two cases:
    #   1) base64 data URI — decode and persist locally so the frontend can
    #      display the same reference the user uploaded.
    #   2) HTTPS URL — pass the URL straight through to the response without
    #      re-downloading; the user already has it accessible.
    # In both cases the resulting URL is exposed via StoryboardPack.reference_image_url
    # so the response always reflects "yes, a reference was used".
    saved_reference_url: Optional[str] = None
    request_reference_image = (
        request.reference_images[0]
        if request.reference_images and len(request.reference_images) >= 1
        else request.reference_image
    )
    if request_reference_image:
        raw = request_reference_image
        if raw.startswith("data:") or (
            normalized_reference and normalized_reference.startswith("data:")
        ):
            try:
                source = normalized_reference or raw
                header, b64_data = source.split(",", 1)
                ref_bytes = base64.b64decode(b64_data)
                ref_path = os.path.join(pack_directory, "reference.png")
                async with aiofiles.open(ref_path, "wb") as f:
                    await f.write(ref_bytes)
                saved_reference_url = _frame_url(today_str, pack_id, "reference.png")
            except Exception as exc:
                logger.warning(f"Failed to save reference image: {exc}")
        else:
            # HTTPS URL — pass through to the response so the frontend still
            # knows a reference was attached.
            saved_reference_url = raw

    # Write metadata.json
    now_iso = datetime.now(timezone.utc).isoformat()
    script_history_dump: Optional[List[dict]] = None
    if request.script_history:
        script_history_dump = [m.model_dump() for m in request.script_history]
    metadata = {
        "pack_id": pack_id,
        "pack_type": PACK_TYPE_STORYBOARD,
        "prompt": request.prompt,
        "grid_size": request.grid_size,
        "aspect_ratio": aspect_ratio,
        "frame_count": len(frames),
        "requested_frame_count": requested_frame_count,
        "created_at": now_iso,
        "reference_image": saved_reference_url,
        "original_image_url": original_image_url,
        "frames": [fd for fd in frame_dicts],
        "script_history": script_history_dump,
        "locale": request.locale,
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
                    content_type = (
                        "image/png" if filename.endswith(".png") else "application/json"
                    )
                    await oss_client.upload_file(local_file, rel, content_type)
            logger.info(f"Storyboard pack {pack_id} uploaded to OSS")
        except Exception as oss_exc:
            logger.warning(
                f"OSS upload failed for storyboard pack {pack_id}: {oss_exc}"
            )

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
        script_history=script_history_dump,
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
        raise ValueError(
            "VL_LLM_API_KEY and VL_LLM_API_URL must be configured for frame descriptions"
        )

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
                                {
                                    "type": "image_url",
                                    "image_url": {"url": image_data_uri},
                                },
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
        logger.info(
            f"Updated metadata for pack {pack_id} with {len(desc_map)} descriptions"
        )

    return results


# ---------------------------------------------------------------------------
# Batch video generation
# ---------------------------------------------------------------------------


async def batch_generate_videos(request: StoryboardBatchVideoRequest) -> List[dict]:
    """Enqueue ARK video generation jobs for storyboard frames.

    Each (segment, repeat_index) tuple produces one independent queue job;
    the queue enforces a global concurrency cap (``storyboard.video_generation.
    max_concurrent``) and a per-job timeout. Jobs whose slot is not yet free
    are returned with status="queued" and no ``ark_task_id``.
    """
    from app.services.storyboard_video_queue import storyboard_video_queue

    pack_directory = _pack_dir(request.pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Storyboard pack not found: {request.pack_id}")

    metadata_path = os.path.join(pack_directory, "metadata.json")
    async with aiofiles.open(metadata_path, "r", encoding="utf-8") as f:
        metadata = json.loads(await f.read())

    # Build a lookup: index -> frame info
    frame_map = {fr["index"]: fr for fr in metadata.get("frames", [])}

    # Pre-read frame images once per frame_index (shared across repeats).
    frame_data_cache: Dict[int, str] = {}

    async def _frame_data_uri(frame_index: int) -> Optional[str]:
        if frame_index in frame_data_cache:
            return frame_data_cache[frame_index]
        frame_info = frame_map.get(frame_index)
        if not frame_info:
            return None
        frame_path = os.path.join(pack_directory, frame_info["filename"])
        try:
            async with aiofiles.open(frame_path, "rb") as img_file:
                img_bytes = await img_file.read()
            uri = f"data:image/png;base64,{base64.b64encode(img_bytes).decode()}"
            frame_data_cache[frame_index] = uri
            return uri
        except Exception as exc:
            logger.error(f"Failed to read frame image {frame_path}: {exc}")
            return None

    results: List[dict] = []
    # Each segment × repeat_index gets its own independent job slot.
    for seg in request.segments:
        data_uri = await _frame_data_uri(seg.frame_index)
        for ri in range(seg.repeat):
            if not frame_map.get(seg.frame_index):
                logger.warning(
                    f"Frame index {seg.frame_index} not found in pack {request.pack_id}"
                )
                results.append(
                    {
                        "frame_index": seg.frame_index,
                        "ark_task_id": None,
                        "job_id": None,
                        "repeat_index": ri,
                        "status": "failed",
                        "error": "Frame not found",
                    }
                )
                continue
            if data_uri is None:
                results.append(
                    {
                        "frame_index": seg.frame_index,
                        "ark_task_id": None,
                        "job_id": None,
                        "repeat_index": ri,
                        "status": "failed",
                        "error": "Cannot read frame image",
                    }
                )
                continue
            try:
                job_id = await storyboard_video_queue.enqueue(
                    pack_id=request.pack_id,
                    frame_index=seg.frame_index,
                    repeat_index=ri,
                    description=seg.description,
                    duration=seg.duration,
                    frame_data_uri=data_uri,
                )
                results.append(
                    {
                        "frame_index": seg.frame_index,
                        # Keep ark_task_id populated with job_id so existing
                        # frontend callers that treat ark_task_id as the polling
                        # handle continue to work. Real ARK id is exposed later
                        # once the worker submits, via the status endpoint.
                        "ark_task_id": job_id,
                        "job_id": job_id,
                        "repeat_index": ri,
                        "status": "queued",
                    }
                )
            except Exception as exc:
                logger.error(
                    f"Failed to enqueue video job for frame {seg.frame_index} repeat {ri}: {exc}",
                    exc_info=True,
                )
                results.append(
                    {
                        "frame_index": seg.frame_index,
                        "ark_task_id": None,
                        "job_id": None,
                        "repeat_index": ri,
                        "status": "failed",
                        "error": str(exc),
                    }
                )

    # Update per-pack job_id mapping.
    if len(_pack_video_tasks) >= _PACK_CACHE_MAX_SIZE:
        oldest = next(iter(_pack_video_tasks))
        del _pack_video_tasks[oldest]

    existing = _pack_video_tasks.get(request.pack_id, {})
    for r in results:
        jid = r.get("job_id")
        if not jid:
            continue
        fi = r["frame_index"]
        existing.setdefault(fi, []).append(jid)
    _pack_video_tasks[request.pack_id] = existing

    logger.info(
        f"Batch video: {len(results)} jobs enqueued for pack {request.pack_id} "
        f"(queue={sum(1 for r in results if r.get('status') == 'queued')}, "
        f"failed={sum(1 for r in results if r.get('status') == 'failed')})"
    )
    return results


async def get_batch_video_status(pack_id: str) -> List[dict]:
    """Query the current status of all video jobs associated with a pack.

    Returns one entry per (frame_index, repeat_index). Each entry carries the
    internal job_id (stable identifier returned from batch-video), and when
    available the real ARK task id, the video URL, thumbnail, and queue
    position.
    """
    from app.services.storyboard_video_queue import storyboard_video_queue

    job_map = _pack_video_tasks.get(pack_id)
    if not job_map:
        return []

    statuses: List[dict] = []
    for frame_index, job_ids in job_map.items():
        for repeat_index, job_id in enumerate(job_ids):
            job = await storyboard_video_queue.get_job(job_id)
            if job is None:
                # Entry was evicted by TTL; surface unknown state rather than failing.
                statuses.append(
                    {
                        "frame_index": frame_index,
                        "repeat_index": repeat_index,
                        "job_id": job_id,
                        "ark_task_id": None,
                        "status": "failed",
                        "video_url": None,
                        "thumbnail_url": None,
                        "error": "Job state expired",
                        "position_in_queue": None,
                    }
                )
                continue
            position = None
            if job.status == "queued":
                position = await storyboard_video_queue.position_in_queue(job_id)
            statuses.append(
                {
                    "frame_index": frame_index,
                    "repeat_index": repeat_index,
                    "job_id": job_id,
                    "ark_task_id": job.ark_task_id,
                    "status": job.status,
                    "video_url": job.video_url,
                    "thumbnail_url": job.thumbnail_url,
                    "error": job.error,
                    "position_in_queue": position,
                }
            )

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
                relative = video_url[len("/api/storage/files/") :]
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
                async with httpx.AsyncClient(
                    timeout=120.0, follow_redirects=True
                ) as dl:
                    resp = await dl.get(video_url)
                    resp.raise_for_status()
                    async with aiofiles.open(local_path, "wb") as f:
                        await f.write(resp.content)
                logger.info(f"Downloaded video {i} to {local_path}")

            if not os.path.exists(local_path):
                raise FileNotFoundError(
                    f"Video file not found: {local_path} (url={video_url})"
                )
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
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_list_path,
            "-c",
            "copy",
            output_path,
        ]
        success = await _run_ffmpeg(copy_cmd, timeout=300)

        # Fallback: re-encode if stream copy failed
        if (
            not success
            or not os.path.exists(output_path)
            or os.path.getsize(output_path) == 0
        ):
            logger.warning("Stream copy failed, falling back to re-encode")
            encode_cmd = [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                concat_list_path,
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                output_path,
            ]
            success = await _run_ffmpeg(encode_cmd, timeout=600)
            if (
                not success
                or not os.path.exists(output_path)
                or os.path.getsize(output_path) == 0
            ):
                raise RuntimeError(
                    "FFmpeg composition failed (both stream copy and re-encode)"
                )

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
            "ffmpeg",
            "-y",
            "-ss",
            "1",
            "-i",
            final_video,
            "-vframes",
            "1",
            "-q:v",
            "2",
            "-vf",
            "scale=320:-1",
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
                video_url = await oss_client.upload_file(
                    final_video, rel_video, "video/mp4"
                )
                if thumbnail_url and os.path.exists(thumb_path):
                    rel_thumb = f"{STORYBOARD_STORAGE_DIR}/{date_str}/{request.pack_id}/composed_thumb.jpg"
                    thumbnail_url = await oss_client.upload_file(
                        thumb_path, rel_thumb, "image/jpeg"
                    )
            except Exception as oss_exc:
                logger.warning(f"OSS upload failed for composed video: {oss_exc}")

        logger.info(
            f"Storyboard video composed for pack {request.pack_id}: {video_url}"
        )
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
                        shot_id=fr.get("shot_id"),
                        script=fr.get("script"),
                        visual_prompt=fr.get("visual_prompt"),
                        reference_image_url=fr.get("reference_image_url"),
                    )
                    for fr in meta.get("frames", [])
                ]

                packs.append(
                    StoryboardPack(
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
                        script_title=meta.get("script_title"),
                        script_history=meta.get("script_history"),
                    )
                )
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
            shot_id=fr.get("shot_id"),
            script=fr.get("script"),
            visual_prompt=fr.get("visual_prompt"),
            reference_image_url=fr.get("reference_image_url"),
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
        script_title=meta.get("script_title"),
        script_history=meta.get("script_history"),
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


async def _download_to_local(src_url: str, dest_path: str) -> None:
    """Download a URL to a local path. Supports data:, http(s):, /api/storage/... URLs."""
    if src_url.startswith("data:"):
        try:
            _, b64_data = src_url.split(",", 1)
            data = base64.b64decode(b64_data)
        except Exception as exc:
            raise ValueError(f"Invalid data URI: {exc}")
        async with aiofiles.open(dest_path, "wb") as f:
            await f.write(data)
        return

    if src_url.startswith("/api/storage/files/"):
        # Local file — resolve to storage root and copy.
        # Reject path traversal: the resolved absolute path must stay inside the storage root.
        rel = src_url[len("/api/storage/files/"):]
        storage_root = os.path.realpath(_storage_root())
        local = os.path.realpath(os.path.join(storage_root, rel))
        try:
            common = os.path.commonpath([storage_root, local])
        except ValueError:
            # Different drives on Windows
            raise ValueError(f"Path traversal rejected: {src_url}")
        if common != storage_root:
            raise ValueError(f"Path traversal rejected: {src_url}")
        if os.path.isfile(local):
            shutil.copyfile(local, dest_path)
            return
        raise FileNotFoundError(f"Local storage file missing: {local}")

    if src_url.startswith("http://") or src_url.startswith("https://"):
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.get(src_url)
            resp.raise_for_status()
            async with aiofiles.open(dest_path, "wb") as f:
                await f.write(resp.content)
        return

    raise ValueError(f"Unsupported image URL scheme: {src_url[:32]}")


async def create_pack_from_shots(
    request: StoryboardCreateFromShotsRequest,
) -> StoryboardPack:
    """Create a storyboard pack from script-bound shots (no cropping, no Seedream).

    Each shot's generated image is downloaded/copied to the pack directory so the
    pack is self-contained. The bound script text is persisted into frame.script.
    """
    pack_id = f"sbpk_{uuid4().hex[:12]}"
    today_str = date.today().isoformat()
    pack_directory = os.path.join(_storyboard_base_dir(), today_str, pack_id)
    os.makedirs(pack_directory, exist_ok=True)

    frames: List[StoryboardFrame] = []
    frame_dicts: List[dict] = []

    for idx, shot in enumerate(request.shots):
        filename = f"frame_{idx:03d}.png"
        dest_path = os.path.join(pack_directory, filename)
        try:
            await _download_to_local(shot.generated_image_url, dest_path)
        except Exception as exc:
            # Atomic: roll back the partially-created pack so callers can retry cleanly.
            logger.error(
                f"Failed to localize shot image for pack {pack_id} idx={idx}: {exc}"
            )
            shutil.rmtree(pack_directory, ignore_errors=True)
            raise RuntimeError(
                f"Shot {idx} image download failed: {exc}"
            ) from exc
        frame_url = _frame_url(today_str, pack_id, filename)

        frame_dict = {
            "index": idx,
            "filename": filename,
            "url": frame_url,
            "row": 0,
            "col": 0,
            "description": shot.script,  # legacy description mirrors script for old consumers
            "shot_id": shot.shot_id,
            "script": shot.script,
            "visual_prompt": shot.visual_prompt,
            "reference_image_url": shot.reference_image_url,
        }
        frame_dicts.append(frame_dict)
        frames.append(
            StoryboardFrame(
                index=idx,
                filename=filename,
                url=frame_url,
                row=0,
                col=0,
                description=shot.script,
                shot_id=shot.shot_id,
                script=shot.script,
                visual_prompt=shot.visual_prompt,
                reference_image_url=shot.reference_image_url,
            )
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    # Grid size is trivial (single column) for scripted packs
    grid_size = f"{len(frames)}x1" if len(frames) > 0 else "1x1"
    original_image_url = frames[0].url if frames else ""

    metadata = {
        "pack_id": pack_id,
        "pack_type": PACK_TYPE_STORYBOARD,
        "prompt": request.title or "",
        "grid_size": grid_size,
        "aspect_ratio": request.aspect_ratio,
        "frame_count": len(frames),
        "created_at": now_iso,
        "reference_image": None,
        "original_image_url": original_image_url,
        "script_title": request.title,
        "script_history": request.script_history,
        "frames": frame_dicts,
    }
    metadata_path = os.path.join(pack_directory, "metadata.json")
    async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(metadata, ensure_ascii=False, indent=2))

    return StoryboardPack(
        pack_id=pack_id,
        prompt=request.title or "",
        grid_size=grid_size,
        aspect_ratio=request.aspect_ratio,
        frame_count=len(frames),
        created_at=now_iso,
        original_image_url=original_image_url,
        reference_image_url=None,
        frames=frames,
        script_title=request.title,
        script_history=request.script_history,
    )


def _oss_delete_prefix(oss_client, prefix: str) -> None:
    """Delete all OSS objects under a given prefix (synchronous)."""
    try:
        import oss2

        for obj in oss2.ObjectIterator(
            oss_client.bucket, prefix=oss_client.cfg.key_prefix + prefix
        ):
            oss_client.bucket.delete_object(obj.key)
    except Exception as exc:
        logger.warning(f"OSS prefix deletion error: {exc}")
