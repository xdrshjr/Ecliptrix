"""
Storage files router (spec/01 §V01-C — replace anonymous StaticFiles mount).

Replaces ``app.mount("/api/storage/files", StaticFiles(...))`` with a typed
endpoint that:

  * Requires an authenticated session (``Depends(get_current_user)``)
  * Reuses ``StorageService._validate_path`` to defeat ``..`` traversal
  * Enforces a simple ownership model:
      - ``cached_materials/`` prefix → public to ANY authenticated user
        (these are pre-downloaded remote assets shared across users)
      - Paths containing a ``user_<id>`` segment → only the owning user
        OR an admin may read
      - All other paths → any authenticated user (legacy fallback for
        files written prior to per-user scoping; admin can override)
  * Streams the file via ``FileResponse`` so kernel sendfile is preserved
  * Sets ``X-Content-Type-Options: nosniff`` to neutralise MIME sniffing

Threat model
------------
CVSS 7.5 — unauthenticated remote attacker enumerates files via
predictable paths (timestamps, sequential IDs) and exfiltrates other
users' uploads.

Tests
-----
See ``tests/security/test_01_auth.py`` for the access-matrix coverage.
"""

from __future__ import annotations

import hashlib
import mimetypes
import os
import re
from email.utils import formatdate
from pathlib import Path
from typing import Optional, Union

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.dependencies.auth import get_current_user
from app.logger import get_logger
from app.models.db_models import User
from app.security.url_guard import URLGuardError, validate_local_path_for_ffmpeg
from app.services.local_media_resolver import (
    audio_generated_dir,
    audio_subtitle_dir,
)
from app.services.storage_service import storage_service

logger = get_logger(__name__)

router = APIRouter(prefix="/storage", tags=["Storage Files"])


# Path segments like "user_<id>" are emitted by StorageService._generate_storage_path.
# We match on the first such segment encountered in the relative path.
_USER_DIR_RE = re.compile(r"^user_([A-Za-z0-9._\-]+)$")

# Path prefixes that any authenticated user may read regardless of owner.
# These are shared/public assets (pre-downloaded Pexels/ARK videos, etc.).
_PUBLIC_PREFIXES = ("cached_materials/",)


# spec/04 §3.4 (V04-B defense-in-depth) — extensions whose content can be
# interpreted as active code by browsers (script execution, inline SVG,
# HTML rendering, XML entities, ...). For any such file we:
#
#   * force ``Content-Disposition: attachment`` so the browser downloads
#     it instead of rendering inline (kills stored-XSS via SVG/HTML);
#   * override ``Content-Type`` to ``text/plain; charset=utf-8`` so even
#     a "Save & open in browser" workflow does not execute the file in
#     the ecliptrix.example.com origin.
#
# The companion ``_sanitize_filename`` rewrite at upload time means
# fresh uploads will never carry these extensions, but we keep this
# safety net for legacy files that pre-date the sanitizer (and for any
# future code path that writes raw user content without going through
# the router-level upload flow).
_DANGEROUS_DOWNLOAD_EXTENSIONS = frozenset({
    ".html", ".htm", ".xhtml",
    ".svg",
    ".xml",
    ".js", ".mjs", ".cjs",
    ".php", ".phtml", ".phar",
    ".jsp", ".asp", ".aspx",
    ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1",
    ".py", ".pyc", ".pyo",
    ".exe", ".com", ".scr", ".dll",
    ".htaccess",
})


def _is_dangerous_download(absolute_path: Path) -> bool:
    """Return True when ``absolute_path``'s extension is in the danger list."""
    return absolute_path.suffix.lower() in _DANGEROUS_DOWNLOAD_EXTENSIONS


def _extract_owner_from_path(relative_path: str) -> Optional[str]:
    """Return the user_id encoded in a path like ``video/.../user_<id>/...``.

    Returns ``None`` when no ``user_<id>`` segment is present, meaning the
    file pre-dates per-user scoping or was written by a non-user actor.
    """
    for segment in relative_path.split("/"):
        m = _USER_DIR_RE.match(segment)
        if m:
            return m.group(1)
    return None


def _is_public_path(relative_path: str) -> bool:
    """Return True when ``relative_path`` is a shared/public asset."""
    return any(relative_path.startswith(prefix) for prefix in _PUBLIC_PREFIXES)


