"""Image / video / audio catalogue search through the SkillRouter gateway (spec §4.6).

The three search services keep their public signatures and response models; in
router mode their entry points delegate here. The adapter is synchronous (the
services are) and follows ``nextCursor`` up to ``MAX_PAGES`` pages because every
page costs one quota unit.

Fields the gateway does not provide are left at the model's neutral value
(``None`` / empty); nothing is invented. A failure raises ``RouterError`` -
returning an empty result would be rendered as "no results" and hide the
outage. Only a failure AFTER the first page keeps the pages already fetched.
Result ``source`` stays unsplash / pexels / freesound (cache-key compatible)
and downloads still go straight to the upstream CDN, not through the gateway.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from app.logger import get_logger
from app.models.audio_search_models import AudioInfo, AudioSearchResponse
from app.models.image_search_models import ImageInfo, ImageSearchResponse
from app.models.video_models import VideoInfo, VideoSearchResponse
from app.services.skillrouter.client import SyncRouterClient
from app.services.skillrouter.config import require_ready
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.sync_support import blocking_limits

logger = get_logger(__name__)

MAX_PAGES = 4
DEFAULT_PER_PAGE_MAX = 30
_AUDIO_SORT_ALIASES = {"downloads": "downloads_desc", "rating": "rating_desc"}


@dataclass(frozen=True)
class AudioSearchOptions:
    """Filters of ``AudioSearchService.search_audios`` beyond query and count."""

    duration_min: Optional[float] = None
    duration_max: Optional[float] = None
    audio_type: str = "all"
    sort_by: str = "score"


@dataclass
class _Pages:
    items: List[Dict[str, Any]] = field(default_factory=list)
    total: int = 0
    attribution: str = ""


# --------------------------------------------------------------------- paging


def _per_page(limits: Dict[str, Any], wanted: int) -> int:
    page = limits.get("perPage")
    ceiling = page.get("max") if isinstance(page, dict) else None
    ceiling = ceiling if isinstance(ceiling, int) and ceiling >= 1 else DEFAULT_PER_PAGE_MAX
    return max(1, min(wanted, ceiling))


def _attribution_text(data: Dict[str, Any]) -> str:
    attribution = data.get("attribution")
    text = attribution.get("text") if isinstance(attribution, dict) else None
    return text if isinstance(text, str) else ""


def _fetch_pages(path: str, capability: str, body: Dict[str, Any], wanted: int) -> _Pages:
    """Collect up to ``wanted`` items across at most ``MAX_PAGES`` gateway pages."""
    snapshot = require_ready()
    limits = blocking_limits(capability)
    if not limits:
        raise RouterError("capability_unavailable", 503,
                          f"SkillRouter did not list the {capability} capability.")
    client = SyncRouterClient(snapshot)
    base = {**body, "perPage": _per_page(limits, wanted)}
    pages, cursor = _Pages(), None
    for number in range(MAX_PAGES):
        request = {**base, **({"cursor": cursor} if cursor else {})}
        try:
            data = client.post(path, request, idempotent=True)
        except RouterError as error:
            if number == 0:
                raise
            logger.warning("skillrouter %s page %d failed: %s", capability, number + 1, error.code)
            break
        _merge_page(pages, data)
        cursor = data.get("nextCursor") if isinstance(data, dict) else None
        if len(pages.items) >= wanted or not data.get("hasMore") or not cursor:
            break
    pages.items = pages.items[:wanted]
    return pages


def _merge_page(pages: _Pages, data: Any) -> None:
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise RouterError("router_bad_response", 502, "Search response has no items list.")
    pages.items.extend(item for item in items if isinstance(item, dict))
    if not pages.total:
        total = data.get("total")
        pages.total = total if isinstance(total, int) else 0
    pages.attribution = pages.attribution or _attribution_text(data)


def _supported(value: str, allowed: Any) -> bool:
    """A value is usable when the gateway lists no restriction or lists it."""
    return not isinstance(allowed, list) or not allowed or value in allowed


def _drop_unsupported(name: str, value: str) -> None:
    logger.info("skillrouter search ignores unsupported %s=%s", name, value)


# --------------------------------------------------------------------- mapping


def _author(item: Dict[str, Any]) -> Tuple[str, str]:
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    return str(author.get("name") or "Unknown"), str(author.get("url") or "")


def _handle_from(url: str, fallback: str) -> str:
    """``https://unsplash.com/@jane`` -> ``jane``; otherwise the display name."""
    tail = urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]
    return tail.lstrip("@") if tail.startswith("@") else fallback


def _int_id(item: Dict[str, Any]) -> Optional[int]:
    raw = str(item.get("id", ""))
    return int(raw) if raw.isdigit() else None


