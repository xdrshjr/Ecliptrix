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

import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse

from app.dependencies.auth import get_current_user
from app.logger import get_logger
from app.models.db_models import User
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


@router.get("/files/{file_path:path}")
async def serve_storage_file(
    file_path: str,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    """Serve a file from the storage root with ownership enforcement.

    Args:
        file_path: relative path under ``STORAGE_ROOT`` (e.g.
            ``video/2026/05/20/user_abc/task1/clip.mp4``).
        request: starlette request (unused but required for dependency).
        current_user: injected by ``get_current_user``.

    Returns:
        ``FileResponse`` streaming the file via sendfile.

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
    # ``<video src=...>`` / ``<img src=...>`` work. Starlette's
    # ``FileResponse`` defaults to ``attachment`` when ``filename`` is
    # supplied — pass ``content_disposition_type='inline'`` explicitly.
    return FileResponse(
        path=str(absolute_path),
        headers=headers,
        filename=basename,
        content_disposition_type="inline",
    )