# ---------------------------------------------------------------------------
# HTTP Range (RFC 7233) support for media seeking.
#
# Starlette 0.27.0 (pinned in requirements.txt) ships a ``FileResponse`` that
# ignores the ``Range`` request header — it always returns ``200`` whole-file
# with no ``Accept-Ranges``. Browser ``<video>`` elements then treat the
# resource as non-seekable: any seek restarts a from-byte-0 whole-file
# download and the element stalls below ``readyState>=2``, so the preview
# compositor (which only draws video layers at ``readyState>=2``) renders
# pure black. We implement single-range ``206`` here so seeking works
# regardless of the pinned Starlette version — the frontend / Next proxy are
# already Range-ready. See
# docs/diagnoses/preview-blackscreen-no-http-range-seeking/analysis.md.
# ---------------------------------------------------------------------------

_RANGE_CHUNK_SIZE = 64 * 1024

# Sentinel returned by ``_parse_single_byte_range`` when the requested range
# is syntactically valid but unsatisfiable (start past EOF → RFC 7233 ``416``).
_RANGE_NOT_SATISFIABLE = object()


def _stat_validator_headers(stat_result: os.stat_result) -> dict:
    """Build ``ETag`` / ``Last-Modified`` headers from a stat result.

    Mirrors Starlette's ``FileResponse.set_stat_headers`` so cache validators
    stay byte-for-byte consistent between the ``200`` and ``206`` branches.
    """
    last_modified = formatdate(stat_result.st_mtime, usegmt=True)
    etag_base = f"{stat_result.st_mtime}-{stat_result.st_size}"
    etag = '"' + hashlib.md5(
        etag_base.encode(), usedforsecurity=False
    ).hexdigest() + '"'
    return {"last-modified": last_modified, "etag": etag}


def _parse_single_byte_range(
    range_header: str, file_size: int
) -> Union[tuple, object, None]:
    """Parse a single-segment ``bytes=`` Range header.

    Returns:
        ``(start, end_inclusive)`` for a satisfiable single byte range;
        ``_RANGE_NOT_SATISFIABLE`` when the range is well-formed but ``start``
        is at/after EOF (the caller emits ``416``);
        ``None`` when the header is absent / malformed / multi-range — the
        caller then falls back to a normal ``200`` response (RFC 7233: an
        unparsable ``Range`` is ignored, not rejected). Media elements only
        ever request a single byte range, so we deliberately do not emit
        ``multipart/byteranges``.
    """
    if not range_header or "=" not in range_header:
        return None
    units, _sep, spec = range_header.partition("=")
    if units.strip().lower() != "bytes":
        return None
    # Multi-range request → ignore and serve the whole file (200).
    if "," in spec:
        return None
    spec = spec.strip()
    if "-" not in spec:
        return None
    start_str, _dash, end_str = spec.partition("-")
    start_str, end_str = start_str.strip(), end_str.strip()
    try:
        if start_str == "":
            # Suffix range ``bytes=-N`` → final N bytes.
            if end_str == "":
                return None
            suffix = int(end_str)
            if suffix <= 0:
                return None
            start = max(0, file_size - suffix)
            end = file_size - 1
        else:
            start = int(start_str)
            end = int(end_str) if end_str != "" else file_size - 1
            if end >= file_size:
                end = file_size - 1
    except ValueError:
        return None
    if start < 0 or end < 0:
        return None
    # ``start`` past EOF is unsatisfiable (416). Check this BEFORE the
    # reversed-range guard below, because clamping ``end`` to ``file_size-1``
    # would otherwise make an unsatisfiable range look like ``start > end``.
    if start >= file_size:
        return _RANGE_NOT_SATISFIABLE
    if start > end:
        return None
    return (start, end)


