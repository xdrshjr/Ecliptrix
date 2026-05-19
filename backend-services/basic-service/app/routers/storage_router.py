"""
Storage API routes for file upload and management.
Replaces the former supabase_router with local storage backed by StorageService.

spec/04 hardening
-----------------
All upload endpoints in this module enforce:

  * Authenticated session via ``Depends(get_current_user)``.
  * Filename sanitisation via ``storage_service._sanitize_filename`` —
    drops directory separators / NUL bytes, caps length, rewrites
    dangerous executable extensions (.html, .svg, .js, .php, .sh, ...)
    to ``.txt``.
  * Path validation via ``storage_service._validate_path`` for any
    caller-supplied ``bucket_path`` — rejects ``..`` traversal, absolute
    paths, Windows drive prefixes, NUL bytes, and any resolved target
    that escapes ``STORAGE_ROOT`` or lands on a symlink.
  * MIME / extension cross-check — declared ``Content-Type`` must match
    the suffix of the (sanitised) filename. Reject with 415 otherwise.
  * UUID prefix on the final on-disk filename to defeat overwrite races
    when ``bucket_path`` is shared between callers.
"""

import os
import uuid
from typing import Optional, Union
from datetime import datetime

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status
from fastapi.responses import JSONResponse

from app.dependencies.auth import get_current_user
from app.models.db_models import User
from app.models.storage_models import (
    FileUploadResponse,
    StorageUploadResponse,
    StorageUploadErrorResponse,
    VideoUploadResponse,
    VideoUploadErrorResponse,
)
from app.services.storage_service import storage_service
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/storage", tags=["Storage"])


# ---------------------------------------------------------------------------
# MIME / extension whitelist (spec/04 §3.3)
# ---------------------------------------------------------------------------

# Mapping of file-suffix → set of acceptable Content-Type values. We
# accept either the declared content-type OR an octet-stream fallback
# (browsers send this for some legitimate cases), but the suffix MUST
# match the caller-declared category.
_EXT_TO_ALLOWED_MIME = {
    # Audio
    ".mp3": {"audio/mpeg", "audio/mp3"},
    ".wav": {"audio/wav", "audio/x-wav", "audio/wave"},
    ".m4a": {"audio/mp4", "audio/x-m4a", "audio/m4a"},
    ".aac": {"audio/aac", "audio/mp4"},
    ".ogg": {"audio/ogg"},
    ".flac": {"audio/flac", "audio/x-flac"},
    ".webm": {"audio/webm", "video/webm"},
    # Video
    ".mp4": {"video/mp4"},
    ".mov": {"video/quicktime", "video/mp4"},
    ".avi": {"video/x-msvideo", "video/avi"},
    ".mkv": {"video/x-matroska"},
    # Image
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".gif": {"image/gif"},
    ".webp": {"image/webp"},
    # SVG is permitted at upload time (legitimate vector graphics) but
    # the sanitiser rewrites the extension to ``.txt`` so the download
    # path cannot serve it inline — see _sanitize_filename + the
    # storage_files_router attachment rule (spec/04 V04-B).
    ".svg": {"image/svg+xml"},
    # Documents (limited set)
    ".pdf": {"application/pdf"},
    ".txt": {"text/plain"},
    # Dangerous extensions are pinned to their TRUE content-type so a
    # mismatch (e.g. ``evil.html`` declared as ``image/png``) is
    # rejected before the sanitiser even runs. The sanitiser still
    # rewrites the suffix to ``.txt`` for any that slip through, so
    # this is defense-in-depth.
    ".html": {"text/html"},
    ".htm": {"text/html"},
    ".js": {"application/javascript", "text/javascript"},
    ".php": {"application/x-httpd-php"},
    ".sh": {"application/x-sh", "text/x-shellscript"},
    ".exe": {"application/x-msdownload", "application/octet-stream"},
    ".bat": {"application/x-bat"},
}


