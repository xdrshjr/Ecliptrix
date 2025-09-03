"""
Response models for the ComfyUI API Service.
"""

from typing import List, Optional, Any
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict, field_serializer
from datetime import datetime


class GenerationStatus(str, Enum):
    """Status of image generation process."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ImageInfo(BaseModel):
    """Information about a generated image."""
    filename: str = Field(..., description="Image filename")
    subfolder: str = Field(default="", description="Image subfolder")
    type: str = Field(default="output", description="Image type")
    url: Optional[str] = Field(default=None, description="Download URL")
    size_bytes: Optional[int] = Field(default=None, description="File size in bytes")


class VideoInfo(BaseModel):
    """Information about a generated video."""
    filename: str = Field(..., description="Video filename")
    subfolder: str = Field(default="", description="Video subfolder")
    type: str = Field(default="output", description="Video type")
    url: Optional[str] = Field(default=None, description="Download URL")
    size_bytes: Optional[int] = Field(default=None, description="File size in bytes")
    duration: Optional[float] = Field(default=None, description="Video duration in seconds")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = Field(..., description="Overall service status")
    message: str = Field(..., description="Status message")
    timestamp: datetime = Field(default_factory=datetime.now, description="Check timestamp")
    details: Optional[dict] = Field(default=None, description="Detailed health information")
    
    @field_serializer('timestamp')
    def serialize_timestamp(self, timestamp: datetime) -> str:
        return timestamp.isoformat()


class ErrorResponse(BaseModel):
    """Error response model."""
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(default=None, description="Detailed error information")
    timestamp: datetime = Field(default_factory=datetime.now, description="Error timestamp")
    
    @field_serializer('timestamp')
    def serialize_timestamp(self, timestamp: datetime) -> str:
        return timestamp.isoformat()


class ImageGenerationResponse(BaseModel):
    """Response for image generation request."""
    prompt_id: str = Field(..., description="Unique identifier for the generation task")
    status: GenerationStatus = Field(default=GenerationStatus.PENDING, description="Current status")
    message: str = Field(..., description="Status message")
    estimated_time: Optional[int] = Field(default=None, description="Estimated completion time in seconds")


class DigitalHumanGenerationResponse(BaseModel):
    """Response for digital human video generation request."""
    prompt_id: str = Field(..., description="Unique identifier for the generation task")
    status: GenerationStatus = Field(default=GenerationStatus.PENDING, description="Current status")
    message: str = Field(..., description="Status message")
    estimated_time: Optional[int] = Field(default=None, description="Estimated completion time in seconds")


class StatusResponse(BaseModel):
    """Response for status check."""
    prompt_id: str = Field(..., description="Generation task identifier")
    status: GenerationStatus = Field(..., description="Current status")
    progress: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="Progress percentage (0-1)")
    images: List[ImageInfo] = Field(default=[], description="Generated images if completed")
    error_message: Optional[str] = Field(default=None, description="Error message if failed")
    created_at: Optional[datetime] = Field(default=None, description="Task creation timestamp")
    completed_at: Optional[datetime] = Field(default=None, description="Task completion timestamp")
    
    @field_serializer('created_at', 'completed_at')
    def serialize_datetime(self, dt: Optional[datetime]) -> Optional[str]:
        return dt.isoformat() if dt else None


class DigitalHumanStatusResponse(BaseModel):
    """Response for digital human status check."""
    prompt_id: str = Field(..., description="Generation task identifier")
    status: GenerationStatus = Field(..., description="Current status")
    progress: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="Progress percentage (0-1)")
    videos: List[VideoInfo] = Field(default=[], description="Generated videos if completed")
    error_message: Optional[str] = Field(default=None, description="Error message if failed")
    created_at: Optional[datetime] = Field(default=None, description="Task creation timestamp")
    completed_at: Optional[datetime] = Field(default=None, description="Task completion timestamp")
    
    @field_serializer('created_at', 'completed_at')
    def serialize_datetime(self, dt: Optional[datetime]) -> Optional[str]:
        return dt.isoformat() if dt else None 