async def _iter_file_range(path: str, start: int, length: int):
    """Stream ``length`` bytes from ``path`` starting at offset ``start``.

    Uses ``aiofiles`` so the seek+read loop never blocks the event loop
    (CLAUDE.md: async file I/O everywhere). Streaming a slice trades kernel
    ``sendfile`` for correctness (seekable media), which is the accepted cost.
    """
    remaining = length
    async with aiofiles.open(path, "rb") as handle:
        await handle.seek(start)
        while remaining > 0:
            chunk = await handle.read(min(_RANGE_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _serve_safe_media(
    absolute_path: Path,
    basename: str,
    request: Request,
    base_headers: dict,
) -> Response:
    """Serve a non-dangerous media file inline, honouring HTTP Range.

    Behaviour (RFC 7233):
      * no ``Range`` header → ``200`` whole file via ``FileResponse`` (keeps
        kernel sendfile) plus ``Accept-Ranges: bytes``;
      * satisfiable single range → ``206`` streamed slice;
      * unsatisfiable range → ``416`` with ``Content-Range: bytes */size``;
      * malformed / multi-range → ignored, ``200`` whole file (streamed so the
        result is identical regardless of the installed Starlette version).

    Whenever a ``Range`` header is present we take full control of the
    response and never hand it to ``FileResponse`` — newer Starlette versions
    re-parse ``Range`` internally, which would diverge from the pinned 0.27.0.
    """
    stat_result = absolute_path.stat()
    file_size = stat_result.st_size
    media_type = mimetypes.guess_type(basename)[0] or "application/octet-stream"
    disposition = f'inline; filename="{basename}"'

    range_header = request.headers.get("range")
    if range_header:
        parsed_range = _parse_single_byte_range(range_header, file_size)

        if parsed_range is _RANGE_NOT_SATISFIABLE:
            return Response(
                status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                headers={
                    **base_headers,
                    "Accept-Ranges": "bytes",
                    "Content-Range": f"bytes */{file_size}",
                },
            )

        if parsed_range is not None:
            start, end = parsed_range
            content_length = end - start + 1
            return StreamingResponse(
                _iter_file_range(str(absolute_path), start, content_length),
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                media_type=media_type,
                headers={
                    **base_headers,
                    **_stat_validator_headers(stat_result),
                    "Accept-Ranges": "bytes",
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Content-Length": str(content_length),
                    "Content-Disposition": disposition,
                },
            )

        # Malformed / multi-range header → ignore it and stream the whole file.
        return StreamingResponse(
            _iter_file_range(str(absolute_path), 0, file_size),
            status_code=status.HTTP_200_OK,
            media_type=media_type,
            headers={
                **base_headers,
                **_stat_validator_headers(stat_result),
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Disposition": disposition,
            },
        )

    return FileResponse(
        path=str(absolute_path),
        headers={**base_headers, "Accept-Ranges": "bytes"},
        filename=basename,
        content_disposition_type="inline",
    )


@router.get("/files/{file_path:path}")
async def serve_storage_file(
    file_path: str,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> Response:
    """Serve a file from the storage root with ownership enforcement.

    Args:
        file_path: relative path under ``STORAGE_ROOT`` (e.g.
            ``video/2026/05/20/user_abc/task1/clip.mp4``).
        request: starlette request; its ``Range`` header drives ``206``
            partial-content responses for seekable media.
        current_user: injected by ``get_current_user``.

    Returns:
        ``FileResponse`` (200, whole file) for non-range requests, a
        ``StreamingResponse`` (206, byte slice) when a satisfiable ``Range``
        header is present, or a 416 ``Response`` for an unsatisfiable range.

    Raises:
        HTTPException 400: malformed path / traversal attempt.
        HTTPException 403: cross-user access by non-admin.
        HTTPException 404: file does not exist.
    """
    # 1. Reject empty paths early.
    if not file_path or file_path.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file path",
        )

    # 2. Reuse StorageService._validate_path → guards against ../ traversal
    #    and absolute paths escaping the storage root.
    try:
        absolute_path: Path = storage_service._validate_path(file_path)
    except ValueError as exc:
        logger.warning(
            "storage_files_router: path traversal attempt rejected",
            {"path": file_path, "user_id": str(current_user.id)},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file path",
        ) from exc

    # 3. File must exist and be a regular file (not a directory).
    if not absolute_path.exists() or not absolute_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )

    # 4. Ownership enforcement.
    if not _is_public_path(file_path):
        owner = _extract_owner_from_path(file_path)
        if owner is not None and not current_user.is_admin:
            if owner != str(current_user.id):
                logger.warning(
                    "storage_files_router: cross-user access denied",
                    {
                        "path": file_path,
                        "owner": owner,
                        "requester": str(current_user.id),
                    },
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied",
                )
        # When `owner is None` we fall through. These are legacy files
        # written before per-user scoping (timeline exports, etc.) and
        # are visible to any authenticated user. Admin override is implicit
        # because admins always pass the cross-user gate above.

    # 5. Serve. FileResponse uses sendfile() under the hood.
    headers = {
        # Disable MIME-sniffing — important when serving arbitrary user
        # uploads. Without this header an HTML-disguised .jpg could
        # execute as HTML in some browsers.
        "X-Content-Type-Options": "nosniff",
    }

    # spec/04 §3.4 / V04-B — neutralise dangerous extensions on the wire.
    # If the on-disk file is one of the renderable/executable types we
    # could not rewrite at upload time (legacy files, externally-written
    # cached materials, etc.), serve it as ``text/plain`` and force
    # ``Content-Disposition: attachment``. This kills the stored-XSS
    # vector at the download boundary.
    basename = os.path.basename(absolute_path)
    if _is_dangerous_download(absolute_path):
        headers["Content-Disposition"] = (
            f'attachment; filename="{basename}"'
        )
        logger.info(
            "storage_files_router: dangerous extension served as attachment",
            {
                "path": file_path,
                "extension": absolute_path.suffix.lower(),
                "user_id": str(current_user.id),
            },
        )
        return FileResponse(
            path=str(absolute_path),
            headers=headers,
            media_type="text/plain; charset=utf-8",
            filename=basename,
        )

    # For safe media (mp4/jpg/etc.) we want INLINE rendering so
    # ``<video src=...>`` / ``<img src=...>`` work, AND we honour HTTP Range so
    # media elements can seek without re-downloading the whole file. The pinned
    # Starlette 0.27.0 ``FileResponse`` supports neither Range nor
    # ``Accept-Ranges`` (see analysis.md), so ``_serve_safe_media`` handles it.
    return _serve_safe_media(absolute_path, basename, request, headers)


# ---------------------------------------------------------------------------
# Generated / subtitle audio served with HTTP Range (mid-clip preview seek).
#
# TTS / generated audio (``/api/audio/generated``) and subtitle/ASR audio
# (``/api/audio/subtitles``) used to be served by bare ``StaticFiles`` mounts.
# Under the pinned Starlette 0.27.0 those mounts ignore the ``Range`` request
# header (200 whole-file, no ``Accept-Ranges``), so a browser ``<audio>``/
# ``<video>`` element handed a non-zero ``currentTime`` — i.e. preview playback
# STARTED FROM THE MIDDLE of an audio clip — can never reach a playable state
# at that offset and the audio track stays silent. Starting at the clip head
# works only because it needs no seek (progressive download from byte 0). Video
# never had this bug because every video file is served by the Range-capable
# ``/api/storage/files`` router below — this gives the two audio dirs the SAME
# explicit ``206`` serving via ``_serve_safe_media``, at the SAME public URLs
# and SAME physical roots (under ``STORAGE_ROOT``), so saved projects, the media
# resolver, and producers are unaffected.
# See docs/diagnoses/audio-midclip-silent-non-seekable-source/analysis.md.
# ---------------------------------------------------------------------------

audio_router = APIRouter(prefix="/audio", tags=["Audio Files"])


def _serve_audio_with_range(
    root: Path, file_path: str, request: Request
) -> Response:
    """Serve an audio/subtitle file from ``root`` honouring HTTP Range.

    Mirrors ``serve_storage_file``: contain ``file_path`` inside ``root``
    (``..``-traversal guard — a hand-rolled route does NOT get StaticFiles'
    free escape protection), ``404`` a missing file, then delegate to
    ``_serve_safe_media`` so single-range ``206`` behaviour is byte-identical
    to ``/api/storage/files``.

    Args:
        root: physical directory the audio dir is anchored to (under
            ``STORAGE_ROOT`` — ``audio_generated_dir()`` / ``audio_subtitle_dir()``).
        file_path: relative path captured from the URL.
        request: starlette request; its ``Range`` header drives ``206``.

    Returns:
        ``FileResponse`` (200, whole file), ``StreamingResponse`` (206, byte
        slice), or a ``416`` ``Response`` for an unsatisfiable range.

    Raises:
        HTTPException 400: empty path or ``..`` traversal attempt.
        HTTPException 404: file does not exist.
    """
    if not file_path or file_path.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file path",
        )

    candidate = root / file_path
    try:
        absolute_path = validate_local_path_for_ffmpeg(
            str(candidate), [root], must_exist=False
        )
    except URLGuardError as exc:
        logger.warning(
            "audio file router: path traversal attempt rejected",
            {"path": file_path},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file path",
        ) from exc

    if not absolute_path.exists() or not absolute_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )

    basename = os.path.basename(absolute_path)
    return _serve_safe_media(absolute_path, basename, request, {})


@audio_router.get("/generated/{file_path:path}")
async def serve_generated_audio(
    file_path: str,
    request: Request,
) -> Response:
    """Serve a generated (TTS) audio file with HTTP Range (mid-clip seek)."""
    return _serve_audio_with_range(audio_generated_dir(), file_path, request)


@audio_router.get("/subtitles/{file_path:path}")
async def serve_subtitle_audio(
    file_path: str,
    request: Request,
) -> Response:
    """Serve a subtitle/ASR audio file with HTTP Range (mid-clip seek)."""
    return _serve_audio_with_range(audio_subtitle_dir(), file_path, request)
