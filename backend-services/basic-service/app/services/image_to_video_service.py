"""Image -> video conversion (static / Ken Burns / pan) on local FFmpeg.

Design points (docs/plans/agent-still-to-clip/spec.md §6.2):

* The source may be base64, a storage key, a same-origin path or a remote URL;
  every path is validated before any byte is read.
* Nothing blocks the event loop: disk and PIL work run in threads, FFmpeg is an
  ``asyncio`` subprocess with a timeout, and cancellation kills it.
* Output is content-addressed (``sha1(image bytes + canonical params)``) so a
  repeated call - SSE replay, model retry, user retry - returns the same file
  without re-rendering.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import quote

import httpx
from PIL import Image, ImageOps

from app.logger import get_logger
from app.models import (
    ImageToVideoErrorResponse,
    ImageToVideoRequest,
    ImageToVideoResponse,
)
from app.models.agent_vision_models import AgentVisionError
from app.security.url_guard import URLGuardError, validate_external_url
from app.services import image_to_video_filters as filters
from app.services.agent_vision.image_source import validate_storage_key
from app.services.local_media_resolver import (
    LocalMediaResolveError,
    ResolvedMediaPath,
    resolve_media_reference,
)
from app.services.storage_service import storage_service

logger = get_logger(__name__)

MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 64_000_000
DOWNLOAD_TIMEOUT_SECONDS = 30.0
MAX_REDIRECTS = 3
GENERATED_DIR = "video/generated"
STORAGE_URL_PREFIX = "/api/storage/files/"

_ffmpeg_path_cache: Optional[str] = None


class ImageToVideoFailure(Exception):
    """A conversion failure that maps to one stable ``error_code``."""

    def __init__(self, error_code: str, message: str,
                 details: Optional[str] = None) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.details = details


def find_ffmpeg() -> str:
    """Return the FFmpeg executable path or raise ``FFMPEG_UNAVAILABLE``.

    Only a positive lookup is cached, so installing FFmpeg while the app runs
    takes effect on the next call instead of needing a restart.
    """
    global _ffmpeg_path_cache
    if _ffmpeg_path_cache:
        return _ffmpeg_path_cache
    found = shutil.which("ffmpeg")
    if not found:
        raise ImageToVideoFailure(
            "FFMPEG_UNAVAILABLE",
            "FFmpeg was not found on this machine",
            "Install FFmpeg and make sure it is on PATH.",
        )
    _ffmpeg_path_cache = found
    return found


# ── source acquisition ──────────────────────────────────────────────────────


def _decode_base64_image(image_data: str) -> bytes:
    payload = image_data.split(",", 1)[1] if image_data.startswith("data:") \
        else image_data
    try:
        return base64.b64decode(payload, validate=False)
    except (ValueError, base64.binascii.Error) as exc:
        raise ImageToVideoFailure(
            "IMAGE_UNREADABLE", "image_data is not valid base64") from exc


def _read_local_file(path: Path) -> bytes:
    try:
        if path.stat().st_size > MAX_IMAGE_BYTES:
            raise ImageToVideoFailure(
                "IMAGE_TOO_LARGE",
                f"Image exceeds the {MAX_IMAGE_BYTES // (1024 * 1024)} MB limit")
        return path.read_bytes()
    except OSError as exc:
        raise ImageToVideoFailure(
            "IMAGE_NOT_FOUND", f"Cannot read image file: {exc}") from exc


def _resolve_storage_key(storage_key: str) -> Path:
    """Anchor a storage-root-relative key via the route branch (spec RV-02).

    ``resolve_media_reference`` anchors bare relative strings at the service
    directory, not the storage root, so the key is rewritten into the
    ``/api/storage/files/`` route form, whose branch is rooted correctly and
    containment-checked.
    """
    try:
        key = validate_storage_key(storage_key)
    except AgentVisionError as exc:
        raise ImageToVideoFailure("INVALID_ARGUMENT", exc.message) from exc
    return _resolve_reference(STORAGE_URL_PREFIX + quote(key, safe="/")).path


def _resolve_reference(reference: str) -> ResolvedMediaPath:
    """Map a reference to a validated local file or an SSRF-checked URL."""
    try:
        return resolve_media_reference(reference, allow_remote=True)
    except LocalMediaResolveError as exc:
        raise ImageToVideoFailure(
            "IMAGE_NOT_FOUND", "Image could not be resolved",
            str(exc)) from exc


async def _download_remote(url: str) -> bytes:
    """Download with a size cap, an ``image/`` check and per-hop SSRF checks."""
    current = url
    async with httpx.AsyncClient(
        timeout=DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=False
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                await asyncio.to_thread(validate_external_url, current)
            except URLGuardError as exc:
                raise ImageToVideoFailure(
                    "IMAGE_NOT_FOUND", "Remote image URL is not allowed",
                    str(exc)) from exc
            async with client.stream("GET", current) as response:
                if response.is_redirect:
                    current = str(response.next_request.url) \
                        if response.next_request else current
                    continue
                return await _read_image_stream(response)
    raise ImageToVideoFailure(
        "IMAGE_NOT_FOUND", "Too many redirects while downloading the image")


async def _read_image_stream(response: httpx.Response) -> bytes:
    if response.status_code != 200:
        raise ImageToVideoFailure(
            "IMAGE_NOT_FOUND",
            f"Remote image request failed with HTTP {response.status_code}")
    content_type = response.headers.get("content-type", "").lower()
    if not content_type.startswith("image/"):
        raise ImageToVideoFailure(
            "IMAGE_UNREADABLE",
            f"Remote resource is not an image (content-type: {content_type})")
    declared = int(response.headers.get("content-length") or 0)
    if declared > MAX_IMAGE_BYTES:
        raise ImageToVideoFailure("IMAGE_TOO_LARGE", "Image is too large")
    chunks, total = [], 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            raise ImageToVideoFailure("IMAGE_TOO_LARGE", "Image is too large")
        chunks.append(chunk)
    return b"".join(chunks)


async def load_image_bytes(request: ImageToVideoRequest) -> bytes:
    """Fetch the source bytes: ``image_data`` > ``storage_key`` > ``image_url``."""
    if request.image_data:
        data = _decode_base64_image(request.image_data)
    elif request.storage_key:
        path = await asyncio.to_thread(_resolve_storage_key, request.storage_key)
        data = await asyncio.to_thread(_read_local_file, path)
    elif request.image_url:
        resolved = await asyncio.to_thread(
            _resolve_reference, request.image_url)
        if resolved.source_kind == "legacy_remote":
            data = await _download_remote(resolved.public_url)
        else:
            data = await asyncio.to_thread(_read_local_file, resolved.path)
    else:
        raise ImageToVideoFailure(
            "MISSING_IMAGE_SOURCE",
            "One of image_data, storage_key or image_url is required")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageToVideoFailure("IMAGE_TOO_LARGE", "Image is too large")
    return data


# ── decoding ────────────────────────────────────────────────────────────────


def normalize_image(image_bytes: bytes, target: Path) -> Tuple[int, int]:
    """Decode, apply EXIF rotation, flatten alpha and write ``target`` (PNG).

    Returns the normalized ``(width, height)``. ``Image.open`` is lazy, so the
    pixel cap is checked before any decoding; the process-wide
    ``Image.MAX_IMAGE_PIXELS`` is deliberately left alone.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
            if width * height > MAX_IMAGE_PIXELS:
                raise ImageToVideoFailure(
                    "IMAGE_TOO_LARGE",
                    f"Image is {width}x{height}; the limit is "
                    f"{MAX_IMAGE_PIXELS // 1_000_000} megapixels")
            image.seek(0)
            upright = ImageOps.exif_transpose(image)
            flat = _flatten_alpha(upright)
            flat.save(target, format="PNG", compress_level=1)
            return flat.size
    except ImageToVideoFailure:
        raise
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageToVideoFailure(
            "IMAGE_UNREADABLE", "Image could not be decoded", str(exc)) from exc


