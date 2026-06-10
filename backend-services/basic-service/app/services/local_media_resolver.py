"""Resolve renderer media references to validated local filesystem paths."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import unquote, urlparse

from app.config import settings
from app.security.url_guard import (
    URLGuardError,
    validate_external_url,
    validate_local_path_for_ffmpeg,
)

SourceKind = Literal[
    "local_storage",
    "audio_generated",
    "audio_subtitle",
    "timeline_export",
    "video_composed",
    "legacy_remote",
]


class LocalMediaResolveError(ValueError):
    """Raised when a media reference cannot be mapped safely."""


@dataclass(frozen=True)
class ResolvedMediaPath:
    input_ref: str
    path: Path
    public_url: str | None
    source_kind: SourceKind


SERVICE_ROOT = Path(__file__).resolve().parents[2]

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

ROUTE_PREFIXES: tuple[tuple[str, Path | None, SourceKind], ...] = (
    ("/api/storage/files/", None, "local_storage"),
    ("/api/audio/generated/", Path("static/audio/generated"), "audio_generated"),
    ("/api/audio/subtitles/", Path("static/audio/subtitles"), "audio_subtitle"),
    ("/static/timeline_exports/", Path("static/timeline_exports"), "timeline_export"),
    ("/api/video/compose/", Path("static/video/composed"), "video_composed"),
)


def _absolute_root(root: Path) -> Path:
    if root.is_absolute():
        return root
    return SERVICE_ROOT / root


def _allowed_roots() -> list[Path]:
    roots = [
        _absolute_root(Path(settings.storage.root)),
        _absolute_root(Path("static/audio/generated")),
        _absolute_root(Path("static/audio/subtitles")),
        _absolute_root(Path("static/timeline_exports")),
        _absolute_root(Path("static/video/composed")),
        # Spec 05 §2.3 (R7): export may reference frame thumbnails (filmstrip
        # posters). Whitelist the thumbnails dir so they resolve, while the path
        # guard still rejects traversal outside it.
        _absolute_root(Path("static/video/thumbnails")),
        _absolute_root(Path(settings.temp_dir)),
        Path(tempfile.gettempdir()),
    ]
    media_proxy_dir = getattr(getattr(settings, "media_proxy", None), "hot_cache_dir", None)
    if media_proxy_dir:
        roots.append(_absolute_root(Path(media_proxy_dir)))
    return roots


def _normalize_reference(reference: str) -> tuple[str, bool]:
    if not isinstance(reference, str) or not reference.strip():
        raise LocalMediaResolveError("media reference is empty")

    raw = reference.strip()
    parsed = urlparse(raw)
    scheme = parsed.scheme.lower()

    if scheme in {"file", "ftp", "rtsp", "rtmp", "gopher", "data", "blob", "javascript"}:
        raise LocalMediaResolveError(f"unsupported media reference scheme: {scheme}")

    if scheme in {"http", "https"}:
        host = (parsed.hostname or "").lower()
        if host in LOCAL_HOSTS:
            return unquote(parsed.path), False
        return raw, True

    return raw, False


def _resolve_route_path(pathname: str, input_ref: str) -> ResolvedMediaPath:
    for prefix, root, source_kind in ROUTE_PREFIXES:
        if not pathname.startswith(prefix):
            continue

        relative = unquote(pathname[len(prefix):])
        raw_root = Path(settings.storage.root) if root is None else root
        candidate_root = _absolute_root(raw_root)
        candidate = candidate_root / relative
        try:
            resolved = validate_local_path_for_ffmpeg(
                str(candidate),
                [candidate_root],
            )
        except URLGuardError as exc:
            raise LocalMediaResolveError(str(exc)) from exc

        return ResolvedMediaPath(
            input_ref=input_ref,
            path=resolved,
            public_url=pathname,
            source_kind=source_kind,
        )

    raise LocalMediaResolveError(f"unknown local media route: {pathname}")


def resolve_media_reference(
    reference: str,
    material_id: str | None = None,  # kept for future DB-backed lookup
    allow_remote: bool = False,
) -> ResolvedMediaPath:
    """Resolve a browser/backend media reference to a safe local file path."""

    del material_id
    normalized, is_remote = _normalize_reference(reference)

    if is_remote:
        if not allow_remote:
            raise LocalMediaResolveError("remote media references are disabled")
        try:
            safe_url = validate_external_url(normalized)
        except URLGuardError as exc:
            raise LocalMediaResolveError(str(exc)) from exc
        return ResolvedMediaPath(
            input_ref=reference,
            path=Path(safe_url),
            public_url=safe_url,
            source_kind="legacy_remote",
        )

    if normalized.startswith("/"):
        return _resolve_route_path(normalized, reference)

    if "://" in normalized:
        raise LocalMediaResolveError("unsupported media reference")

    local_path = Path(normalized)
    if not local_path.is_absolute():
        local_path = SERVICE_ROOT / local_path

    try:
        resolved = validate_local_path_for_ffmpeg(
            str(local_path),
            _allowed_roots(),
        )
    except URLGuardError as exc:
        raise LocalMediaResolveError(str(exc)) from exc

    return ResolvedMediaPath(
        input_ref=reference,
        path=resolved,
        public_url=None,
        source_kind="local_storage",
    )


def storage_relative_path(path: Path) -> str:
    """Return the storage-root-relative public key for a resolved file."""

    root = _absolute_root(Path(settings.storage.root)).resolve()
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(root)).replace(os.sep, "/")
    except ValueError as exc:
        raise LocalMediaResolveError("path is outside storage root") from exc
