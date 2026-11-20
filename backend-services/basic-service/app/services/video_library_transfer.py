"""Bounded transfers for file URLs obtained from the Pexels video API.

Only the video-library orchestrator calls this module. These are provider media
files, so webpage robots checks do not apply; URL, redirect, DNS, byte and media
validation still do. No provider credential is ever sent to a CDN.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
import tempfile
from urllib.parse import urljoin, urlsplit

from app.models.web_research_models import WebResearchError
from app.services.web_research.media_worker import probe_async
from app.services.web_research.safe_http_client import (
    FetchPolicy, RequestSpec, SafeHttpClient, default_proxy_settings,
)


# Current Pexels file host plus the exact host used by legacy API file links.
# Do not treat all of pexels.com/vimeo.com, or arbitrary client URLs, as trusted.
_FILE_HOSTS = frozenset({"videos.pexels.com", "player.vimeo.com"})
_REDIRECTS = frozenset({301, 302, 303, 307, 308})


class VideoTransferError(Exception):
    def __init__(self, error_code: str, status_code: int = 422,
                 message: str | None = None, *, retryable: bool = False,
                 retry_after: int | None = None):
        self.error_code = error_code
        self.status_code = status_code
        self.message = message or error_code
        self.retryable = retryable
        self.retry_after = retry_after
        super().__init__(self.message)


def _trusted_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        valid = (parts.scheme.lower() == "https"
                 and parts.hostname in _FILE_HOSTS
                 and parts.username is None and parts.password is None
                 and parts.port in (None, 443))
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise VideoTransferError(
            "video_source_forbidden", 403,
            "The file URL is not a supported public Pexels API source.")
    return parts._replace(fragment="").geturl()


def _fetch_error(error: WebResearchError) -> VideoTransferError:
    code = error.error_code
    if code == "response_too_large":
        return VideoTransferError("video_too_large", 413,
                                  "The video exceeds the download size limit.")
    if code == "upstream_timeout":
        return VideoTransferError("video_download_timeout", 504,
                                  "The video download timed out.", retryable=True)
    retryable = code in {"upstream_error", "dns_failed", "proxy_unavailable"}
    return VideoTransferError(
        code, error.status_code,
        "The video request was refused or could not be completed.",
        retryable=retryable)


def _http_error(response) -> VideoTransferError:
    status = response.status
    codes = {401: "video_authentication_failed", 403: "video_access_denied",
             404: "video_not_found", 429: "video_rate_limited"}
    retryable = status in {408, 425, 429} or status >= 500
    code = codes.get(status, "video_upstream_unavailable" if retryable
                     else "video_download_failed")
    raw_after = response.headers.get("retry-after", "")
    retry_after = (min(int(raw_after), 86400)
                   if retryable and str(raw_after).isdigit() else None)
    return VideoTransferError(
        code, status, f"The video server returned HTTP {status}.",
        retryable=retryable, retry_after=retry_after)


async def validate_video(path: Path) -> dict:
    """Return real MP4 video metadata; reject missing, empty or invalid files."""
    path = Path(path)
    try:
        if not path.is_file():
            raise VideoTransferError("video_missing", 404,
                                     "The cached video file is missing.")
        size = path.stat().st_size
        if size <= 0:
            raise VideoTransferError("video_empty", 422,
                                     "The video file is empty.")
        with path.open("rb") as handle:
            header = handle.read(12)
        if header[4:8] != b"ftyp":
            raise VideoTransferError("video_invalid", 422,
                                     "The file is not a valid MP4 video.")
        metadata = await probe_async(path)
        if metadata.get("type") != "video" or metadata.get("format") != "mp4":
            raise VideoTransferError("video_invalid", 422,
                                     "The file is not a valid MP4 video.")
        return {"size": size, "format": "mp4",
                "duration": metadata["duration"],
                "width": metadata["width"], "height": metadata["height"]}
    except (WebResearchError, OSError, TimeoutError):
        raise VideoTransferError("video_invalid", 422,
                                 "The file is not a valid MP4 video.") from None


async def _write_part(path: Path, body: bytes) -> None:
    # Cancellation must not race a still-running Windows file write and leave
    # an open .part file behind when the cleanup below executes.
    writer = asyncio.create_task(asyncio.to_thread(path.write_bytes, body))
    try:
        await asyncio.shield(writer)
    except asyncio.CancelledError:
        await writer
        raise


async def download_video(url: str, dest: Path, *, max_bytes: int,
                         timeout: float = 90) -> dict:
    """Download a trusted provider file and atomically publish validated bytes.

    A fresh SafeHttpClient keeps background-cache and ASGI event-loop locks
    separate. Every redirect retains the provider allowlist and public-target
    validation; no arbitrary URL gains a robots exemption through this API.
    """
    url = _trusted_url(url)
    if max_bytes <= 0 or timeout <= 0:
        raise VideoTransferError("video_download_limit_invalid", 422,
                                 "Video download limits must be positive.")
    settings = default_proxy_settings()
    # Provider media is public even when the general web tool has local-host
    # exceptions. Preserve proxy selection and deny rules, not those exceptions.
    settings.update(egress_mode="balanced", egress_allow_hosts=[],
                    egress_allow_ports=[])
    client = SafeHttpClient(proxy_settings=settings)
    policy = FetchPolicy(max_bytes, timeout, respect_robots=True, document=False)
    part = None
    dest = Path(dest)
    try:
        async with asyncio.timeout(timeout):
            for hop in range(6):
                response = await client.fetch_one_hop(policy, RequestSpec(url))
                if response.status not in _REDIRECTS:
                    break
                location = response.headers.get("location")
                if hop == 5 or not location:
                    raise VideoTransferError("video_redirect_invalid", 502,
                                             "The video redirect could not be followed.")
                url = _trusted_url(urljoin(url, location))
            if response.status != 200:
                raise _http_error(response)
            body = response.body
            expected = response.headers.get("content-length", "")
            if len(body) > max_bytes or (str(expected).isdigit()
                                         and int(expected) > max_bytes):
                raise VideoTransferError("video_too_large", 413,
                                         "The video exceeds the download size limit.")
            if not body:
                raise VideoTransferError("video_empty", 422,
                                         "The video file is empty.")
            if (str(expected).isdigit()
                    and response.headers.get("content-encoding", "identity") == "identity"
                    and len(body) != int(expected)):
                raise VideoTransferError("video_truncated", 502,
                                         "The video download was incomplete.", retryable=True)
            dest.parent.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(prefix=dest.name + ".", suffix=".part",
                                        dir=dest.parent)
            os.close(fd)
            part = Path(name)
            await _write_part(part, body)
            metadata = await validate_video(part)
            os.replace(part, dest)
            return metadata
    except WebResearchError as error:
        raise _fetch_error(error) from None
    except TimeoutError:
        raise VideoTransferError("video_download_timeout", 504,
                                 "The video download timed out.", retryable=True) from None
    except OSError:
        raise VideoTransferError("video_cache_write_failed", 507,
                                 "The video could not be written to the local cache.") from None
    finally:
        if part is not None:
            part.unlink(missing_ok=True)
