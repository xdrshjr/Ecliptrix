"""
AI Mixed Editing models for automatic video editing.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any


class VideoFrameAnalysis(BaseModel):
    """Model for individual video frame analysis data."""
    
    frame_number: int = Field(..., description="Frame number in the video")
    timestamp: float = Field(..., description="Timestamp of the frame in seconds")
    analysis: str = Field(..., description="LLM analysis description of the frame")
    frame_path: Optional[str] = Field(None, description="Path to the extracted frame image (optional)")
    
    model_config = {"extra": "ignore"}  # Allow extra fields from frontend


class VideoAnalysisMetadata(BaseModel):
    """Model for video analysis metadata stored in MaterialItemModel."""
    
    video_url: str = Field(..., description="URL of the analyzed video")
    total_frames_extracted: int = Field(..., description="Total number of frames extracted")
    video_duration: float = Field(..., description="Duration of the video in seconds")
    frame_analyses: List[VideoFrameAnalysis] = Field(..., description="List of frame analysis results")
    processing_time: float = Field(..., description="Time taken to process the video in seconds")
    analysis_timestamp: str = Field(..., description="Timestamp when analysis was performed")
    
    model_config = {"extra": "ignore"}  # Allow extra fields from frontend


class MaterialItemModel(BaseModel):
    """Material item model for AI mixed editing."""
    
    id: str = Field(..., description="Material unique identifier")
    name: str = Field(..., description="Material name")
    type: str = Field(..., description="Material type (video, audio, image)")
    format: str = Field(..., description="File format")
    size: int = Field(..., description="File size in bytes")
    duration: Optional[float] = Field(default=None, description="Duration in seconds for video/audio")
    width: Optional[int] = Field(default=None, description="Width in pixels for video/image")
    height: Optional[int] = Field(default=None, description="Height in pixels for video/image")
    url: str = Field(..., description="Material URL")
    serverUrl: Optional[str] = Field(default=None, description="Server URL for the material")
    thumbnailUrl: Optional[str] = Field(default=None, description="Thumbnail URL")
    description: Optional[str] = Field(default=None, description="Material description")
    tags: Optional[List[str]] = Field(default=None, description="Material tags")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")
    createdAt: str = Field(..., description="Creation timestamp")

    model_config = {"extra": "allow"}


class AIMixedEditingRequest(BaseModel):
    """Request model for AI mixed editing."""
    
    taskId: str = Field(..., description="Unique task identifier", min_length=1)
    materials: List[MaterialItemModel] = Field(..., description="List of materials to use for mixed editing", min_items=1)

    model_config = {"extra": "forbid"}


class AIMixedEditingResponse(BaseModel):
    """Response model for AI mixed editing."""
    
    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    timelineData: Optional[Dict[str, Any]] = Field(default=None, description="Generated timeline JSON data")
    taskId: str = Field(..., description="Task identifier")

    model_config = {"extra": "forbid"}


MAX_SEGMENT_VOLUME_PERCENT = 200.0
# Values up to this are read as a loudness multiplier (1.0 = original), not a
# percentage: LLMs frequently answer "volume": 0.8 despite the prompt.
MAX_VOLUME_MULTIPLIER = 3.0


# Segment models describe LLM output, so unknown fields are ignored rather
# than failing the whole plan (LLMs add "volume" to video segments, etc.).
class VideoSegmentModel(BaseModel):
    """Video segment model for simplified AI editing response."""

    material_id: str = Field(..., description="Material ID reference")
    start_time: float = Field(..., description="Start time in timeline (seconds)")
    duration: float = Field(..., description="Duration of the segment (seconds)")
    clip_start: Optional[float] = Field(default=0.0, description="Start time within the source material (seconds)")
    clip_end: Optional[float] = Field(default=None, description="End time within the source material (seconds)")

    model_config = {"extra": "ignore"}


class AudioSegmentModel(BaseModel):
    """Audio segment model for simplified AI editing response."""

    material_id: str = Field(..., description="Material ID reference")
    start_time: float = Field(..., description="Start time in timeline (seconds)")
    duration: float = Field(..., description="Duration of the segment (seconds)")
    track: str = Field(default="audio-track-1", description="Target audio track ID")
    volume: float = Field(default=100.0, description="百分比 0-200，100=原音量")
    clip_start: Optional[float] = Field(default=0.0, description="Start time within the source material (seconds)")
    clip_end: Optional[float] = Field(default=None, description="End time within the source material (seconds)")

    model_config = {"extra": "ignore"}

    @field_validator("volume", mode="before")
    @classmethod
    def normalise_volume(cls, value: Any) -> float:
        """Coerce LLM volume to a percentage in [0, 200]; unusable -> 100."""
        try:
            volume = float(value)
        except (TypeError, ValueError):
            return 100.0
        if 0 < volume <= MAX_VOLUME_MULTIPLIER:
            volume *= 100
        return max(0.0, min(volume, MAX_SEGMENT_VOLUME_PERCENT))


class ImageSegmentModel(BaseModel):
    """Image segment model for simplified AI editing response."""

    material_id: str = Field(..., description="Material ID reference")
    start_time: float = Field(..., description="Start time in timeline (seconds)")
    duration: float = Field(default=5.0, description="Display duration (seconds)")

    model_config = {"extra": "ignore"}


class SimplifiedTimelineModel(BaseModel):
    """Simplified timeline model for AI mixed editing response."""

    total_duration: float = Field(..., description="Total timeline duration (seconds)")
    video_segments: List[VideoSegmentModel] = Field(default=[], description="Video segments arrangement")
    audio_segments: List[AudioSegmentModel] = Field(default=[], description="Audio segments arrangement")
    image_segments: List[ImageSegmentModel] = Field(default=[], description="Image segments arrangement")

    model_config = {"extra": "ignore"}