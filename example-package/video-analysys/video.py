"""
Data models for video upload and management.
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class VideoUploadResponse(BaseModel):
    """Response model for video upload."""
    success: bool = Field(..., description="Whether the upload was successful")
    filename: str = Field(..., description="The filename of the uploaded video")
    size: int = Field(..., description="The size of the uploaded video in bytes")
    content_type: str = Field(..., description="The content type of the uploaded video")
    timestamp: datetime = Field(default_factory=datetime.now, description="The timestamp of the upload")
    path: str = Field(..., description="The path where the video is stored")
    message: Optional[str] = Field(None, description="Additional message")
    upload_dir: Optional[str] = Field(None, description="The directory where the video was uploaded")


class HealthResponse(BaseModel):
    """Response model for health check."""
    status: str = Field(..., description="The status of the service")
    version: str = Field(..., description="The version of the service")
    timestamp: datetime = Field(default_factory=datetime.now, description="The current timestamp")
    uptime: float = Field(..., description="The uptime of the service in seconds")


class FrameAnalysis(BaseModel):
    """Model for individual frame analysis result."""
    frame_number: int = Field(..., description="Frame number in the video")
    timestamp: float = Field(..., description="Timestamp of the frame in seconds")
    analysis: str = Field(..., description="LLM analysis description of the frame")
    frame_path: Optional[str] = Field(None, description="Path to the extracted frame image")


class VideoAnalysisRequest(BaseModel):
    """Request model for video analysis."""
    video_path: str = Field(..., description="Path to the video file to analyze")
    frame_interval: int = Field(default=5, description="Interval in seconds between frames to extract")
    custom_prompt: Optional[str] = Field(None, description="Custom prompt for LLM analysis")


class VideoAnalysisResponse(BaseModel):
    """Response model for video analysis."""
    success: bool = Field(..., description="Whether the analysis was successful")
    video_path: str = Field(..., description="Path to the analyzed video")
    total_frames_extracted: int = Field(..., description="Total number of frames extracted")
    video_duration: float = Field(..., description="Duration of the video in seconds")
    frame_analyses: List[FrameAnalysis] = Field(..., description="List of frame analysis results")
    processing_time: float = Field(..., description="Time taken to process the video in seconds")
    timestamp: datetime = Field(default_factory=datetime.now, description="Timestamp of the analysis")
    message: Optional[str] = Field(None, description="Additional message")


class VideoDownloadRequest(BaseModel):
    """Request model for video download from URL."""
    video_url: str = Field(..., description="URL of the video to download")
    filename: Optional[str] = Field(None, description="Optional custom filename")


class VideoDownloadResponse(BaseModel):
    """Response model for video download."""
    success: bool = Field(..., description="Whether the download was successful")
    local_path: str = Field(..., description="Local path of the downloaded video")
    filename: str = Field(..., description="Filename of the downloaded video")
    size: int = Field(..., description="Size of the downloaded video in bytes")
    timestamp: datetime = Field(default_factory=datetime.now, description="Timestamp of the download")
    message: Optional[str] = Field(None, description="Additional message") 