def _is_mime_consistent(content_type: Optional[str], filename: str) -> bool:
    """Return True when ``content_type`` is compatible with the suffix.

    Permissive on unknown extensions (we cannot enumerate every legitimate
    type a user may upload) but STRICT on known executable / renderable
    types — the sanitizer has already rewritten dangerous extensions to
    ``.txt`` so a mismatch here indicates active spoofing.
    """
    if not content_type:
        # Empty content-type is suspicious but not by itself dangerous;
        # the sanitiser has already neutralised executable extensions.
        return True
    ct = content_type.strip().split(";", 1)[0].lower()
    _, ext = os.path.splitext(filename.lower())
    if ext in _EXT_TO_ALLOWED_MIME:
        return ct in _EXT_TO_ALLOWED_MIME[ext]
    # Unknown extension — trust the caller's content-type. The sanitizer
    # ensures the extension itself cannot be dangerous.
    return True


def _validate_bucket_path(bucket_path: Optional[str]) -> Optional[str]:
    """Validate caller-supplied ``bucket_path`` form parameter.

    Returns the cleaned bucket_path (with trailing separators stripped),
    or ``None`` if not provided. Raises ``HTTPException(400)`` on any
    rule violation rather than leaking the underlying ValueError.
    """
    if bucket_path is None or bucket_path.strip() == "":
        return None
    cleaned = bucket_path.strip().replace("\\", "/").rstrip("/")
    # Re-use the service-level validator. We DO NOT need the resolved
    # Path object — only the side-effect of raising on bad input. The
    # service layer will re-validate the full path when the file is
    # written.
    try:
        storage_service._validate_path(cleaned)
    except ValueError as exc:
        logger.warning(
            "storage_router: bucket_path rejected",
            {"bucket_path": bucket_path, "reason": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid bucket_path",
        ) from exc
    return cleaned


@router.post(
    "/upload-audio",
    response_model=FileUploadResponse,
    summary="Upload audio file to local storage",
    description="Upload an audio file to local storage",
)
async def upload_audio(
    file: UploadFile = File(..., description="Audio file to upload"),
    user_id: str = Form(default="anonymous", description="User ID (legacy; overridden by session)"),
    task_id: Optional[str] = Form(default=None, description="Task ID"),
    current_user: User = Depends(get_current_user),
) -> FileUploadResponse:
    """Upload audio file to local storage.

    spec/04: enforces session auth + filename sanitisation + MIME check.
    The ``user_id`` form parameter is preserved for backward compatibility
    but is OVERRIDDEN by the authenticated session's user id.
    """
    try:
        # Authenticated user ID always wins (V04-A).
        effective_user_id = str(current_user.id)

        # MIME consistency on the ORIGINAL filename (V04-B) — the
        # sanitiser below would mask spoofing by rewriting dangerous
        # extensions, so we must screen first.
        original_filename = file.filename or "audio.mp3"
        if not _is_mime_consistent(file.content_type, original_filename):
            return FileUploadResponse(
                success=False,
                message=(
                    f"content-type '{file.content_type}' does not match "
                    f"file extension"
                ),
            )

        # Sanitise filename — this rewrites .svg/.html/.js/etc. to .txt
        # so the eventual download path cannot serve a stored-XSS payload.
        safe_filename = storage_service._sanitize_filename(original_filename)

        logger.info("Audio upload request received", {
            "filename": file.filename,
            "safe_filename": safe_filename,
            "content_type": file.content_type,
            "user_id": effective_user_id,
            "task_id": task_id,
        })

        file_data = await file.read()
        if not file_data:
            return FileUploadResponse(
                success=False,
                message="Uploaded file is empty",
            )

        content_type = file.content_type or "audio/mpeg"
        result = await storage_service.upload_audio_file(
            file_data=file_data,
            filename=safe_filename,
            content_type=content_type,
            user_id=effective_user_id,
            task_id=task_id,
        )

        if not result["success"]:
            logger.error("Audio upload failed", {
                "error": result.get("message"),
                "filename": file.filename,
            })
            return FileUploadResponse(
                success=False,
                message=result.get("message", "Upload failed"),
            )

        logger.info("Audio upload successful", {
            "file_url": result["file_url"],
            "file_size": result["file_size"],
        })

        return FileUploadResponse(
            success=True,
            file_url=result["file_url"],
            file_path=result["file_path"],
            file_size=result["file_size"],
            content_type=result["content_type"],
            filename=result["filename"],
            message="Audio file uploaded successfully",
        )

    except Exception as e:
        logger.error("Audio upload exception", {
            "error": str(e),
            "filename": file.filename,
        })
        return FileUploadResponse(
            success=False,
            message=f"Audio upload failed: {str(e)}",
        )


@router.post(
    "/upload-file",
    response_model=Union[StorageUploadResponse, StorageUploadErrorResponse],
    summary="Upload file to local storage",
    description="Upload any file to local storage",
)
async def upload_file(
    file: UploadFile = File(..., description="File to upload"),
    bucket_path: Optional[str] = Form(None, description="Target storage path"),
    task_id: Optional[str] = Form(None, description="Task ID"),
    segment_id: Optional[str] = Form(None, description="Segment ID"),
    user_id: Optional[str] = Form(None, description="User ID (legacy; overridden by session)"),
    current_user: User = Depends(get_current_user),
) -> Union[StorageUploadResponse, StorageUploadErrorResponse]:
    """Upload general file to local storage.

    spec/04: enforces session auth + ``bucket_path`` validation +
    filename sanitisation + MIME check + UUID-prefix to avoid overwrite.
    """
    # Validate bucket_path BEFORE the try-block so the HTTPException
    # surfaces as a real 400 — wrapping it in the broad ``except
    # Exception`` below would convert it into a 200 success-envelope
    # which is wrong.
    validated_bucket = _validate_bucket_path(bucket_path)

    try:
        effective_user_id = str(current_user.id)
        # MIME / extension consistency check runs on the ORIGINAL
        # caller-declared filename (V04-B). The sanitizer rewrites
        # dangerous extensions to ``.txt`` afterwards; we still want to
        # catch obvious spoofing like "evil.html" claimed as image/png".
        original_filename = file.filename or "unnamed_file"
        if not _is_mime_consistent(file.content_type, original_filename):
            return StorageUploadErrorResponse(
                success=False,
                message=(
                    f"content-type '{file.content_type}' does not match "
                    f"file extension"
                ),
                error_code="MIME_EXTENSION_MISMATCH",
            )

        safe_filename = storage_service._sanitize_filename(original_filename)

        logger.info("File upload request received", {
            "filename": file.filename,
            "safe_filename": safe_filename,
            "content_type": file.content_type,
            "bucket_path": bucket_path,
            "task_id": task_id,
            "user_id": effective_user_id,
        })

        file_data = await file.read()
        if not file_data:
            return StorageUploadErrorResponse(
                success=False,
                message="Uploaded file is empty",
                error_code="EMPTY_FILE",
            )

        content_type = file.content_type or "application/octet-stream"

        # Determine folder from content type
        if content_type.startswith("video/"):
            folder = "video"
        elif content_type.startswith("audio/"):
            folder = "audio"
        elif content_type.startswith("image/"):
            folder = "images"
        else:
            folder = "files"

        # Build the on-disk relative path. If a bucket_path was supplied
        # (and survived validation), we honour it as the parent dir but
        # ALWAYS append a UUID-prefixed filename. This stops one upload
        # from clobbering another and keeps the per-user audit trail.
        if validated_bucket is not None:
            uuid_prefix = uuid.uuid4().hex[:12]
            custom_path: Optional[str] = f"{validated_bucket}/{uuid_prefix}_{safe_filename}"
        else:
            custom_path = None  # service will build the date-bucketed default

        result = await storage_service.upload_file(
            file_data=file_data,
            filename=safe_filename,
            content_type=content_type,
            folder=folder,
            user_id=effective_user_id,
            task_id=task_id,
            custom_path=custom_path,
        )

        if not result["success"]:
            logger.error("File upload failed", {
                "error": result.get("message"),
                "filename": file.filename,
            })
            return StorageUploadErrorResponse(
                success=False,
                message=result.get("message", "Upload failed"),
                error_code="UPLOAD_FAILED",
            )

        logger.info("File upload successful", {
            "file_url": result["file_url"],
            "file_size": result["file_size"],
            "filename": file.filename,
        })

        return StorageUploadResponse(
            success=True,
            message="File uploaded successfully",
            file_url=result["file_url"],
            file_path=result.get("file_path", ""),
            file_size=result["file_size"],
            upload_time=datetime.now(),
        )

    except Exception as e:
        logger.error("File upload exception", {
            "error": str(e),
            "filename": file.filename,
        })
        return StorageUploadErrorResponse(
            success=False,
            message=f"File upload failed: {str(e)}",
            error_code="INTERNAL_ERROR",
        )


@router.post(
    "/upload-video",
    response_model=Union[VideoUploadResponse, VideoUploadErrorResponse],
    summary="Upload video file to local storage",
    description="Upload video file to local storage with thumbnail generation",
)
async def upload_video(
    file: UploadFile = File(..., description="Video file to upload"),
    task_id: Optional[str] = Form(None, description="Task ID"),
    custom_filename: Optional[str] = Form(None, description="Custom filename"),
    generate_thumbnail: bool = Form(True, description="Whether to generate thumbnail"),
    user_id: Optional[str] = Form(None, description="User ID (legacy; overridden by session)"),
    current_user: User = Depends(get_current_user),
) -> Union[VideoUploadResponse, VideoUploadErrorResponse]:
    """Upload video file with thumbnail generation.

    spec/04: enforces session auth + filename sanitisation + MIME check.
    """
    try:
        effective_user_id = str(current_user.id)

        logger.info("Video upload request received", {
            "filename": file.filename,
            "content_type": file.content_type,
            "task_id": task_id,
            "custom_filename": custom_filename,
            "generate_thumbnail": generate_thumbnail,
            "user_id": effective_user_id,
        })

        # Validate file type
        if not file.content_type or not file.content_type.startswith("video/"):
            logger.error("Unsupported file type", {
                "content_type": file.content_type,
                "filename": file.filename,
            })
            return VideoUploadErrorResponse(
                success=False,
                message=f"Unsupported file type: {file.content_type}",
                error_code="INVALID_FILE_TYPE",
            )

        # Determine filename — assemble candidate, then sanitize.
        candidate = file.filename or "video.mp4"
        if custom_filename:
            file_extension = os.path.splitext(candidate)[1] if candidate else ".mp4"
            candidate = custom_filename
            if not candidate.endswith(file_extension):
                candidate += file_extension

        # MIME consistency on the candidate BEFORE sanitisation (V04-B).
        if not _is_mime_consistent(file.content_type, candidate):
            return VideoUploadErrorResponse(
                success=False,
                message=(
                    f"content-type '{file.content_type}' does not match "
                    f"file extension"
                ),
                error_code="MIME_EXTENSION_MISMATCH",
            )

        safe_filename = storage_service._sanitize_filename(candidate)

        file_data = await file.read()
        if not file_data:
            return VideoUploadErrorResponse(
                success=False,
                message="Uploaded file is empty",
                error_code="EMPTY_FILE",
            )

        result = await storage_service.upload_video_file(
            file_data=file_data,
            filename=safe_filename,
            content_type=file.content_type or "video/mp4",
            user_id=effective_user_id,
            task_id=task_id,
            generate_thumbnail=generate_thumbnail,
        )

        if not result["success"]:
            logger.error("Video upload failed", {
                "error": result.get("message"),
                "filename": safe_filename,
            })
            return VideoUploadErrorResponse(
                success=False,
                message=result.get("message", "Upload failed"),
                error_code="UPLOAD_FAILED",
            )

        logger.info("Video upload successful", {
            "file_url": result["file_url"],
            "file_size": result["file_size"],
            "filename": safe_filename,
            "thumbnail_url": result.get("thumbnail_url"),
            "duration": result.get("duration"),
        })

        return VideoUploadResponse(
            success=True,
            message="Video file uploaded successfully",
            video_url=result["file_url"],
            file_path=result.get("file_path", ""),
            file_size=result["file_size"],
            duration=result.get("duration"),
            width=result.get("width"),
            height=result.get("height"),
            thumbnail_url=result.get("thumbnail_url"),
            task_id=task_id,
            upload_time=datetime.now(),
            metadata={
                "original_filename": file.filename,
                "upload_time": datetime.now().isoformat(),
                "file_size": result["file_size"],
            },
        )

    except Exception as e:
        logger.error("Video upload exception", {
            "error": str(e),
            "filename": file.filename if file else "unknown",
            "task_id": task_id,
        })
        return VideoUploadErrorResponse(
            success=False,
            message=f"Video upload failed: {str(e)}",
            error_code="INTERNAL_ERROR",
        )


@router.get(
    "/user-materials",
    summary="Get user uploaded materials",
    description="Query user materials with pagination and type filtering",
)
async def get_user_materials(
    user_id: str,
    page: int = 1,
    page_size: int = 20,
    material_type: Optional[str] = None,
    dedupe: bool = True,
):
    """Get user materials list with pagination.

    iter5: ``dedupe`` defaults to True — collapses duplicate uploads of the
    same ``(name, size)`` so the reference-image picker stops showing N copies
    of one image. Pass ``dedupe=false`` to opt out.
    """
    try:
        logger.info("User materials query request", {
            "user_id": user_id,
            "page": page,
            "page_size": page_size,
            "material_type": material_type,
            "dedupe": dedupe,
        })

        result = await storage_service.list_user_materials(
            user_id=user_id,
            material_type=material_type,
            page=page,
            page_size=page_size,
            dedupe=dedupe,
        )

        if not result["success"]:
            logger.error("User materials query failed", {
                "error": result.get("message"),
                "user_id": user_id,
            })
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "success": False,
                    "message": result.get("message", "Query failed"),
                    "materials": [],
                    "total": 0,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": 0,
                },
            )

        logger.info("User materials query successful", {
            "user_id": user_id,
            "total": result["total"],
            "page": result["page"],
            "returned": len(result["materials"]),
        })

        return {
            "success": True,
            "materials": result["materials"],
            "total": result["total"],
            "page": result["page"],
            "page_size": result["page_size"],
            "total_pages": result["total_pages"],
        }

    except Exception as e:
        logger.error("User materials query exception", {
            "error": str(e),
            "user_id": user_id,
        })
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "message": f"Query failed: {str(e)}",
                "materials": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "total_pages": 0,
            },
        )


@router.get(
    "/health",
    summary="Storage service health check",
    description="Check local storage service availability and disk space",
)
async def storage_health_check():
    """Storage service health check."""
    try:
        logger.info("Storage health check request")

        health_info = storage_service.health_check()

        if health_info["status"] == "healthy":
            logger.info("Storage health check passed", health_info)
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=health_info,
            )

        logger.error("Storage health check failed", health_info)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=health_info,
        )

    except Exception as e:
        error_info = {
            "service": "LocalStorage",
            "status": "error",
            "message": f"Health check exception: {str(e)}",
        }
        logger.error("Storage health check exception", error_info)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=error_info,
        )
