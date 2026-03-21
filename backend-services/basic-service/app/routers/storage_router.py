"""
Storage API routes for file upload and management.
Replaces the former supabase_router with local storage backed by StorageService.
"""

import os
from typing import Optional, Union
from datetime import datetime

from fastapi import APIRouter, UploadFile, File, Form, status
from fastapi.responses import JSONResponse

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


@router.post(
    "/upload-audio",
    response_model=FileUploadResponse,
    summary="Upload audio file to local storage",
    description="Upload an audio file to local storage",
)
async def upload_audio(
    file: UploadFile = File(..., description="Audio file to upload"),
    user_id: str = Form(default="anonymous", description="User ID"),
    task_id: Optional[str] = Form(default=None, description="Task ID"),
) -> FileUploadResponse:
    """Upload audio file to local storage."""
    try:
        logger.info("Audio upload request received", {
            "filename": file.filename,
            "content_type": file.content_type,
            "user_id": user_id,
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
            filename=file.filename or "audio.mp3",
            content_type=content_type,
            user_id=user_id,
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
    user_id: Optional[str] = Form(None, description="User ID"),
) -> Union[StorageUploadResponse, StorageUploadErrorResponse]:
    """Upload general file to local storage."""
    try:
        logger.info("File upload request received", {
            "filename": file.filename,
            "content_type": file.content_type,
            "bucket_path": bucket_path,
            "task_id": task_id,
            "user_id": user_id,
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

        result = await storage_service.upload_file(
            file_data=file_data,
            filename=file.filename or "unnamed_file",
            content_type=content_type,
            folder=folder,
            user_id=user_id or "anonymous",
            task_id=task_id,
            custom_path=bucket_path,
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
    user_id: Optional[str] = Form(None, description="User ID"),
) -> Union[VideoUploadResponse, VideoUploadErrorResponse]:
    """Upload video file with thumbnail generation."""
    try:
        logger.info("Video upload request received", {
            "filename": file.filename,
            "content_type": file.content_type,
            "task_id": task_id,
            "custom_filename": custom_filename,
            "generate_thumbnail": generate_thumbnail,
            "user_id": user_id,
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

        file_data = await file.read()
        if not file_data:
            return VideoUploadErrorResponse(
                success=False,
                message="Uploaded file is empty",
                error_code="EMPTY_FILE",
            )

        # Determine filename
        filename = file.filename or "video.mp4"
        if custom_filename:
            file_extension = os.path.splitext(filename)[1] if filename else ".mp4"
            filename = custom_filename
            if not filename.endswith(file_extension):
                filename += file_extension

        result = await storage_service.upload_video_file(
            file_data=file_data,
            filename=filename,
            content_type=file.content_type or "video/mp4",
            user_id=user_id or "anonymous",
            task_id=task_id,
            generate_thumbnail=generate_thumbnail,
        )

        if not result["success"]:
            logger.error("Video upload failed", {
                "error": result.get("message"),
                "filename": filename,
            })
            return VideoUploadErrorResponse(
                success=False,
                message=result.get("message", "Upload failed"),
                error_code="UPLOAD_FAILED",
            )

        logger.info("Video upload successful", {
            "file_url": result["file_url"],
            "file_size": result["file_size"],
            "filename": filename,
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
):
    """Get user materials list with pagination."""
    try:
        logger.info("User materials query request", {
            "user_id": user_id,
            "page": page,
            "page_size": page_size,
            "material_type": material_type,
        })

        result = await storage_service.list_user_materials(
            user_id=user_id,
            material_type=material_type,
            page=page,
            page_size=page_size,
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
