"""
Local file storage service replacing Supabase Storage.

Provides file upload, download, listing, and deletion using
the local filesystem with async I/O via aiofiles.
"""

import os
import re
import json
import shutil
import subprocess
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

import aiofiles

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)


class StorageService:
    """Service for handling local file storage operations."""

    def __init__(self) -> None:
        """Initialize storage service and ensure root directory exists."""
        self.config = settings.storage
        self.root = Path(self.config.root)
        self.root.mkdir(parents=True, exist_ok=True)

        logger.info("StorageService initialized", {
            "root": str(self.root.resolve()),
            "max_file_size": self.config.max_file_size,
        })

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _generate_storage_path(
        self,
        filename: str,
        folder: str = "files",
        user_id: str = "anonymous",
        task_id: Optional[str] = None,
    ) -> str:
        """Build a date/user/task-based relative path inside the storage root.

        Pattern: {folder}/{YYYY}/{MM}/{DD}/user_{user_id}/{task_id}/{filename}
        """
        now = datetime.now()
        parts: List[str] = [
            folder,
            now.strftime("%Y"),
            now.strftime("%m"),
            now.strftime("%d"),
            f"user_{user_id}",
        ]
        if task_id:
            parts.append(task_id)
        parts.append(self._sanitize_filename(filename))
        return "/".join(parts)

    def _get_file_url(self, relative_path: str) -> str:
        """Return the URL that serves a stored file via the static mount."""
        return f"/api/storage/files/{relative_path}"

    # ------------------------------------------------------------------
    # Path / filename hardening (spec/04 V04-A, V04-B, V04-C)
    # ------------------------------------------------------------------

    # Maximum length (in bytes, after UTF-8 encoding) of a relative path
    # passed to ``_validate_path``. Filesystems differ but 4096 is a safe
    # cap (Linux PATH_MAX), well below ext4/NTFS limits, and short enough
    # to fend off pathological inputs that try to exhaust the resolver.
    _MAX_RELATIVE_PATH_BYTES = 4096

    # Filename hard cap (post-sanitization). Stored uploads under
    # ``STORAGE_ROOT`` carry uuid prefixes added by the router, so we want
    # the *user-controlled* portion to stay well under common 255-byte
    # filesystem name limits.
    _MAX_FILENAME_LENGTH = 200

    # Dangerous filename characters: directory separators, Windows-reserved
    # chars, control bytes. These are unconditionally replaced.
    # We intentionally KEEP Unicode letters (incl. CJK) so legitimate
    # Chinese/Japanese/Korean filenames survive \u2014 see spec \u00a77 "risk" row.
    _UNSAFE_FILENAME_CHARS_RE = re.compile(
        r'[/\\:*?"<>|\x00-\x1f\x7f]'
    )

    # Executable / script extensions that must never round-trip through
    # the public download path as-is (V04-B: stored XSS / RCE vectors).
    # The download router (``storage_files_router``) also enforces
    # ``Content-Disposition: attachment`` for these extensions; the
    # sanitizer adds a defense-in-depth layer by REWRITING the extension
    # at upload time.
    _DANGEROUS_EXTENSIONS = frozenset({
        ".html", ".htm", ".svg", ".xml", ".xhtml",
        ".js", ".mjs", ".cjs",
        ".php", ".phtml", ".phar",
        ".py", ".pyc", ".pyo",
        ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1",
        ".exe", ".com", ".scr", ".dll", ".so",
        ".jsp", ".asp", ".aspx",
        ".htaccess",
    })

    # Windows-reserved device names. Even with a benign extension these
    # cause weird behaviour on Win32 filesystems.
    _WINDOWS_RESERVED_BASENAMES = frozenset({
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    })

    def _validate_path(self, relative_path: str) -> Path:
        """Resolve a relative path and guard against directory traversal.

        Strict checks (spec/04 V04-A):
          1. Reject ``None`` / empty / whitespace-only input.
          2. Reject embedded NUL bytes (``\\x00``).
          3. Reject paths whose UTF-8 byte length exceeds
             ``_MAX_RELATIVE_PATH_BYTES``.
          4. Reject absolute paths (POSIX leading ``/``, Windows leading
             ``\\``, Windows drive prefix like ``C:``, and UNC ``\\\\``).
          5. Resolve via ``Path.resolve(strict=False)`` and ensure the
             result lies under ``STORAGE_ROOT`` via ``is_relative_to``
             \u2014 this defeats ``..`` segments, encoded ``../`` ladders, and
             surprise junction/symlink redirection in already-existing
             parent dirs (``resolve`` follows symlinks).
          6. If the target itself already exists and is a symlink, refuse
             \u2014 uploading to a symlink would let an attacker plant a link
             pointing outside the root and overwrite arbitrary files
             (TOCTOU). Pre-existing symlinks in STORAGE_ROOT are an ops
             concern; new code must not honour them.

        Args:
            relative_path: User-supplied path fragment to validate.

        Returns:
            The absolute, resolved ``Path`` inside ``STORAGE_ROOT``.

        Raises:
            ValueError: On any rule violation. The message is generic to
                avoid leaking layout details to attackers.
        """
        if relative_path is None:
            raise ValueError("relative path is empty")
        if not isinstance(relative_path, (str, os.PathLike)):
            raise ValueError("relative path must be a string")
        rel_str = str(relative_path)
        if not rel_str or not rel_str.strip():
            raise ValueError("relative path is empty")

        # Reject NUL byte (Rule 2) before anything else can interpret it
        # as a C-string terminator.
        if "\x00" in rel_str:
            raise ValueError("relative path contains NUL byte")

        # Reject control characters that have no place in a filesystem path.
        if any(ord(ch) < 32 for ch in rel_str):
            raise ValueError("relative path contains control characters")

        # Rule 3 \u2014 UTF-8 byte length cap.
        try:
            encoded_len = len(rel_str.encode("utf-8"))
        except UnicodeEncodeError as exc:
            raise ValueError("relative path is not valid UTF-8") from exc
        if encoded_len > self._MAX_RELATIVE_PATH_BYTES:
            raise ValueError("relative path too long")

        # Rule 4 \u2014 explicitly reject absolute paths and drive prefixes
        # BEFORE the join. Without this, ``Path("/") / "/etc"`` collapses
        # to ``/etc`` and bypasses the prefix check on some Pythons.
        if rel_str.startswith(("/", "\\")):
            raise ValueError("absolute paths are not allowed")
        # Windows drive prefix or UNC. ``Path(rel).is_absolute()`` catches
        # both but we also check the first segment for an explicit drive
        # letter so that e.g. ``C:relative`` (drive-relative) is rejected.
        first_segment = re.split(r"[/\\]", rel_str, maxsplit=1)[0]
        if re.match(r"^[A-Za-z]:", first_segment):
            raise ValueError("Windows drive prefix is not allowed")
        try:
            if Path(rel_str).is_absolute():
                raise ValueError("absolute paths are not allowed")
        except (OSError, ValueError) as exc:
            # ``is_absolute`` can throw on malformed UNC etc. \u2014 treat as
            # rejection.
            if isinstance(exc, ValueError):
                raise
            raise ValueError("malformed path") from exc

        # Reject ``..`` segments explicitly. ``resolve()`` would also
        # neutralise them but checking first gives a clearer error and
        # avoids any platform-specific resolver weirdness on non-existent
        # paths.
        normalized_segments = re.split(r"[/\\]+", rel_str)
        if any(seg == ".." for seg in normalized_segments):
            raise ValueError("relative path may not contain '..' segments")

        root_resolved = self.root.resolve(strict=False)
        try:
            target = (self.root / rel_str).resolve(strict=False)
        except (OSError, RuntimeError) as exc:
            # Symlink loops or otherwise unresolvable paths.
            raise ValueError("path could not be resolved") from exc

        # Rule 5 \u2014 ``is_relative_to`` is the strict containment check
        # available from Python 3.9+. Project requires Python 3.10+
        # (per CLAUDE.md) so we can rely on it.
        if not target.is_relative_to(root_resolved):
            raise ValueError("path escapes storage root")

        # Rule 6 \u2014 refuse to write through an existing symlink.
        # ``Path.is_symlink`` does NOT follow the link, which is exactly
        # what we want.
        if target.is_symlink():
            raise ValueError("target path is a symbolic link")

        return target

    def _sanitize_filename(self, filename: str) -> str:
        """Sanitise a filename for safe disk + URL use (spec/04 V04-B/C).

        Defence layers:
          * Drop control characters and Windows-reserved metacharacters
            (``/ \\ : * ? " < > |``).
          * Strip path-traversal sequences (``..``) and directory
            separators \u2014 a filename must not span directories.
          * Preserve Unicode letters & digits (Chinese / Japanese /
            Korean / emoji-free names all survive).
          * Cap the resulting length at ``_MAX_FILENAME_LENGTH`` to fit
            common filesystem name limits.
          * Rewrite dangerous executable / script extensions
            (``.html``, ``.svg``, ``.js``, ``.php``, ``.sh`` etc.) to
            ``.txt`` so the download path cannot serve a malicious
            content-type by inferring from extension. The
            ``storage_files_router`` adds a second layer that forces
            ``Content-Disposition: attachment`` for any residual
            dangerous extension that escaped this rewrite (e.g. legacy
            files written before this code shipped).
          * Reject Windows-reserved device names like ``CON``/``NUL``.

        Args:
            filename: User-supplied filename. May be ``None`` (legacy
                callers) \u2014 treated as ``"unnamed_file"``.

        Returns:
            A non-empty sanitised filename suitable for use as the
            on-disk basename.
        """
        if not filename:
            return "unnamed_file"

        name = str(filename)

        # Unicode normalize to NFC so visually-identical names map to
        # the same byte sequence (defeats homoglyph confusion in path
        # checks downstream).
        import unicodedata
        name = unicodedata.normalize("NFC", name)

        # Remove NUL bytes and other control chars / dangerous chars.
        name = self._UNSAFE_FILENAME_CHARS_RE.sub("_", name)

        # Drop directory traversal sequences explicitly. After the
        # separator replacement above, ".." remains as plain text but we
        # still want it gone to keep the stem clean.
        # Replace runs of "." that would collapse to ``..`` ``..../``.
        name = re.sub(r"\.{2,}", "_", name)

        # Strip leading dots (hidden files on POSIX, also defeats
        # filenames like ``.htaccess`` resolving to a server config).
        name = name.lstrip(".")

        # Replace remaining whitespace runs with single underscores
        # so the resulting filename has no spaces (URL-safer).
        name = re.sub(r"\s+", "_", name)

        # Collapse adjacent underscores for readability.
        name = re.sub(r"_+", "_", name)

        if not name:
            return "unnamed_file"

        # Split stem / extension for the dangerous-ext rewrite. We use
        # the LAST dot only; multi-dot names like ``foo.tar.gz`` will
        # only get their final extension rewritten, which is the
        # intended behaviour.
        if "." in name:
            stem, dot, ext = name.rpartition(".")
            ext_lower = ("." + ext).lower()
            if ext_lower in self._DANGEROUS_EXTENSIONS:
                # Rewrite to .txt so the file is preserved (for audit /
                # forensics) but cannot execute or render. Preserve the
                # original extension as a marker in the stem so admins
                # can see what was uploaded.
                name = f"{stem}_{ext}.txt"
            else:
                # Force the extension itself to lowercase so case-
                # variant attacks like ``EVIL.HTML`` cannot bypass the
                # blacklist on the download side.
                name = f"{stem}{dot}{ext.lower()}"

        # Windows-reserved-name check on the stem only.
        stem_for_check = name.rsplit(".", 1)[0].upper()
        if stem_for_check in self._WINDOWS_RESERVED_BASENAMES:
            name = f"_{name}"

        # Enforce length cap. We truncate the STEM, preserving the
        # extension so MIME inference still works downstream.
        if len(name) > self._MAX_FILENAME_LENGTH:
            if "." in name:
                stem, dot, ext = name.rpartition(".")
                # Keep at most _MAX_FILENAME_LENGTH - len(ext) - 1 chars
                # for the stem.
                keep = max(1, self._MAX_FILENAME_LENGTH - len(ext) - 1)
                name = f"{stem[:keep]}{dot}{ext}"
            else:
                name = name[: self._MAX_FILENAME_LENGTH]

        return name or "unnamed_file"

    def _validate_file_type(self, content_type: str, folder: str) -> bool:
        """Check whether *content_type* is permitted for *folder*."""
        if not content_type:
            return False

        mapping: Dict[str, List[str]] = {
            "video": self.config.allowed_video_types,
            "audio": self.config.allowed_audio_types,
            "image": self.config.allowed_image_types,
            "images": self.config.allowed_image_types,
        }
        allowed = mapping.get(folder)
        if allowed is None:
            # "files" or any unknown folder -- accept anything
            return True
        return content_type in allowed

    def _create_file_info(self, file_path: Path, relative_path: str) -> Dict[str, Any]:
        """Build a material-info dict from a file on disk."""
        stat = file_path.stat()
        content_type, _ = mimetypes.guess_type(str(file_path))
        content_type = content_type or "application/octet-stream"
        name = file_path.name
        name_lower = name.lower()

        file_info: Dict[str, Any] = {
            "id": relative_path,
            "name": name,
            "path": relative_path,
            "url": self._get_file_url(relative_path),
            "size": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
            "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "content_type": content_type,
        }

        # Determine material type
        if content_type.startswith("video/") or any(
            name_lower.endswith(ext) for ext in (".mp4", ".mov", ".avi", ".webm")
        ):
            file_info["type"] = "video"
            # Look for a co-located thumbnail
            thumb_name = f"thumb_{file_path.stem}.jpg"
            thumb_path = file_path.parent / thumb_name
            if thumb_path.exists():
                thumb_rel = str(thumb_path.relative_to(self.root)).replace("\\", "/")
                file_info["thumbnail_url"] = self._get_file_url(thumb_rel)
            else:
                file_info["thumbnail_url"] = file_info["url"]
        elif content_type.startswith("audio/") or any(
            name_lower.endswith(ext) for ext in (".mp3", ".wav", ".m4a", ".aac", ".ogg")
        ):
            file_info["type"] = "audio"
        elif content_type.startswith("image/") or any(
            name_lower.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp")
        ):
            file_info["type"] = "image"
            file_info["thumbnail_url"] = file_info["url"]
        else:
            file_info["type"] = "file"

        return file_info

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def upload_file(
        self,
        file_data: bytes,
        filename: str,
        content_type: str,
        folder: str = "files",
        user_id: str = "anonymous",
        task_id: Optional[str] = None,
        custom_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Upload arbitrary file data to local storage.

        Returns a dict with *success*, *file_url*, *file_path*, *file_size*,
        *content_type*, and *filename*.
        """
        if not file_data:
            return {"success": False, "message": "File data is empty"}

        if len(file_data) > self.config.max_file_size:
            return {
                "success": False,
                "message": f"File exceeds maximum size ({self.config.max_file_size} bytes)",
            }

        if not self._validate_file_type(content_type, folder):
            return {
                "success": False,
                "message": f"File type '{content_type}' is not allowed for folder '{folder}'",
            }

        relative_path = custom_path or self._generate_storage_path(
            filename, folder, user_id, task_id
        )

        try:
            target = self._validate_path(relative_path)
        except ValueError as exc:
            logger.error("Path validation failed", {"error": str(exc)})
            return {"success": False, "message": str(exc)}

        target.parent.mkdir(parents=True, exist_ok=True)

        try:
            async with aiofiles.open(target, "wb") as fp:
                await fp.write(file_data)

            logger.info("File uploaded successfully", {
                "path": relative_path,
                "size": len(file_data),
                "content_type": content_type,
            })

            file_url = self._get_file_url(relative_path)

            return {
                "success": True,
                "file_url": file_url,
                "file_path": relative_path,
                "file_size": len(file_data),
                "content_type": content_type,
                "filename": self._sanitize_filename(filename),
            }
        except Exception as exc:
            logger.error("File write failed", {
                "path": relative_path,
                "error": str(exc),
            })
            return {"success": False, "message": f"File write failed: {exc}"}

    async def upload_audio_file(
        self,
        file_data: bytes,
        filename: str,
        content_type: str,
        user_id: str = "anonymous",
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Upload an audio file (convenience wrapper setting folder='audio')."""
        return await self.upload_file(
            file_data=file_data,
            filename=filename,
            content_type=content_type,
            folder="audio",
            user_id=user_id,
            task_id=task_id,
        )

    async def upload_video_file(
        self,
        file_data: bytes,
        filename: str,
        content_type: str,
        user_id: str = "anonymous",
        task_id: Optional[str] = None,
        generate_thumbnail: bool = True,
    ) -> Dict[str, Any]:
        """Upload a video file, optionally generating a thumbnail and extracting metadata.

        Extra keys in the result: *thumbnail_url*, *duration*, *width*, *height*.
        """
        upload_result = await self.upload_file(
            file_data=file_data,
            filename=filename,
            content_type=content_type,
            folder="video",
            user_id=user_id,
            task_id=task_id,
        )
        if not upload_result["success"]:
            return upload_result

        relative_path = upload_result["file_path"]
        try:
            absolute_path = self._validate_path(relative_path)
        except ValueError:
            return upload_result

        duration: Optional[float] = None
        width: Optional[int] = None
        height: Optional[int] = None
        thumbnail_url: Optional[str] = None

        # --- Extract metadata via ffprobe ---
        try:
            probe_cmd = [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_format", "-show_streams", str(absolute_path),
            ]
            probe_result = subprocess.run(
                probe_cmd, capture_output=True, text=True, timeout=30
            )
            if probe_result.returncode == 0:
                probe_data = json.loads(probe_result.stdout)
                for stream in probe_data.get("streams", []):
                    if stream.get("codec_type") == "video":
                        width = stream.get("width")
                        height = stream.get("height")
                        break
                duration_str = probe_data.get("format", {}).get("duration")
                if duration_str:
                    duration = float(duration_str)
                logger.info("Video metadata extracted", {
                    "duration": duration, "width": width, "height": height,
                })
            else:
                logger.warning("ffprobe failed", {
                    "stderr": probe_result.stderr[:500] if probe_result.stderr else "",
                })
        except FileNotFoundError:
            logger.warning("ffprobe not found -- skipping metadata extraction")
        except Exception as exc:
            logger.warning("Video metadata extraction failed", {"error": str(exc)})

        # --- Generate thumbnail via ffmpeg ---
        if generate_thumbnail and duration is not None:
            try:
                thumb_name = f"thumb_{Path(filename).stem}.jpg"
                thumb_relative = str(
                    Path(relative_path).parent / thumb_name
                ).replace("\\", "/")
                thumb_absolute = self._validate_path(thumb_relative)
                thumb_absolute.parent.mkdir(parents=True, exist_ok=True)

                midpoint = duration / 2 if duration > 2 else min(duration, 1)
                max_width = settings.upload.thumbnail.thumbnail_max_width

                ffmpeg_cmd = [
                    "ffmpeg", "-ss", str(midpoint),
                    "-i", str(absolute_path),
                    "-vframes", "1",
                    "-q:v", str(settings.upload.thumbnail.thumbnail_quality),
                    "-vf", f"scale={max_width}:-1",
                    "-y", str(thumb_absolute),
                ]
                ff_result = subprocess.run(
                    ffmpeg_cmd, capture_output=True, timeout=30
                )
                if ff_result.returncode == 0 and thumb_absolute.exists():
                    thumbnail_url = self._get_file_url(thumb_relative)
                    logger.info("Thumbnail generated", {"thumbnail": thumb_relative})
                else:
                    logger.warning("ffmpeg thumbnail generation failed", {
                        "stderr": ff_result.stderr.decode(errors="replace")[:500]
                            if ff_result.stderr else "",
                    })
            except FileNotFoundError:
                logger.warning("ffmpeg not found -- skipping thumbnail generation")
            except Exception as exc:
                logger.warning("Thumbnail generation failed", {"error": str(exc)})

        upload_result.update({
            "thumbnail_url": thumbnail_url,
            "duration": duration,
            "width": width,
            "height": height,
        })
        return upload_result

    async def write_to_well_known_slot(
        self,
        rel_path: str,
        content: bytes,
        content_type: str,
    ) -> Dict[str, Any]:
        """Write *content* to a caller-specified, opinionated path under the
        storage root, bypassing the date-bucketed layout used by ``upload_file``.

        Used for "well-known slot" artifacts where the caller owns the path
        scheme — e.g. per-project cover PNGs at
        ``projects/<project_id>/cover.png`` that need to overwrite in place
        so a stable URL can be served.

        Sanitisation:
          * The *parent directory* portion of ``rel_path`` is preserved as-is
            (caller's choice), but path-traversal is still blocked via
            ``_validate_path``.
          * The *filename* component is sanitised via ``_sanitize_filename``.
          * The combined relative path is then re-resolved through
            ``_validate_path`` so the final on-disk target stays inside the
            storage root.

        Args:
            rel_path: Relative path inside the storage root, ``parent/.../name``.
            content:  File bytes to write.
            content_type: MIME type used in the result envelope (no
                          allowlist applied — caller has decided).

        Returns:
            ``{success, file_url, file_path, file_size, content_type, filename}``
            on success, ``{success: False, message: str}`` on failure.
        """
        if not content:
            return {"success": False, "message": "File data is empty"}

        if len(content) > self.config.max_file_size:
            return {
                "success": False,
                "message": f"File exceeds maximum size ({self.config.max_file_size} bytes)",
            }

        # Normalise + split rel_path
        rel_norm = rel_path.replace("\\", "/").lstrip("/")
        if not rel_norm or rel_norm.endswith("/"):
            return {"success": False, "message": f"Invalid path: {rel_path}"}

        parts = rel_norm.split("/")
        filename = self._sanitize_filename(parts[-1])
        parent_parts = parts[:-1]
        # Sanitise each parent segment lightly — block ".." / "." / empty
        for segment in parent_parts:
            if segment in ("", ".", "..") or "\0" in segment:
                return {
                    "success": False,
                    "message": f"Invalid path segment: {segment!r}",
                }
        cleaned_rel = "/".join([*parent_parts, filename])

        try:
            target = self._validate_path(cleaned_rel)
        except ValueError as exc:
            logger.error("Path validation failed", {"error": str(exc)})
            return {"success": False, "message": str(exc)}

        target.parent.mkdir(parents=True, exist_ok=True)

        try:
            async with aiofiles.open(target, "wb") as fp:
                await fp.write(content)

            logger.info("File written to well-known slot", {
                "path": cleaned_rel,
                "size": len(content),
                "content_type": content_type,
            })

            return {
                "success": True,
                "file_url": self._get_file_url(cleaned_rel),
                "file_path": cleaned_rel,
                "file_size": len(content),
                "content_type": content_type,
                "filename": filename,
            }
        except Exception as exc:
            logger.error("File write failed", {
                "path": cleaned_rel,
                "error": str(exc),
            })
            return {"success": False, "message": f"File write failed: {exc}"}

    async def delete_file(self, file_path: str) -> Dict[str, Any]:
        """Delete a file from local storage.

        Args:
            file_path: Relative path inside the storage root.
        """
        try:
            target = self._validate_path(file_path)
        except ValueError as exc:
            logger.error("Delete path validation failed", {"error": str(exc)})
            return {"success": False, "message": str(exc)}

        if not target.exists():
            return {"success": False, "message": f"File not found: {file_path}"}

        if not target.is_file():
            return {"success": False, "message": f"Not a file: {file_path}"}

        try:
            target.unlink()
            logger.info("File deleted", {"path": file_path})
            return {"success": True, "message": "File deleted successfully"}
        except Exception as exc:
            logger.error("File deletion failed", {
                "path": file_path, "error": str(exc),
            })
            return {"success": False, "message": f"Deletion failed: {exc}"}

    async def list_user_materials(
        self,
        user_id: str,
        material_type: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
        dedupe: bool = True,
    ) -> Dict[str, Any]:
        """List materials belonging to *user_id*, with pagination.

        Walks the storage root searching for ``user_{user_id}`` directories
        and collects file information.

        When *dedupe* is True (default, iter5), entries with the same
        ``(name, size)`` are collapsed to the newest one — fixes the duplicate
        reference-image rows users see after the same file is uploaded under
        multiple task subdirectories.
        """
        user_prefix = f"user_{user_id}"
        all_files: List[Dict[str, Any]] = []

        folders_to_scan: List[str] = []
        if material_type == "video" or material_type is None:
            folders_to_scan.append("video")
        if material_type == "audio" or material_type is None:
            folders_to_scan.append("audio")
        if material_type == "image" or material_type is None:
            folders_to_scan.extend(["image", "images"])
        if material_type is None:
            folders_to_scan.append("files")

        for folder in folders_to_scan:
            folder_path = self.root / folder
            if not folder_path.exists():
                continue
            for dirpath, _dirnames, filenames in os.walk(folder_path):
                dirpath_obj = Path(dirpath)
                # Only collect files inside a matching user directory
                if user_prefix not in dirpath_obj.parts:
                    continue
                for fname in filenames:
                    fpath = dirpath_obj / fname
                    try:
                        relative = str(fpath.relative_to(self.root)).replace("\\", "/")
                        info = self._create_file_info(fpath, relative)
                        if material_type is None or info["type"] == material_type:
                            all_files.append(info)
                    except Exception as exc:
                        logger.warning("Failed to read file info", {
                            "file": str(fpath), "error": str(exc),
                        })

        # Sort newest first
        all_files.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        # iter5: dedupe by (name, size) keeping the newest copy.
        if dedupe:
            seen: set = set()
            unique: List[Dict[str, Any]] = []
            for f in all_files:
                try:
                    key = (f.get("name", ""), int(f.get("size", 0) or 0))
                except (TypeError, ValueError):
                    key = (f.get("name", ""), 0)
                if key in seen:
                    continue
                seen.add(key)
                unique.append(f)
            removed = len(all_files) - len(unique)
            if removed > 0:
                logger.info("User materials deduped", {
                    "user_id": user_id,
                    "removed": removed,
                    "kept": len(unique),
                })
            all_files = unique

        total = len(all_files)
        total_pages = (total + page_size - 1) // page_size if total > 0 else 0
        start = (page - 1) * page_size
        end = start + page_size
        materials = all_files[start:end]

        logger.info("User materials listed", {
            "user_id": user_id,
            "total": total,
            "page": page,
            "returned": len(materials),
        })

        return {
            "success": True,
            "materials": materials,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    def health_check(self) -> Dict[str, Any]:
        """Check storage directory availability and disk space."""
        root_resolved = self.root.resolve()
        if not root_resolved.exists():
            return {
                "service": "LocalStorage",
                "status": "unhealthy",
                "message": f"Storage root does not exist: {root_resolved}",
            }

        try:
            usage = shutil.disk_usage(str(root_resolved))
            return {
                "service": "LocalStorage",
                "status": "healthy",
                "root": str(root_resolved),
                "disk_total_gb": round(usage.total / (1024 ** 3), 2),
                "disk_used_gb": round(usage.used / (1024 ** 3), 2),
                "disk_free_gb": round(usage.free / (1024 ** 3), 2),
                "message": "Storage service is healthy",
            }
        except Exception as exc:
            return {
                "service": "LocalStorage",
                "status": "unhealthy",
                "message": f"Disk usage check failed: {exc}",
            }


# Module-level singleton
storage_service = StorageService()
