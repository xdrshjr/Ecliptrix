"""付费提交前规范化角色、能力与图片；错误不包含用户内容。"""
from __future__ import annotations

import asyncio
import base64
import binascii
import ipaddress
import json
import re
import warnings
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlsplit

from PIL import Image

from app.config import settings
from app.models.ark_video_models import ArkVideoGenerateRequest
from app.services.ark_video_config import VideoRuntimeConfig
from app.services.credential_errors import VideoError

MAX_IMAGE_BYTES = 30_000_000
MAX_PAYLOAD_BYTES = 64_000_000
_MIMES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
_EXTENSIONS = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def _unsupported(field: str, config: VideoRuntimeConfig | None = None, allowed=None) -> VideoError:
    details = {"field": field}
    if config:
        details["model"] = config.model_id
    if allowed is not None:
        details["allowed"] = allowed
    return VideoError("video_parameters_unsupported", **details)


def normalize_images(request: ArkVideoGenerateRequest) -> list[tuple[str, str]]:
    """保留首尾角色，即使两者使用同一个地址。"""
    raw = [request.image_url or "", *(request.image_urls or [])]
    if len([url for url in raw if url.strip()]) > 8:
        raise _unsupported("image_urls")
    images = list(dict.fromkeys(url.strip() for url in raw if url.strip()))
    first, last = request.first_frame_url or "", request.last_frame_url or ""
    if request.mode == "keyframe":
        if not first or any(url not in (first, last) for url in images):
            raise _unsupported("first_frame_url" if not first else "image_urls")
        return [(first, "first_frame")] + ([(last, "last_frame")] if last else [])
    if first or last:
        raise _unsupported("first_frame_url" if first else "last_frame_url")
    if request.mode == "reference":
        if not 1 <= len(images) <= 4:
            raise _unsupported("image_urls", allowed=[1, 4])
        return [(url, "reference_image") for url in images]
    if len(images) > 2:
        raise _unsupported("image_urls", allowed=[0, 2])
    return list(zip(images, ("first_frame", "last_frame")))


def validate_parameters(request: ArkVideoGenerateRequest, config: VideoRuntimeConfig) -> list[tuple[str, str]]:
    profile = config.profile
    images = normalize_images(request)
    mode = request.mode if request.mode != "description" or not images else "keyframe"
    for field, value, allowed in (
        ("mode", mode, profile.modes), ("resolution", request.resolution, profile.resolutions),
    ):
        if value not in allowed:
            raise _unsupported(field, config, list(allowed))
    if not profile.duration_min <= request.duration <= profile.duration_max:
        raise _unsupported("duration", config, [profile.duration_min, profile.duration_max])
    if any(role == "last_frame" for _, role in images) and not profile.supports_last_frame:
        raise _unsupported("last_frame_url", config)
    if mode == "reference" and len(images) > profile.max_reference_images:
        raise _unsupported("image_urls", config, [1, profile.max_reference_images])
    if request.camera_fixed and not profile.supports_camera_fixed:
        raise _unsupported("camera_fixed", config, [False])
    return images


def validate_remote_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
            raise ValueError
        if parts.port is not None and not 1 <= parts.port <= 65535:
            raise ValueError
        if any(c.isspace() or ord(c) < 32 for c in url) or "\\" in url:
            raise ValueError
        host = parts.hostname.rstrip(".").lower()
        if host == "localhost" or host.endswith(".localhost"):
            raise ValueError
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            if re.fullmatch(r"[0-9.]+", host) or host.startswith("0x"):
                raise ValueError from None
        else:
            if not address.is_global:
                raise ValueError
    except (ValueError, TypeError):
        raise _unsupported("image_urls") from None
    return url


def _image_data(data: bytes, mime: str) -> str:
    if not data or len(data) >= MAX_IMAGE_BYTES:
        raise _unsupported("image_urls")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                width, height = image.size
                if _MIMES.get(image.format) != mime:
                    raise ValueError
                if not (300 <= width <= 6000 and 300 <= height <= 6000 and 0.4 <= width / height <= 2.5):
                    raise ValueError
                if width * height > 36_000_000:
                    raise ValueError
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _unsupported("image_urls") from None
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def _resolve_local_image(url: str) -> str:
    if url.startswith("data:"):
        match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)", url)
        if not match or len(match[2]) > 4 * ((MAX_IMAGE_BYTES + 1) // 3):
            raise _unsupported("image_urls")
        try:
            data = base64.b64decode(match[2], validate=True)
        except (ValueError, binascii.Error):
            raise _unsupported("image_urls") from None
        return _image_data(data, match[1])
    prefix = "/api/storage/files/"
    if not url.startswith(prefix):
        raise _unsupported("image_urls")
    relative = unquote(url[len(prefix):])
    if any(char in relative for char in ("\\", "\x00", ":", "?", "#")) or "%" in relative:
        raise _unsupported("image_urls")
    if any(part in ("..", ".", "") for part in relative.split("/")):
        raise _unsupported("image_urls")
    try:
        root = Path(settings.storage.root).resolve()
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size >= MAX_IMAGE_BYTES:
            raise ValueError
        mime = _EXTENSIONS.get(path.suffix.lower())
        if mime is None:
            raise ValueError
        return _image_data(path.read_bytes(), mime)
    except (OSError, ValueError):
        raise _unsupported("image_urls") from None


async def resolve_image_url(url: str) -> str:
    if url.startswith(("http://", "https://")):
        return validate_remote_url(url)
    return await asyncio.to_thread(_resolve_local_image, url)


async def build_payload(request: ArkVideoGenerateRequest, config: VideoRuntimeConfig) -> dict:
    images = validate_parameters(request, config)
    content = [{"type": "text", "text": request.prompt}]
    size = len(request.prompt.encode("utf-8"))
    for url, role in images:
        resolved = await resolve_image_url(url)
        size += len(resolved.encode("utf-8"))
        if size > MAX_PAYLOAD_BYTES:
            raise _unsupported("image_urls")
        content.append({"type": "image_url", "image_url": {"url": resolved}, "role": role})
    payload = {
        "model": config.model_id, "content": content, "duration": request.duration,
        "ratio": "adaptive" if images and request.mode != "reference" else request.aspect_ratio,
        "resolution": request.resolution, "watermark": request.watermark,
    }
    if config.profile.profile.startswith("seedance_2"):
        payload["generate_audio"] = False
    if request.camera_fixed:
        payload["camera_fixed"] = True
    if len(encode_payload(payload)) > MAX_PAYLOAD_BYTES:
        raise _unsupported("image_urls")
    return payload


def encode_payload(payload: dict) -> bytes:
    """计量和发送使用同一 JSON 编码，不遗漏 base64 膨胀。"""
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