def _number(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


def _image_info(item: Dict[str, Any]) -> ImageInfo:
    name, profile = _author(item)
    thumb = str(item.get("thumbUrl") or "")
    preview = str(item.get("previewUrl") or thumb)
    download = str(item.get("downloadUrl") or preview)
    return ImageInfo(
        id=str(item.get("id", "")), description=item.get("description"),
        width=_number(item.get("width")), height=_number(item.get("height")),
        color=str(item.get("color") or "#000000"),
        raw_url=download, full_url=download, regular_url=preview,
        small_url=thumb, thumb_url=thumb,
        user_id="", user_name=name, user_username=_handle_from(profile, name),
        user_profile_url=profile, created_at="", updated_at="",
        tags=[t for t in item.get("tags", []) if isinstance(t, str)],
        html_url=str(item.get("pageUrl") or ""),
        download_location=str(item.get("downloadLocation") or ""),
    )


def _video_info(item: Dict[str, Any]) -> Optional[VideoInfo]:
    identifier = _int_id(item)
    if identifier is None or not item.get("downloadUrl"):
        return None
    name, _ = _author(item)
    millis = item.get("durationMs")
    return VideoInfo(
        id=identifier, title=f"Video by {name}", author=name,
        duration=round(millis / 1000) if isinstance(millis, (int, float)) else None,
        video_url=str(item["downloadUrl"]), thumbnail=str(item.get("thumbUrl") or ""),
        width=_number(item.get("width")), height=_number(item.get("height")),
    )


def _optional_int(value: Any) -> Optional[int]:
    return int(value) if isinstance(value, (int, float)) else None


def _audio_info(item: Dict[str, Any]) -> Optional[AudioInfo]:
    identifier = _int_id(item)
    if identifier is None or not item.get("downloadUrl"):
        return None
    name, _ = _author(item)
    millis = item.get("durationMs")
    return AudioInfo(
        id=identifier, name=str(item.get("name") or "Unknown"),
        description=str(item.get("description") or ""), username=name,
        duration=millis / 1000 if isinstance(millis, (int, float)) else 0.0,
        download_url=str(item["downloadUrl"]), preview_url=str(item.get("previewUrl") or ""),
        waveform_url=item.get("waveformUrl"), license=str(item.get("license") or "Unknown"),
        tags=[t for t in item.get("tags", []) if isinstance(t, str)],
        filesize=_optional_int(item.get("sizeBytes")),
        channels=_optional_int(item.get("channels")),
        samplerate=_optional_int(item.get("sampleRate")),
    )


def _convert(items: List[Dict[str, Any]], build: Callable[[Dict[str, Any]], Any],
             kind: str) -> List[Any]:
    """Map items; skipped ones are logged, and an all-skipped page is an error."""
    converted = [built for built in (build(item) for item in items) if built is not None]
    if items and not converted:
        raise RouterError("router_bad_response", 502,
                          f"Gateway returned {kind} results without usable ids or URLs.")
    if len(converted) < len(items):
        logger.warning("skillrouter skipped %d unusable %s result(s)",
                       len(items) - len(converted), kind)
    return converted


def _message(count: int, kind: str, attribution: str, query: str) -> str:
    if not count:
        return f"No {kind} found for query: '{query}'"
    suffix = f" ({attribution})" if attribution else ""
    return f"Found {count} {kind}{suffix}"


# --------------------------------------------------------------------- public API


def search_images(query: str, max_images: int, orientation: str = "all",
                  color: str = "all", order_by: str = "relevant") -> ImageSearchResponse:
    """Unsplash search via the gateway (``image_search``)."""
    limits = blocking_limits("image_search")
    body: Dict[str, Any] = {"query": query}
    for name, value, key, neutral in (
        ("orientation", orientation, "orientations", "all"),
        ("color", color, "colors", "all"),
        ("orderBy", order_by, "orderBy", "relevant"),
    ):
        if value == neutral:
            continue
        if _supported(value, limits.get(key)):
            body[name] = value
        else:
            _drop_unsupported(name, value)
    pages = _fetch_pages("media/search/images", "image_search", body, max_images)
    images = _convert(pages.items, _image_info, "images")
    return ImageSearchResponse(
        success=True, message=_message(len(images), "images", pages.attribution, query),
        images=images, total_found=pages.total if images else 0, query=query)


def search_videos(query: str, max_videos: int, orientation: str = "mixed") -> VideoSearchResponse:
    """Pexels search via the gateway (``video_search``)."""
    limits = blocking_limits("video_search")
    body: Dict[str, Any] = {"query": query}
    if orientation != "mixed":
        if _supported(orientation, limits.get("orientations")):
            body["orientation"] = orientation
        else:
            _drop_unsupported("orientation", orientation)
    pages = _fetch_pages("media/search/videos", "video_search", body, max_videos)
    videos = _convert(pages.items, _video_info, "videos")
    return VideoSearchResponse(
        success=True, message=_message(len(videos), "videos", pages.attribution, query),
        videos=videos, total_found=len(videos), query=query)


def _audio_body(query: str, options: AudioSearchOptions, limits: Dict[str, Any]) -> Dict[str, Any]:
    body: Dict[str, Any] = {"query": query}
    if options.audio_type != "all":
        body["audioType"] = options.audio_type
    sort = _AUDIO_SORT_ALIASES.get(options.sort_by, options.sort_by)
    if sort != "score":
        if _supported(sort, limits.get("sorts")):
            body["sort"] = sort
        else:
            _drop_unsupported("sort", sort)
    span = limits.get("duration") if isinstance(limits.get("duration"), dict) else {}
    low, high = span.get("minSeconds", 0), span.get("maxSeconds", 3600)
    for key, value in (("minDurationSeconds", options.duration_min),
                       ("maxDurationSeconds", options.duration_max)):
        if value is not None:
            body[key] = max(low, min(high, value))
    return body


def search_audios(query: str, max_audios: int,
                  options: Optional[AudioSearchOptions] = None) -> AudioSearchResponse:
    """Freesound search via the gateway (``audio_search``)."""
    body = _audio_body(query, options or AudioSearchOptions(), blocking_limits("audio_search"))
    pages = _fetch_pages("media/search/sounds", "audio_search", body, max_audios)
    audios = _convert(pages.items, _audio_info, "audio files")
    return AudioSearchResponse(
        success=True, message=_message(len(audios), "audio files", pages.attribution, query),
        audios=audios, total_found=pages.total if audios else 0, query=query)
