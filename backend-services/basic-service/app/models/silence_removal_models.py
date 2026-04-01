"""
Data models for the silence detection and removal feature.

Defines request/response models for:
- Silence detection (FFmpeg silencedetect-based)
- Silence segment representation
- Silence removal (FFmpeg cut + concat)
- Async task progress tracking
"""

from typing import List, Optional
from pydantic import BaseModel, Field

from app.models.base_models import BaseResponse


class SilenceSegment(BaseModel):
    """A single detected silence segment within an audio/video file."""

    id: str = Field(description="Unique identifier for this segment (UUID)")
    start: float = Field(description="Start time in seconds")
    end: float = Field(description="End time in seconds")
    duration: float = Field(description="Duration of the silence segment in seconds")


class SilenceDetectData(BaseModel):
    """Payload carried in the `data` field of SilenceDetectResponse."""

    audio_url: str = Field(
        description="URL of the extracted audio file (low-bitrate MP3 for wavesurfer.js)"
    )
    audio_duration: float = Field(description="Total audio duration in seconds")
    silence_segments: List[SilenceSegment] = Field(
        default_factory=list,
        description="List of detected silence segments",
    )
    total_silence_duration: float = Field(
        description="Sum of all silence segment durations in seconds"
    )
    silence_percentage: float = Field(
        description="Percentage of the audio that is silence (0-100)"
    )


class SilenceDetectRequest(BaseModel):
    """Request body for POST /api/silence/detect."""

    video_url: str = Field(description="Video file URL (server-side path or storage URL)")
    noise_threshold: float = Field(
        default=-30.0,
        description="Silence threshold in dB. Range: [-60, -10]",
    )
    min_silence_duration: float = Field(
        default=0.5,
        description="Minimum silence duration in seconds. Range: [0.1, 5.0]",
    )


class SilenceDetectResponse(BaseResponse):
    """
    Response for POST /api/silence/detect.

    Inherits ``success``, ``message``, ``timestamp``, ``data`` from
    ``BaseResponse``.  The ``data`` field is typed as ``SilenceDetectData``
    so that consumers get full schema information.
    """

    data: Optional[SilenceDetectData] = Field(
        default=None,
        description="Silence detection result payload",
    )


# ---------------------------------------------------------------------------
# Silence Removal Models (TODO 02)
# ---------------------------------------------------------------------------


class SegmentToRemove(BaseModel):
    """A single segment the user has selected for removal."""

    id: str = Field(description="Segment ID (corresponds to SilenceSegment.id from detect)")
    start: float = Field(description="Start time in seconds (may have been adjusted by the user)")
    end: float = Field(description="End time in seconds (may have been adjusted by the user)")


class SilenceRemoveRequest(BaseModel):
    """Request body for POST /api/silence/remove."""

    video_url: str = Field(description="Original video file URL")
    segments_to_remove: List[SegmentToRemove] = Field(
        description="User-confirmed silence segments to remove"
    )
    preserved_gap: float = Field(
        default=0.2,
        description="Duration (seconds) of silence to preserve at each cut center. Range: [0, 1.0]",
    )
    fade_duration: float = Field(
        default=0.05,
        description="Audio fade in/out duration (seconds) at splice points. Range: [0, 0.5]",
    )


class SilenceRemoveAcceptedData(BaseModel):
    """Payload for the ``data`` field of SilenceRemoveAccepted."""

    task_id: str = Field(description="Async task identifier for progress polling")


class SilenceRemoveAccepted(BaseResponse):
    """
    Response for POST /api/silence/remove (202 Accepted).

    Returned immediately after the async processing task has been created.
    """

    data: Optional[SilenceRemoveAcceptedData] = Field(
        default=None,
        description="Contains the task_id for polling progress",
    )


class SilenceRemoveResult(BaseModel):
    """Final result payload included in SilenceProgressData when status=completed."""

    video_url: str = Field(description="URL of the processed video")
    original_duration: float = Field(description="Duration of the original video (seconds)")
    new_duration: float = Field(description="Duration of the processed video (seconds)")
    removed_count: int = Field(description="Number of silence segments that were removed")
    time_saved: float = Field(description="Total time removed (seconds)")


class SilenceProgressData(BaseModel):
    """Payload for the ``data`` field of SilenceProgressResponse."""

    task_id: str = Field(description="Async task identifier")
    status: str = Field(
        description='Task status: "pending" | "processing" | "completed" | "failed"'
    )
    progress: float = Field(
        default=0.0,
        description="Progress percentage 0-100",
    )
    stage_message: str = Field(
        default="",
        description="Human-readable description of the current processing stage",
    )
    result: Optional[SilenceRemoveResult] = Field(
        default=None,
        description="Present when status is 'completed'",
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message when status is 'failed'",
    )


class SilenceProgressResponse(BaseResponse):
    """
    Response for GET /api/silence/status/{task_id}.

    Inherits ``success``, ``message``, ``timestamp`` from ``BaseResponse``.
    """

    data: Optional[SilenceProgressData] = Field(
        default=None,
        description="Task progress payload",
    )
