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
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

import re

import aiofiles
import httpx
from fastapi import HTTPException, status
from openai import OpenAI
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.logger import get_logger
from app.services.llm_client import LLMCallConfig, call_chat, normalize_api_type
from app.models.ark_video_models import ArkVideoGenerateRequest
from app.models.storyboard_models import (
    STORYBOARD_BATCH_SIZE,
    STORYBOARD_MAX_SCENE_COUNT,
    BatchInfo,
    GenerateScriptRequest,
    PartialGenerationError,
    ReviseScriptRequest,
    ScriptMessage,
    ScriptShot,
    StoryboardBatchVideoRequest,
    StoryboardComposeRequest,
    StoryboardCreateFromShotsRequest,
    StoryboardFrame,
    StoryboardGenerateRequest,
    StoryboardPack,
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
# Storyboard generation (chained 2x2 batches via ARK Seedream)
# ---------------------------------------------------------------------------
#
# Post-refactor pipeline:
#   1. The user picks a total scene count N (1..STORYBOARD_MAX_SCENE_COUNT).
#   2. The backend splits N into M = ceil(N/4) sequential batches of exactly
#      4 frames each (a single 2x2 ARK Seedream call per batch).
#   3. Batch 1 uses the user-provided reference image(s), if any.
#      Batches 2..M use a 2-image composite of the PREVIOUS batch's last two
#      frames (row=1, cols 0/1) as their single `image` reference — this is
#      the "chain" that holds style / character / environment continuity.
#   4. Each batch's raw grid PNG is cropped in a per-batch sub-directory
#      (`_batch_{k:02d}/`) to avoid filename collisions, then promoted to
#      globally-indexed `frame_{N:03d}.png` under the pack root.
#   5. If the overall scene count is not a multiple of 4, the last batch's
#      SHOT LIST is padded with placeholder lines so Seedream always receives
#      exactly 4 scene instructions, and the extra generated frames are
#      discarded after cropping.
#
# Failure model:
#   - Per batch we retry up to STORYBOARD_BATCH_MAX_RETRIES times with
#     exponential backoff.
#   - If batch k fails after retries and k == 1, we raise the exception as a
#     normal error (nothing useful to return).
#   - If batch k > 1 fails, we raise PartialGenerationError carrying a pack
#     containing the frames from batches 1..k-1. The router converts that to
#     HTTP 200 + `partial=true` so the user can keep the work.


STORYBOARD_BATCH_MAX_RETRIES = int(os.getenv("STORYBOARD_BATCH_MAX_RETRIES", "2"))
STORYBOARD_BATCH_RETRY_BASE_DELAY = float(
    os.getenv("STORYBOARD_BATCH_RETRY_BASE_DELAY", "2.0")
)


def _chain_prompt_prefix(locale: str) -> str:
    """Prefix prepended to batch-2+ prompts to flag that the reference image
    is a 1x2 composite of the previous batch's last two scenes, so Seedream
    treats the new 4 cells as a continuation rather than remixing the
    reference into the grid."""
    if locale == "zh":
        return (
            "参考图是上一批分镜的最后两幕拼接（左半 = 上一批第3幕，右半 = 上一批第4幕）。"
            "请将新生成的 4 幕视为上一批的后续延续，"
            "保持一致的画面风格、配色、人物造型、光线氛围与环境设定。"
        )
    return (
        "The reference image is a composite of the previous batch's last two scenes "
        "(left half = previous scene 3, right half = previous scene 4). "
        "Treat the new four cells as a direct continuation of that batch — "
        "maintain identical style, palette, character design, lighting, and environment."
    )


def _placeholder_shot(locale: str) -> str:
    """Placeholder shot description used to pad the final batch to 4 cells."""
    if locale == "zh":
        return "（占位幕，留空）"
    return "(placeholder scene, leave blank)"


def _pad_scripts_to_batch(scripts: List[str], locale: str) -> List[str]:
    """Pad the batch-local shot list to exactly STORYBOARD_BATCH_SIZE entries."""
    if len(scripts) >= STORYBOARD_BATCH_SIZE:
        return scripts[:STORYBOARD_BATCH_SIZE]
    return scripts + [_placeholder_shot(locale)] * (STORYBOARD_BATCH_SIZE - len(scripts))


def _build_batch_prompt(
    *,
    resolved_prompt: str,
    batch_scripts: List[str],
    locale: str,
    aspect_ratio: str,
    chain_prefix: Optional[str],
) -> str:
    """Construct the final Seedream prompt for a single 2x2 batch.

    ``resolved_prompt`` is the user's original prompt AFTER any batch-1-only
    mention/reference block processing has been applied (or the raw prompt for
    batch 2+). ``batch_scripts`` is expected to already be padded to length 4.
    """
    scene_prefix = "第" if locale == "zh" else "Scene "
    scene_suffix = "幕：" if locale == "zh" else ": "
    scene_lines = [
        f"{scene_prefix}{i + 1}{scene_suffix}{script}"
        for i, script in enumerate(batch_scripts)
    ]
    effective_prompt = (
        f"{resolved_prompt}\n\n"
        "SHOT LIST (render each cell in row-major order, 4 cells total):\n"
        + "\n".join(scene_lines)
    )
    if chain_prefix:
        effective_prompt = f"{chain_prefix}\n\n{effective_prompt}"
    return build_storyboard_prompt(effective_prompt, 2, 2, aspect_ratio)


async def _call_ark_seedream(
    *,
    prompt: str,
    reference_image: Optional[str],
) -> Tuple[str, Optional[str]]:
    """POST to ARK Seedream and return (remote_image_url, seedream_task_id).

    Seedream currently does not expose a cancel endpoint, so a timeout here
    only abandons the local wait — the remote task still runs to completion
    and the URL we would have received is discarded.
    """
    payload: dict = {
        "model": ARK_IMAGE_MODEL,
        "prompt": prompt,
        "size": STORYBOARD_IMAGE_SIZE,
        "n": 1,
        "response_format": "url",
        "watermark": False,
    }
    if reference_image:
        payload["image"] = reference_image

    headers = {
        "Authorization": f"Bearer {settings.ark_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(ARK_IMAGE_API, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    items = data.get("data", [])
    if not items or not items[0].get("url"):
        # Log the raw payload (truncated) so when ARK silently drops a batch
        # — e.g. content moderation filtering — we have something to grep
        # for in the logs instead of just "no image data".
        try:
            raw_preview = json.dumps(data, ensure_ascii=False)[:600]
        except Exception:
            raw_preview = repr(data)[:600]
        logger.error(
            "[storyboard] ARK Seedream returned no image data; raw payload (truncated): %s",
            raw_preview,
        )
        raise ValueError(f"ARK Seedream returned no image data: {raw_preview}")
    remote_url = items[0]["url"]
    task_id = (
        data.get("id")
        or data.get("task_id")
        or data.get("request_id")
        or items[0].get("task_id")
    )
    return remote_url, task_id


async def _download_batch_original(remote_url: str, dest_path: str) -> None:
    """Download a Seedream-generated grid PNG to a local path."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as dl:
        dl_resp = await dl.get(remote_url)
        dl_resp.raise_for_status()
        async with aiofiles.open(dest_path, "wb") as f:
            await f.write(dl_resp.content)


def _batch_subdir(pack_dir: str, batch_index: int) -> str:
    return os.path.join(pack_dir, f"_batch_{batch_index:02d}")


def _intermediate_dir(pack_dir: str) -> str:
    return os.path.join(pack_dir, "_intermediate")


def _promote_batch_frames(
    pack_dir: str,
    batch_index: int,
    global_offset: int,
) -> List[Tuple[int, str]]:
    """Move cropped cells from ``_batch_{k:02d}/frame_00X.png`` to pack-root
    ``frame_{global_offset + X:03d}.png`` and return a list of
    ``(global_index, filename)`` pairs in row-major order.

    After promotion the per-batch sub-directory is deleted so the pack root
    contains exactly the final, globally-indexed frame files (plus
    ``_intermediate/`` for debugging).
    """
    sub = _batch_subdir(pack_dir, batch_index)
    if not os.path.isdir(sub):
        return []

    local_files = sorted(
        f for f in os.listdir(sub) if f.startswith("frame_") and f.endswith(".png")
    )
    promoted: List[Tuple[int, str]] = []
    for i, local_name in enumerate(local_files[:STORYBOARD_BATCH_SIZE]):
        gidx = global_offset + i
        new_name = f"frame_{gidx + 1:03d}.png"
        src = os.path.join(sub, local_name)
        dst = os.path.join(pack_dir, new_name)
        if os.path.exists(dst):
            os.remove(dst)
        shutil.move(src, dst)
        promoted.append((gidx, new_name))

    # Clean up empty batch dir; ignore errors if other files linger.
    try:
        for leftover in os.listdir(sub):
            os.remove(os.path.join(sub, leftover))
        os.rmdir(sub)
    except OSError:
        pass
    return promoted


async def _extract_chain_refs(
    pack_dir: str,
    global_frames: List[dict],
    batch_index: int,
) -> List[str]:
    """Return absolute local paths of the last two globally-promoted frames
    from the previous batch.

    ``global_frames`` is the running list of frame dicts already promoted to
    pack-root names. ``batch_index`` is the 0-based index of the *next* batch
    we are about to generate (so the chain reference comes from
    ``batch_index - 1``). The caller guarantees ``batch_index >= 1``.
    """
    if batch_index < 1:
        raise ValueError("batch_index must be >= 1 for chain reference extraction")

    prev_batch = batch_index - 1
    prev_frames = [f for f in global_frames if f.get("batch_index") == prev_batch]
    # Row-major sort so row=1 frames land at the end.
    prev_frames.sort(key=lambda f: (f["row"], f["col"]))
    if len(prev_frames) < 2:
        raise ValueError(
            f"Cannot build chain reference: batch {prev_batch} produced "
            f"{len(prev_frames)} frames (need >= 2)"
        )

    tail = prev_frames[-2:]
    # Emit absolute paths so downstream consumers (resolve_reference_to_base64_or_url)
    # are not at the mercy of cwd / a relative STORAGE_ROOT.
    return [os.path.abspath(os.path.join(pack_dir, f["filename"])) for f in tail]


async def _generate_single_2x2_batch(
    *,
    pack_dir: str,
    batch_index: int,
    resolved_prompt: str,
    batch_scripts: List[str],
    aspect_ratio: str,
    locale: str,
    reference_image: Optional[str],
    is_chain: bool,
) -> Tuple[List[dict], Optional[str]]:
    """Run one 2x2 ARK Seedream call end-to-end and return (frame_dicts,
    seedream_task_id).

    ``frame_dicts`` is a list of up-to-4 dicts with the cropped cell's local
    filename (inside ``_batch_{k:02d}/``), row/col, and batch-local index.
    The caller is responsible for calling ``_promote_batch_frames`` to move
    them to globally-indexed locations and then assigning a global ``index``.
    """
    padded_scripts = _pad_scripts_to_batch(batch_scripts, locale)
    chain_prefix = _chain_prompt_prefix(locale) if is_chain else None
    final_prompt = _build_batch_prompt(
        resolved_prompt=resolved_prompt,
        batch_scripts=padded_scripts,
        locale=locale,
        aspect_ratio=aspect_ratio,
        chain_prefix=chain_prefix,
    )

    # Retry loop for transient ARK / download failures. Auth errors (401/403)
    # are considered permanent and propagated immediately.
    last_exc: Optional[BaseException] = None
    for attempt in range(STORYBOARD_BATCH_MAX_RETRIES + 1):
        try:
            logger.info(
                "[storyboard] batch %d start attempt=%d is_chain=%s",
                batch_index,
                attempt,
                is_chain,
            )
            remote_url, task_id = await _call_ark_seedream(
                prompt=final_prompt,
                reference_image=reference_image,
            )

            intermediate = _intermediate_dir(pack_dir)
            os.makedirs(intermediate, exist_ok=True)
            intermediate_path = os.path.join(
                intermediate, f"batch_{batch_index:02d}_original.png"
            )
            await _download_batch_original(remote_url, intermediate_path)

            sub = _batch_subdir(pack_dir, batch_index)
            os.makedirs(sub, exist_ok=True)
            frame_dicts = crop_storyboard(
                intermediate_path, 2, 2, sub, aspect_ratio
            )
            # Tag with batch index so the driver can later attribute each
            # frame back to the batch that produced it.
            for fd in frame_dicts:
                fd["batch_index"] = batch_index
            logger.info(
                "[storyboard] batch %d cropped %d cells task_id=%s",
                batch_index,
                len(frame_dicts),
                task_id,
            )
            return frame_dicts, task_id
        except httpx.HTTPStatusError as http_exc:
            status = http_exc.response.status_code
            if status in (401, 403):
                raise
            last_exc = http_exc
        except Exception as exc:
            last_exc = exc

        if attempt < STORYBOARD_BATCH_MAX_RETRIES:
            delay = STORYBOARD_BATCH_RETRY_BASE_DELAY * (2**attempt)
            logger.warning(
                "[storyboard] batch %d failed (attempt %d/%d): %s — retrying in %.1fs",
                batch_index,
                attempt + 1,
                STORYBOARD_BATCH_MAX_RETRIES + 1,
                last_exc,
                delay,
            )
            await asyncio.sleep(delay)

    # All retries exhausted.
    assert last_exc is not None  # nosec B101 - defensive
    raise last_exc


def _strip_position_blocks(prompt: str) -> str:
    """Remove multi-reference position annotations from a prompt.

    Used when building batch 2+ prompts — those batches no longer have the
    user's multi-reference composite, so the "[left area reference image]"
    placeholders and the trailing "synthesize from all reference areas"
    sentence would become nonsensical.
    """
    cleaned = prompt
    # Strip "[xxx reference image]" or "[xxx area reference image]" tokens.
    cleaned = re.sub(r"\[[^\]]*reference image\]", "", cleaned)
    # Strip "Reference image is a ... area." describing the composite.
    cleaned = re.sub(
        r"Reference image is a [^.]*\.[^\n]*\n?",
        "",
        cleaned,
    )
    cleaned = cleaned.replace(
        "Please synthesize elements from all reference areas.", ""
    )
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


async def _generate_storyboard_core(
    request: StoryboardGenerateRequest,
    *,
    db: Optional[AsyncSession] = None,
    user_id: Optional[str] = None,
) -> StoryboardPack:
    """Core driver — orchestrates M = ceil(N/4) chained 2x2 batches.

    The global concurrency limiter is applied by ``generate_storyboard``
    (module-level entry point) so tests can call this function directly with
    a mocked Seedream stub.
    """
    if not settings.ark_api_key:
        raise ValueError(
            "ARK_API_KEY is not configured. Set ARK_API_KEY in the backend .env file."
        )

    # Validator guarantees grid_size == "2x2" and 1 <= frame_count <= 16.
    rows, cols = 2, 2
    total_scene_count = request.frame_count or STORYBOARD_BATCH_SIZE
    if total_scene_count < 1 or total_scene_count > STORYBOARD_MAX_SCENE_COUNT:
        raise ValueError(
            f"frame_count must be between 1 and {STORYBOARD_MAX_SCENE_COUNT}, "
            f"got {total_scene_count}"
        )
    aspect_ratio = getattr(request, "aspect_ratio", "1:1") or "1:1"
    locale = request.locale or "zh"

    if request.frame_scripts and len(request.frame_scripts) != total_scene_count:
        raise ValueError(
            f"frame_scripts length ({len(request.frame_scripts)}) "
            f"does not match frame_count ({total_scene_count})"
        )

    # Entry-level visibility: log the resolved scene count + planned batches so
    # ops can quickly tell whether a "only got N frames" report is "user asked
    # for N" or "user asked for >N but late batches failed silently".
    planned_batches = (total_scene_count + STORYBOARD_BATCH_SIZE - 1) // STORYBOARD_BATCH_SIZE
    logger.info(
        "[storyboard] generate_storyboard_core: frame_count=%d planned_batches=%d "
        "aspect_ratio=%s locale=%s pack_id_hint=%s",
        total_scene_count,
        planned_batches,
        aspect_ratio,
        locale,
        request.pack_id or "<none>",
    )

    # ── Batch-1 prompt preparation (user references + mention tags) ──
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

    # Prompt used for batches 2..M: strip any position-reference language that
    # only made sense when the composite user-reference was attached.
    chained_prompt = _strip_position_blocks(request.prompt)

    # Allocate pack id + directory up front so partial results can still be
    # persisted if a mid-run batch fails.
    pack_id = uuid4().hex[:16]
    today_str = date.today().strftime("%Y%m%d")
    pack_directory = os.path.join(_storyboard_base_dir(), today_str, pack_id)
    os.makedirs(pack_directory, exist_ok=True)

    total_batches = (total_scene_count + STORYBOARD_BATCH_SIZE - 1) // STORYBOARD_BATCH_SIZE

    # Save user reference image (if any) next to the pack so the frontend can
    # show "yes, a reference was used" even on partial failures.
    saved_reference_url = await _persist_user_reference(
        pack_directory=pack_directory,
        today_str=today_str,
        pack_id=pack_id,
        request=request,
        normalized_reference=normalized_reference,
    )

    script_history_dump: Optional[List[dict]] = None
    if request.script_history:
        script_history_dump = [m.model_dump() for m in request.script_history]

    user_scripts: List[str] = list(request.frame_scripts or [])

    global_frames: List[dict] = []
    batches_info: List[BatchInfo] = []
    original_image_path_first_batch: Optional[str] = None

    try:
        for b in range(total_batches):
            slice_start = b * STORYBOARD_BATCH_SIZE
            slice_end = slice_start + STORYBOARD_BATCH_SIZE
            batch_scripts = user_scripts[slice_start:slice_end] if user_scripts else []

            if b == 0:
                batch_prompt = resolved_prompt
                ref = normalized_reference
                is_chain = False
            else:
                tail_paths = await _extract_chain_refs(pack_directory, global_frames, b)
                composite_ref, _ = await composite_references(tail_paths)
                batch_prompt = chained_prompt
                ref = composite_ref
                is_chain = True

            started_at = datetime.now(timezone.utc).isoformat()
            t0 = asyncio.get_event_loop().time()
            frame_dicts, task_id = await _generate_single_2x2_batch(
                pack_dir=pack_directory,
                batch_index=b,
                resolved_prompt=batch_prompt,
                batch_scripts=batch_scripts,
                aspect_ratio=aspect_ratio,
                locale=locale,
                reference_image=ref,
                is_chain=is_chain,
            )

            # Promote cropped cells from the batch subdir to global names.
            global_offset = b * STORYBOARD_BATCH_SIZE
            promoted = _promote_batch_frames(pack_directory, b, global_offset)
            if not promoted:
                raise RuntimeError(
                    f"Batch {b} produced no frames after cropping"
                )

            # Map cropped descriptor → global frame dict (row/col kept from
            # the original 2x2 crop so UIs can reason about grid position).
            for i, (gidx, filename) in enumerate(promoted):
                src = frame_dicts[i] if i < len(frame_dicts) else {"row": i // 2, "col": i % 2}
                global_frames.append(
                    {
                        "index": gidx,
                        "filename": filename,
                        "row": src.get("row", i // 2),
                        "col": src.get("col", i % 2),
                        "batch_index": b,
                    }
                )
            ended_at = datetime.now(timezone.utc).isoformat()
            duration_ms = int((asyncio.get_event_loop().time() - t0) * 1000)
            batches_info.append(
                BatchInfo(
                    index=b,
                    seedream_task_id=task_id,
                    frame_indices=[gidx for gidx, _ in promoted],
                    duration_ms=duration_ms,
                    started_at=started_at,
                    ended_at=ended_at,
                )
            )
            if b == 0:
                original_image_path_first_batch = os.path.join(
                    _intermediate_dir(pack_directory), f"batch_{b:02d}_original.png"
                )

        # Success path — all batches completed.
        pack = await _finalize_pack(
            pack_id=pack_id,
            today_str=today_str,
            pack_directory=pack_directory,
            request=request,
            aspect_ratio=aspect_ratio,
            total_scene_count=total_scene_count,
            total_batches=total_batches,
            global_frames=global_frames,
            batches_info=batches_info,
            saved_reference_url=saved_reference_url,
            script_history_dump=script_history_dump,
            original_image_path_first_batch=original_image_path_first_batch,
            partial=False,
            error=None,
            db=db,
            user_id=user_id,
        )
        logger.info(
            f"Storyboard pack created: {pack_id}, {pack.frame_count} frames, "
            f"{len(batches_info)} batches"
        )
        return pack

    except Exception as exc:
        if not batches_info:
            # Nothing to salvage — tear down partial directory and re-raise.
            shutil.rmtree(pack_directory, ignore_errors=True)
            raise

        logger.error(
            f"Storyboard generation failed at batch {len(batches_info)}/{total_batches}: {exc}",
            exc_info=True,
        )
        pack = await _finalize_pack(
            pack_id=pack_id,
            today_str=today_str,
            pack_directory=pack_directory,
            request=request,
            aspect_ratio=aspect_ratio,
            total_scene_count=total_scene_count,
            total_batches=total_batches,
            global_frames=global_frames,
            batches_info=batches_info,
            saved_reference_url=saved_reference_url,
            script_history_dump=script_history_dump,
            original_image_path_first_batch=original_image_path_first_batch,
            partial=True,
            error={
                "code": "PARTIAL_GENERATION_FAILED",
                "message": str(exc) or exc.__class__.__name__,
            },
            db=db,
            user_id=user_id,
        )
        raise PartialGenerationError(
            f"Storyboard generation failed at batch {len(batches_info) + 1}/{total_batches}",
            pack=pack,
            completed_batches=len(batches_info),
            cause=exc,
        ) from exc


async def _persist_user_reference(
    *,
    pack_directory: str,
    today_str: str,
    pack_id: str,
    request: StoryboardGenerateRequest,
    normalized_reference: Optional[str],
) -> Optional[str]:
    """Save the user-provided reference image next to the pack (if any) and
    return the URL to expose in the response."""
    request_reference_image = (
        request.reference_images[0]
        if request.reference_images and len(request.reference_images) >= 1
        else request.reference_image
    )
    if not request_reference_image:
        return None

    raw = request_reference_image
    if raw.startswith("data:") or (
        normalized_reference and normalized_reference.startswith("data:")
    ):
        try:
            source = normalized_reference or raw
            _, b64_data = source.split(",", 1)
            ref_bytes = base64.b64decode(b64_data)
            ref_path = os.path.join(pack_directory, "reference.png")
            async with aiofiles.open(ref_path, "wb") as f:
                await f.write(ref_bytes)
            return _frame_url(today_str, pack_id, "reference.png")
        except Exception as exc:
            logger.warning(f"Failed to save reference image: {exc}")
            return None
    # HTTPS URL — pass through so the response still knows a reference exists.
    return raw


async def _finalize_pack(
    *,
    pack_id: str,
    today_str: str,
    pack_directory: str,
    request: StoryboardGenerateRequest,
    aspect_ratio: str,
    total_scene_count: int,
    total_batches: int,
    global_frames: List[dict],
    batches_info: List[BatchInfo],
    saved_reference_url: Optional[str],
    script_history_dump: Optional[List[dict]],
    original_image_path_first_batch: Optional[str],
    partial: bool,
    error: Optional[Dict[str, str]],
    db: Optional[AsyncSession] = None,
    user_id: Optional[str] = None,
) -> StoryboardPack:
    """Assemble the StoryboardPack from accumulated batch state.

    For success paths this trims frames down to ``total_scene_count`` and
    deletes the discarded padding cells. For partial failures it keeps
    whatever frames exist from completed batches.
    """
    # Sort frames by global index just in case; they SHOULD already be in
    # order but future refactors may relax that.
    global_frames = sorted(global_frames, key=lambda f: f["index"])

    # Reindex to be contiguous starting at 0 — if we had to discard any
    # partial batches this keeps the contract that index == position in
    # the frames list.
    discarded_frame_count = 0
    if not partial and len(global_frames) > total_scene_count:
        extra = global_frames[total_scene_count:]
        for fr in extra:
            extra_path = os.path.join(pack_directory, fr["filename"])
            if os.path.exists(extra_path):
                try:
                    os.remove(extra_path)
                except OSError:
                    pass
        discarded_frame_count = len(extra)
        global_frames = global_frames[:total_scene_count]

    # Invariant: a "success" finalize must produce at least the user's
    # requested scene count. Anything less means a batch silently lost frames
    # — promote that into a hard failure so it can't masquerade as success.
    if not partial and len(global_frames) < total_scene_count:
        raise RuntimeError(
            f"_finalize_pack invariant violation: success path has "
            f"{len(global_frames)} frames, expected {total_scene_count} "
            f"(batches_completed={len(batches_info)}, total_batches={total_batches})"
        )

    effective_frame_count = len(global_frames)

    # Propagate any bound frame scripts.
    frame_scripts = request.frame_scripts or []
    frames: List[StoryboardFrame] = []
    for fr in global_frames:
        script_text = (
            frame_scripts[fr["index"]]
            if fr["index"] < len(frame_scripts)
            else None
        )
        if script_text:
            fr["script"] = script_text
            fr["description"] = script_text
        frames.append(
            StoryboardFrame(
                index=fr["index"],
                filename=fr["filename"],
                url=_frame_url(today_str, pack_id, fr["filename"]),
                row=fr["row"],
                col=fr["col"],
                description=script_text,
                script=script_text,
            )
        )

    # Expose the first batch's original grid as the pack's "original image"
    # so legacy UIs that display a single preview thumbnail still have one.
    original_filename = "original.png"
    if original_image_path_first_batch and os.path.isfile(
        original_image_path_first_batch
    ):
        try:
            shutil.copyfile(
                original_image_path_first_batch,
                os.path.join(pack_directory, original_filename),
            )
        except Exception as exc:
            logger.warning(f"Failed to mirror first-batch original.png: {exc}")
    original_image_url = _frame_url(today_str, pack_id, original_filename)

    now_iso = datetime.now(timezone.utc).isoformat()

    metadata = {
        "pack_id": pack_id,
        "pack_type": PACK_TYPE_STORYBOARD,
        "project_id": request.project_id,
        "user_id": user_id,
        "prompt": request.prompt,
        "grid_size": "2x2",
        "aspect_ratio": aspect_ratio,
        "frame_count": effective_frame_count,
        "total_scene_count": total_scene_count,
        "requested_frame_count": total_scene_count,
        "created_at": now_iso,
        "reference_image": saved_reference_url,
        "original_image_url": original_image_url,
        "frames": global_frames,
        "script_history": script_history_dump,
        "locale": request.locale,
        "batches": [b.model_dump() for b in batches_info],
        "partial": partial,
        "completed_batches": len(batches_info),
        "total_batches": total_batches,
        "discarded_frame_count": discarded_frame_count,
    }
    if error:
        metadata["error"] = error
    metadata_path = os.path.join(pack_directory, "metadata.json")
    async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(metadata, ensure_ascii=False, indent=2))

    # Persist the ownership row right after metadata.json is durably flushed.
    # Both `db` and a request-supplied `project_id` must be present for the
    # write — service-layer tests that bypass the router call this path
    # without a session and stay invisible to the per-project list (matches
    # legacy-pack semantics).
    if db is not None and user_id is not None and request.project_id:
        from app.services import pack_ownership_service

        try:
            await pack_ownership_service.upsert(
                db=db,
                pack_id=pack_id,
                project_id=request.project_id,
                user_id=user_id,
            )
        except Exception as exc:
            logger.warning(
                "Failed to persist storyboard pack ownership row",
                {"pack_id": pack_id, "error": str(exc)},
            )

    # OSS upload (best-effort) — skip anything under _intermediate/ or
    # _batch_*/ so private intermediates don't leak to the CDN.
    oss_client = get_oss_client()
    if oss_client:
        try:
            for filename in os.listdir(pack_directory):
                local_file = os.path.join(pack_directory, filename)
                if os.path.isdir(local_file):
                    continue
                if not filename.endswith((".png", ".json")):
                    continue
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
        project_id=request.project_id,
        prompt=request.prompt,
        grid_size="2x2",
        aspect_ratio=aspect_ratio,
        frame_count=effective_frame_count,
        created_at=now_iso,
        original_image_url=original_image_url,
        reference_image_url=saved_reference_url,
        frames=frames,
        script_history=script_history_dump,
        batches=batches_info or None,
        partial=partial or None,
        completed_batches=len(batches_info),
        total_batches=total_batches,
        discarded_frame_count=discarded_frame_count or None,
        requested_frame_count=total_scene_count,
        error=error,
    )
    return pack


# ---------------------------------------------------------------------------
# Public entry point with global concurrency limit (T11)
# ---------------------------------------------------------------------------

_GENERATE_SEMAPHORE: Optional[asyncio.Semaphore] = None
_GENERATE_SEMAPHORE_LIMIT: int = 0


def _get_generate_semaphore() -> asyncio.Semaphore:
    """Lazy-initialize the module-level generation semaphore.

    Built lazily so tests can override ``settings.storyboard.generation.max_concurrent``
    before the first call.
    """
    global _GENERATE_SEMAPHORE, _GENERATE_SEMAPHORE_LIMIT
    desired = settings.storyboard.generation.max_concurrent
    if _GENERATE_SEMAPHORE is None or _GENERATE_SEMAPHORE_LIMIT != desired:
        _GENERATE_SEMAPHORE = asyncio.Semaphore(desired)
        _GENERATE_SEMAPHORE_LIMIT = desired
    return _GENERATE_SEMAPHORE


async def generate_storyboard(
    request: StoryboardGenerateRequest,
    *,
    db: Optional[AsyncSession] = None,
    user_id: Optional[str] = None,
) -> StoryboardPack:
    """Public entry point — serializes concurrent calls with an asyncio
    semaphore so we never run more than ``storyboard.generation.max_concurrent``
    chained pipelines at once. Inside the semaphore the real work is delegated
    to :func:`_generate_storyboard_core`.

    ``db`` and ``user_id`` are forwarded to the core driver so the pack's
    ownership row is persisted as part of the success path. Service-level
    tests may omit them — the pack is still produced on disk but stays
    invisible to per-project lists.
    """
    semaphore = _get_generate_semaphore()
    waiting_since = asyncio.get_event_loop().time()
    async with semaphore:
        waited = asyncio.get_event_loop().time() - waiting_since
        if waited > 1.0:
            logger.info(
                "[storyboard] waited %.1fs for generation slot (limit=%d)",
                waited,
                _GENERATE_SEMAPHORE_LIMIT,
            )
        return await _generate_storyboard_core(request, db=db, user_id=user_id)


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


def _batches_from_meta(meta: dict) -> Optional[List[BatchInfo]]:
    """Parse the optional ``batches`` field from persisted metadata.

    Returns ``None`` for legacy packs that predate the chained-batch refactor
    so their responses do not gain misleading empty arrays.
    """
    raw = meta.get("batches")
    if not raw:
        return None
    try:
        return [BatchInfo.model_validate(b) for b in raw]
    except Exception as exc:
        logger.warning(f"Failed to parse batches metadata: {exc}")
        return None


async def list_packs(
    *,
    db: Optional[AsyncSession] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[StoryboardPack]:
    """Return storyboard packs visible to the (project_id, user_id) pair.

    When ``db``/``project_id``/``user_id`` are all provided we query the
    ``storyboard_packs`` index and load metadata for each owned pack id —
    legacy packs without a row stay hidden, which is the explicit acceptance
    bar for project isolation.

    When the parameters are omitted (service-level tests bypassing the
    router) we fall back to the historical "scan every date dir" behaviour
    so existing tests keep working without inventing a session.
    """
    if db is not None and project_id and user_id:
        return await _list_packs_for_project(
            db=db, project_id=project_id, user_id=user_id
        )

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
                        project_id=meta.get("project_id"),
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
                        batches=_batches_from_meta(meta),
                        partial=meta.get("partial") or None,
                        completed_batches=meta.get("completed_batches"),
                        total_batches=meta.get("total_batches"),
                        discarded_frame_count=meta.get("discarded_frame_count") or None,
                        requested_frame_count=meta.get("requested_frame_count")
                        or meta.get("total_scene_count"),
                        error=meta.get("error"),
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
        project_id=meta.get("project_id"),
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
        batches=_batches_from_meta(meta),
        partial=meta.get("partial") or None,
        completed_batches=meta.get("completed_batches"),
        total_batches=meta.get("total_batches"),
        discarded_frame_count=meta.get("discarded_frame_count") or None,
        requested_frame_count=meta.get("requested_frame_count")
        or meta.get("total_scene_count"),
        error=meta.get("error"),
    )


async def _load_pack_from_disk(pack_id: str) -> Optional[StoryboardPack]:
    """Construct a StoryboardPack by reading its on-disk metadata, or
    return None if the directory is missing.

    Used by ``_list_packs_for_project`` to materialise packs whose ids come
    from the ``storyboard_packs`` index — the index is the source of truth
    for visibility, and this helper is the cheap way to assemble the
    response payload without rewriting the get_pack body.
    """
    try:
        return await get_pack(pack_id)
    except FileNotFoundError:
        return None


async def _list_packs_for_project(
    *,
    db: AsyncSession,
    project_id: str,
    user_id: str,
) -> List[StoryboardPack]:
    from app.services import pack_ownership_service

    pack_ids = await pack_ownership_service.list_pack_ids_for_project(
        db=db, project_id=project_id, user_id=user_id
    )
    packs: List[StoryboardPack] = []
    for pid in pack_ids:
        pack = await _load_pack_from_disk(pid)
        if pack is not None:
            packs.append(pack)
    # Order from the index is created_at DESC; preserve it.
    return packs


async def _assert_pack_owned(
    db: AsyncSession, pack_id: str, user_id: str
) -> str:
    """Resolve the project_id bound to ``pack_id`` for ``user_id``.

    Returns the project_id on success, raises 404 when the pack has no
    owner row or is owned by another user. We mask 403 as 404 deliberately
    to avoid pack-id enumeration (matches the video_project_router style).
    """
    from app.services import pack_ownership_service

    row = await pack_ownership_service.get(db, pack_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="STORYBOARD_PACK_NOT_FOUND",
        )
    return row.project_id


async def cleanup_pack_storage(pack_ids: List[str]) -> None:
    """Best-effort filesystem + OSS cleanup for a batch of pack ids.

    Used by ``video_project_service.delete_project`` after the project-row
    delete has committed. Per-pack failures are logged but do not surface
    — disk leaks are recoverable via the orphan script in §9.3.
    """
    if not pack_ids:
        return
    oss_client = get_oss_client()
    for pid in pack_ids:
        try:
            pack_directory = _pack_dir(pid)
        except ValueError:
            logger.warning(
                "Skipping cleanup for invalid pack id",
                {"pack_id": pid},
            )
            continue
        if not pack_directory:
            continue
        date_str = Path(pack_directory).parent.name
        try:
            shutil.rmtree(pack_directory, ignore_errors=True)
            logger.info(
                "Cleanup removed pack directory after project delete",
                {"pack_id": pid, "directory": pack_directory},
            )
        except Exception as exc:
            logger.warning(
                "Failed to remove pack directory during cleanup",
                {"pack_id": pid, "error": str(exc)},
            )

        # In-memory caches keyed by pack_id
        _pack_video_tasks.pop(pid, None)

        if oss_client:
            try:
                prefix = f"{STORYBOARD_STORAGE_DIR}/{date_str}/{pid}/"
                await asyncio.to_thread(_oss_delete_prefix, oss_client, prefix)
            except Exception as exc:
                logger.warning(
                    "Failed to delete OSS objects during cleanup",
                    {"pack_id": pid, "error": str(exc)},
                )


async def delete_pack(
    pack_id: str,
    *,
    db: Optional[AsyncSession] = None,
) -> None:
    """Delete a storyboard pack directory and optionally its OSS counterpart.

    When ``db`` is supplied the matching ownership row is also dropped so
    the pack disappears from the per-project list immediately.
    """
    pack_directory = _pack_dir(pack_id)
    if not pack_directory:
        raise FileNotFoundError(f"Storyboard pack not found: {pack_id}")

    date_str = Path(pack_directory).parent.name

    # Remove local directory
    shutil.rmtree(pack_directory, ignore_errors=True)
    logger.info(f"Deleted storyboard pack directory: {pack_directory}")

    # Clean up in-memory caches
    _pack_video_tasks.pop(pack_id, None)

    # Drop the ownership row alongside the on-disk delete. Best-effort —
    # the disk delete is what the user observes; a stranded row will
    # simply produce 404s on next access.
    if db is not None:
        from app.services import pack_ownership_service

        try:
            await pack_ownership_service.delete_by_pack(db, pack_id)
        except Exception as exc:
            logger.warning(
                "Failed to delete storyboard pack ownership row",
                {"pack_id": pack_id, "error": str(exc)},
            )

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
    *,
    db: Optional[AsyncSession] = None,
    user_id: Optional[str] = None,
) -> StoryboardPack:
    """Create a storyboard pack from script-bound shots (no cropping, no Seedream).

    Each shot's generated image is downloaded/copied to the pack directory so the
    pack is self-contained. The bound script text is persisted into frame.script.

    ``db``/``user_id`` are forwarded by the router so the pack's ownership
    row is persisted; service-level tests may omit them, in which case the
    pack stays invisible to the per-project list (legacy semantics).
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
        "project_id": request.project_id,
        "user_id": user_id,
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

    if db is not None and user_id is not None and request.project_id:
        from app.services import pack_ownership_service

        try:
            await pack_ownership_service.upsert(
                db=db,
                pack_id=pack_id,
                project_id=request.project_id,
                user_id=user_id,
            )
        except Exception as exc:
            logger.warning(
                "Failed to persist storyboard pack ownership row",
                {"pack_id": pack_id, "error": str(exc)},
            )

    return StoryboardPack(
        pack_id=pack_id,
        project_id=request.project_id,
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
