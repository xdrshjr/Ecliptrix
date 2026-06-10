"""
Storage service Pydantic models for file upload and management.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class FileUploadResponse(BaseModel):
    """File upload response model."""
    success: bool
    file_url: str = ""
    file_path: str = ""
    file_size: int = 0
    content_type: str = ""
    filename: str = ""
    message: str = ""


class VideoUploadResponse(BaseModel):
    """Video upload response model with metadata."""
    success: bool
    message: str = ""
    video_url: str = ""
    file_path: str = ""
    file_size: int = 0
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    thumbnail_url: Optional[str] = None
    task_id: Optional[str] = None
    upload_time: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


class VideoUploadErrorResponse(BaseModel):
    """Error response model for video upload failures."""
    success: bool = Field(False, description="Always false for error responses")
    message: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(None, description="Error code")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")


class StorageUploadResponse(BaseModel):
    """General storage upload response model."""
    success: bool = Field(..., description="Whether the upload was successful")
    message: str = Field(..., description="Response message")
    file_url: Optional[str] = Field(None, description="Public URL of the uploaded file")
    file_path: Optional[str] = Field(None, description="Path in storage")
    file_size: Optional[int] = Field(None, description="Size of the uploaded file in bytes")
    upload_time: Optional[datetime] = Field(None, description="Time when the file was uploaded")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class StorageUploadErrorResponse(BaseModel):
    """Error response model for storage upload failures."""
    success: bool = Field(False, description="Always false for error responses")
    message: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(None, description="Error code")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")


class MaterialItem(BaseModel):
    """Material item model."""
    filename: str = ""
    file_url: str = ""
    thumbnail_url: Optional[str] = None
    file_size: int = 0
    content_type: str = ""
    material_type: str = ""
    created_at: str = ""
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None


class UserMaterialsResponse(BaseModel):
    """User materials list response model."""
    success: bool
    total: int = 0
    page: int = 1
    page_size: int = 20
    total_pages: int = 0
    materials: List[Dict[str, Any]] = []
    message: str = ""


# ---------------------------------------------------------------------------
# Local filmstrip thumbnails (local-video-editing-refactor spec 03)
# ---------------------------------------------------------------------------

class ThumbnailFrameResponse(BaseModel):
    """Response for ``POST /storage/thumbnail-frame``.

    Returned after persisting one frontend-extracted filmstrip frame under
    ``static/video/thumbnails/{material_id}/strip_{zoom_tier}_{t_ms}.jpg``.
    """
    success: bool
    url: str = Field("", description="Same-origin /api/storage/files URL of the frame")
    relative_path: str = Field("", description="Storage-relative path of the frame")
    message: str = Field("", description="Error message when success is false")


class ThumbnailFrameItem(BaseModel):
    """One persisted filmstrip frame in a material listing."""
    zoom_tier: str = Field(..., description="Quantized zoom tier label, e.g. '1x'")
    t_ms: int = Field(..., description="Source frame time in whole milliseconds")
    url: str = Field(..., description="Same-origin /api/storage/files URL")


class MaterialThumbnailsResponse(BaseModel):
    """Response for ``GET /storage/thumbnails/{material_id}``.

    Lists the persisted poster and filmstrip frames for a material so the
    frontend cache can pre-warm and spec 06 can audit derived files.
    """
    success: bool = True
    poster: Optional[str] = Field(None, description="Same-origin poster URL, if any")
    frames: List[ThumbnailFrameItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Local audio waveform (local-video-editing-refactor spec 04)
#
# REST surface uses snake_case (project Pydantic convention), matching the
# thumbnail endpoints above and never overlapping them. The PERSISTED peaks
# JSON instead uses camelCase and is built by WaveformService directly — these
# models never touch the on-disk schema.
# ---------------------------------------------------------------------------

class WaveformGenerateRequest(BaseModel):
    """Request body for ``POST /storage/waveform/generate``."""
    material_id: str = Field(..., description="Material identifier (filename-safe)")
    audio_url: str = Field(
        ...,
        description=(
            "Same-origin /api/storage/files reference (or storage-relative "
            "path) to the source audio / audio-bearing video."
        ),
    )
    force: bool = Field(
        default=False,
        description="When true, re-extract even if a waveform already exists.",
    )


class WaveformGenerateResponse(BaseModel):
    """Response for ``POST /storage/waveform/generate`` (idempotent)."""
    status: str = Field(..., description="'ready' | 'pending' | 'failed'")
    url: Optional[str] = Field(
        None, description="Same-origin URL of the persisted peaks JSON."
    )


class WaveformDataResponse(BaseModel):
    """Response for ``GET /storage/waveform/{material_id}``.

    Carries the peaks inline when ready so the frontend renders in a single
    round-trip; ``status`` distinguishes ready / pending / missing / failed.
    """
    status: str = Field(..., description="'ready' | 'pending' | 'missing' | 'failed'")
    duration_sec: Optional[float] = Field(
        None, description="Source media duration in seconds."
    )
    peaks_per_second: Optional[int] = Field(
        None, description="Peaks-per-second resolution of the array."
    )
    peaks: Optional[List[float]] = Field(
        None, description="Normalized (0..1) amplitude peaks."
    )
    url: Optional[str] = Field(
        None, description="Same-origin URL of the persisted peaks JSON."
    )


# ---------------------------------------------------------------------------
# Material delete-联动 + orphan reclaim (local-video-editing-refactor spec 06)
# ---------------------------------------------------------------------------


class MaterialDeleteDeleted(BaseModel):
    """The per-target outcome of a material delete cascade."""
    source: bool = Field(False, description="Whether the source file was removed")
    thumbnails: int = Field(
        0, description="Number of thumbnail frames removed across all keys"
    )
    waveform: bool = Field(False, description="Whether the waveform JSON was removed")


class MaterialDeleteResponse(BaseModel):
    """Response for ``DELETE /storage/material/{material_id}`` (spec 06)."""
    success: bool = True
    deleted: MaterialDeleteDeleted = Field(default_factory=MaterialDeleteDeleted)
    message: str = Field("", description="Error message when success is false")


class ReclaimOrphansRequest(BaseModel):
    """Body for ``POST /storage/reclaim-orphans`` (spec 06).

    The frontend supplies the referenced key set (material library ∪ every
    key referenced by a local project). An EMPTY set makes the backend SKIP
    reclaim entirely (safety threshold) rather than mass-delete.
    """
    referenced_material_ids: List[str] = Field(
        default_factory=list,
        description="Material keys still in use (live library ∪ project refs).",
    )
    dry_run: bool = Field(
        False, description="When true, log intended deletions without deleting."
    )


class ReclaimOrphansReport(BaseModel):
    """The counts returned by an orphan-reclaim pass."""
    dirs: int = Field(0, description="Thumbnail directories reclaimed")
    files: int = Field(0, description="Waveform files reclaimed")
    bytes: int = Field(0, description="Total bytes reclaimed")
    skipped: bool = Field(
        False, description="True when skipped due to an empty/abnormal ref set"
    )
    dry_run: bool = Field(False, description="True when no files were actually removed")


class ReclaimOrphansResponse(BaseModel):
    """Response for ``POST /storage/reclaim-orphans`` (spec 06)."""
    success: bool = True
    reclaimed: ReclaimOrphansReport = Field(default_factory=ReclaimOrphansReport)
