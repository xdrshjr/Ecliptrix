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
    ("/api/video/compose/", None, "video_composed"),
)


def _absolute_root(root: Path) -> Path:
    if root.is_absolute():
        return root
    return SERVICE_ROOT / root


# generated / subtitles audio relative subpaths. Preserved across the
# STORAGE_ROOT migration (docs/diagnoses/preview-seek-blackscreen-and-packaged-export-r3
# Bug B / B1): the canonical anchor is the persistent, writable STORAGE_ROOT —
# packaged desktop installs the service into a volatile/read-only dir, so audio
# written/served/resolved relative to that dir vanished and broke export. The
# legacy anchor (the service install dir) is kept ONLY as a resolve-side fallback
# (B2) so projects saved before the migration still resolve their old references.
_AUDIO_GENERATED_REL = Path("static/audio/generated")
_AUDIO_SUBTITLE_REL = Path("static/audio/subtitles")
_COMPOSED_VIDEO_REL = Path("static/video/composed")


def _storage_root() -> Path:
    """Absolute STORAGE_ROOT (anchored to SERVICE_ROOT when configured relative)."""
    return _absolute_root(Path(settings.storage.root))


def composed_output_dir() -> Path:
    """Canonical on-disk dir for finished exports, under STORAGE_ROOT (EX3-06).

    The packaged backend runs with its install dir as CWD, so the old
    CWD-relative ``static/video/composed`` wrote every export into the
    installation. The directory is not created here: the compositor creates it
    before its first write.
    """
    return _storage_root() / _COMPOSED_VIDEO_REL


def audio_generated_dir() -> Path:
    """Canonical on-disk dir for generated (TTS) audio, under STORAGE_ROOT."""
    return _storage_root() / _AUDIO_GENERATED_REL


def audio_subtitle_dir() -> Path:
    """Canonical on-disk dir for subtitle audio/SRT, under STORAGE_ROOT."""
    return _storage_root() / _AUDIO_SUBTITLE_REL


def legacy_audio_generated_dir() -> Path:
    """Pre-migration generated-audio dir under the service install root (B2)."""
    return SERVICE_ROOT / _AUDIO_GENERATED_REL


def legacy_audio_subtitle_dir() -> Path:
    """Pre-migration subtitle dir under the service install root (B2)."""
    return SERVICE_ROOT / _AUDIO_SUBTITLE_REL


def _candidate_roots(source_kind: SourceKind, root: Path | None) -> list[Path]:
    """Ordered on-disk roots to try for a matched route prefix.

    generated / subtitles audio resolve against the canonical STORAGE_ROOT first,
    then the legacy service-install dir (B2 fallback). Every other route keeps its
    single historical anchor.
    """
    if source_kind == "audio_generated":
        return [audio_generated_dir(), legacy_audio_generated_dir()]
    if source_kind == "audio_subtitle":
        return [audio_subtitle_dir(), legacy_audio_subtitle_dir()]
    if source_kind == "video_composed":
        return [composed_output_dir()]
    if root is None:
        return [_absolute_root(Path(settings.storage.root))]
    return [_absolute_root(root)]


def _allowed_roots() -> list[Path]:
    roots = [
        _absolute_root(Path(settings.storage.root)),
        _absolute_root(Path("static/audio/generated")),
        _absolute_root(Path("static/audio/subtitles")),
        _absolute_root(Path("static/timeline_exports")),
        composed_output_dir(),
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
        last_error: LocalMediaResolveError | None = None
        for candidate_root in _candidate_roots(source_kind, root):
            candidate = candidate_root / relative
            try:
                resolved = validate_local_path_for_ffmpeg(
                    str(candidate),
                    [candidate_root],
                )
            except URLGuardError as exc:
                # Not under this candidate (typically: file absent). Try the next
                # candidate root (B2 legacy fallback) before giving up.
                last_error = LocalMediaResolveError(str(exc))
                continue

            return ResolvedMediaPath(
                input_ref=input_ref,
                path=resolved,
                public_url=pathname,
                source_kind=source_kind,
            )

        raise last_error or LocalMediaResolveError(
            f"media route resolved to no existing file: {pathname}"
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