def _flatten_alpha(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    ):
        rgba = image.convert("RGBA")
        backdrop = Image.new("RGB", rgba.size, (0, 0, 0))
        backdrop.paste(rgba, mask=rgba.getchannel("A"))
        return backdrop
    return image.convert("RGB")


# ── rendering ───────────────────────────────────────────────────────────────


def _content_key(image_bytes: bytes, params: dict) -> str:
    digest = hashlib.sha1(image_bytes)
    digest.update(json.dumps(params, sort_keys=True,
                             separators=(",", ":")).encode("utf-8"))
    return digest.hexdigest()[:16]


async def _run_ffmpeg(args: list, timeout: float) -> str:
    """Run FFmpeg; kill it on timeout or cancellation. Returns stderr."""
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE)
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except asyncio.TimeoutError as exc:
        await _kill(process)
        raise ImageToVideoFailure(
            "QUEUE_TIMEOUT", f"FFmpeg did not finish within {int(timeout)}s",
        ) from exc
    except asyncio.CancelledError:
        await _kill(process)
        raise
    text = stderr.decode("utf-8", errors="ignore")
    if process.returncode != 0:
        raise ImageToVideoFailure(
            "FFMPEG_ERROR", "Video generation failed", text[-2000:])
    return text


async def _kill(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        process.kill()
    await process.wait()


def _plan_render(
    request: ImageToVideoRequest, source_size: Tuple[int, int]
) -> Tuple[str, Optional[str], Tuple[int, int], Tuple[float, float], str]:
    """Resolve effect, direction, frame size, focus and fit mode."""
    effect = request.effect.value
    direction = None
    if effect == filters.EFFECT_KEN_BURNS:
        direction = request.ken_burns_direction or filters.KB_ZOOM_IN
    elif effect == filters.EFFECT_PAN:
        direction = request.pan_direction or filters.PAN_LEFT_TO_RIGHT
    size = filters.output_size(
        *source_size, request.aspect_ratio, request.max_long_side)
    uses_focus = effect != filters.EFFECT_STATIC
    focus = (request.focus_x if request.focus_x is not None else 0.5,
             request.focus_y if request.focus_y is not None else 0.5) \
        if uses_focus else (0.5, 0.5)
    fit = "contain"
    if effect == filters.EFFECT_STATIC and not filters.ratios_match(
            *source_size, *size):
        fit = "blur"
    return effect, direction, size, focus, fit


def _storage_target(key: str, suffix: str) -> Path:
    root = Path(storage_service.root).resolve()
    return root / GENERATED_DIR / f"i2v_{key}{suffix}"


def _storage_url(key: str, suffix: str) -> str:
    return f"{STORAGE_URL_PREFIX}{GENERATED_DIR}/i2v_{key}{suffix}"


def _part_suffix() -> str:
    """Unique per call: two identical conversions in flight must not share a file."""
    return f"{os.getpid()}.{uuid.uuid4().hex[:8]}.part"


async def _render_video(final_path: Path, render) -> None:
    """Render to a temp name beside ``final_path`` and publish atomically."""
    final_path.parent.mkdir(parents=True, exist_ok=True)
    partial = final_path.with_name(f".{final_path.stem}.{_part_suffix()}.mp4")
    try:
        await render(partial)
        if not partial.exists() or partial.stat().st_size == 0:
            raise ImageToVideoFailure(
                "FILE_NOT_CREATED", "Output video file was not created")
        os.replace(partial, final_path)
    finally:
        partial.unlink(missing_ok=True)


async def _write_thumbnail(
    ffmpeg: str, video_path: Path, thumb_path: Path, duration: float
) -> bool:
    """Best-effort poster frame; a failure only costs the thumbnail."""
    partial = thumb_path.with_name(f".{thumb_path.stem}.{_part_suffix()}.jpg")
    args = filters.build_thumbnail_args(
        ffmpeg, str(video_path), str(partial), min(1.0, duration / 2))
    try:
        await _run_ffmpeg(args, 30)
        os.replace(partial, thumb_path)
        return True
    except (ImageToVideoFailure, OSError) as exc:
        logger.warning("Image-to-video thumbnail failed: %s", exc)
        return False
    finally:
        partial.unlink(missing_ok=True)


class ImageToVideoService:
    """Converts one image into one cached MP4 clip."""

    async def convert_image_to_video(
        self, request: ImageToVideoRequest
    ) -> ImageToVideoResponse | ImageToVideoErrorResponse:
        started = time.time()
        try:
            return await self._convert(request, started)
        except ImageToVideoFailure as failure:
            logger.error("Image-to-video failed: %s %s",
                         failure.error_code, failure.message)
            return ImageToVideoErrorResponse(
                success=False, message=failure.message,
                error_code=failure.error_code, details=failure.details)

    async def _convert(
        self, request: ImageToVideoRequest, started: float
    ) -> ImageToVideoResponse:
        ffmpeg = find_ffmpeg()
        image_bytes = await load_image_bytes(request)
        workdir = Path(tempfile.mkdtemp(prefix="i2v_"))
        try:
            normalized = workdir / "source.png"
            source_size = await asyncio.to_thread(
                normalize_image, image_bytes, normalized)
            return await self._render_or_reuse(
                request, ffmpeg, image_bytes, normalized, source_size, started)
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    async def _render_or_reuse(
        self, request: ImageToVideoRequest, ffmpeg: str, image_bytes: bytes,
        normalized: Path, source_size: Tuple[int, int], started: float,
    ) -> ImageToVideoResponse:
        effect, direction, size, focus, fit = _plan_render(request, source_size)
        key = _content_key(image_bytes, filters.canonical_params(
            effect, direction, request.duration, focus, size, fit))
        video_path = _storage_target(key, ".mp4")
        thumb_path = _storage_target(key, "_thumb.jpg")
        reused = video_path.exists() and video_path.stat().st_size > 0
        if not reused:
            video_filter = filters.build_video_filter(
                effect, source_size, size, request.duration, direction, focus)

            async def render(partial: Path) -> None:
                args = filters.build_ffmpeg_args(
                    ffmpeg, str(normalized), str(partial), effect,
                    video_filter, request.duration)
                await _run_ffmpeg(args, max(60.0, request.duration * 12))

            await _render_video(video_path, render)
        if not thumb_path.exists():
            await _write_thumbnail(
                ffmpeg, video_path, thumb_path, request.duration)
        return self._build_response(
            key, video_path, thumb_path, request, effect, size, reused,
            time.time() - started)

    @staticmethod
    def _build_response(
        key: str, video_path: Path, thumb_path: Path,
        request: ImageToVideoRequest, effect: str, size: Tuple[int, int],
        reused: bool, elapsed: float,
    ) -> ImageToVideoResponse:
        return ImageToVideoResponse(
            success=True,
            message="Image converted to video successfully",
            video_url=_storage_url(key, ".mp4"),
            storage_key=f"{GENERATED_DIR}/i2v_{key}.mp4",
            thumbnail_url=_storage_url(key, "_thumb.jpg")
            if thumb_path.exists() else None,
            file_size=video_path.stat().st_size,
            duration=request.duration,
            width=size[0],
            height=size[1],
            effect_applied=effect,
            processing_time=elapsed,
            reused=reused,
        )
