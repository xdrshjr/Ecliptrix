"""URL classification + standalone image download helpers (spec 05 §2.5).

Extracted verbatim (behaviour-preserving) from VideoCompositionService. These
are self-contained helpers with no dependency on instance state: two pure URL
predicates and an image fetch used by the overlay path. The video download /
retry orchestration stays in the service because it is bound to instance
collaborators (youtube_service, ffmpeg path) and is exercised via instance-method
patching in the test suite.
"""

from __future__ import annotations

import os
from typing import Any, Dict
from urllib.parse import unquote, urlparse

from app.logger import get_logger

logger = get_logger(__name__)

# Image extensions FFmpeg/overlay accepts; anything else falls back to .jpg.
_ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp"}


def is_youtube_url(url: str) -> bool:
    """Return True when the URL points at YouTube (youtube.com / youtu.be)."""
    return "youtube.com" in url or "youtu.be" in url


def is_pexels_url(url: str) -> bool:
    """Return True when the URL is a Pexels video URL (case-insensitive)."""
    return "pexels.com" in url.lower()


def _image_extension_from_url(image_url: str) -> str:
    """Pick a supported image extension from the URL, defaulting to .jpg."""
    path = unquote(urlparse(image_url).path)
    file_ext = os.path.splitext(path)[1].lower()
    if not file_ext or file_ext not in _ALLOWED_IMAGE_EXTENSIONS:
        return ".jpg"  # Default to jpg
    return file_ext


def download_image(image_url: str, temp_dir: str, index: int) -> Dict[str, Any]:
    """Download an image file from a URL into ``temp_dir``.

    Args:
        image_url: URL of the image to download.
        temp_dir: Directory to save the image into.
        index: Index used to name the downloaded file.

    Returns:
        Dict with ``success`` plus ``output_path``/``file_size`` on success or
        ``error`` on failure.
    """
    try:
        import requests

        output_filename = f"image_{index}{_image_extension_from_url(image_url)}"
        output_path = os.path.join(temp_dir, output_filename)

        logger.info(f"Downloading image from {image_url} to {output_path}")

        # Download the image
        response = requests.get(image_url, stream=True, timeout=30)
        response.raise_for_status()

        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        file_size = os.path.getsize(output_path)
        logger.info(f"Image downloaded successfully: {file_size} bytes")

        return {
            "success": True,
            "output_path": output_path,
            "file_size": file_size,
        }

    except Exception as e:
        logger.error(f"Failed to download image {image_url}: {str(e)}")
        return {
            "success": False,
            "error": str(e),
        }
