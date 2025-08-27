"""
Video analysis data models for the Basic Service application.
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class FrameAnalysis(BaseModel):
    """Model for individual frame analysis result."""
    frame_number: int = Field(..., description="Frame number in the video")
    timestamp: float = Field(..., description="Timestamp of the frame in seconds")
    analysis: str = Field(..., description="LLM analysis description of the frame")
    frame_path: Optional[str] = Field(None, description="Path to the extracted frame image")


class VideoAnalysisRequest(BaseModel):
    """Request model for video analysis."""
    video_url: str = Field(..., description="URL or path to the video file to analyze")
    frame_interval: int = Field(default=5, description="Interval in seconds between frames to extract")
    custom_prompt: Optional[str] = Field(None, description="Custom prompt for LLM analysis")


class VideoAnalysisResponse(BaseModel):
    """Response model for video analysis."""
    success: bool = Field(..., description="Whether the analysis was successful")
    video_url: str = Field(..., description="URL of the analyzed video")
    total_frames_extracted: int = Field(..., description="Total number of frames extracted")
    video_duration: float = Field(..., description="Duration of the video in seconds")
    frame_analyses: List[FrameAnalysis] = Field(..., description="List of frame analysis results")
    processing_time: float = Field(..., description="Time taken to process the video in seconds")
    timestamp: datetime = Field(default_factory=datetime.now, description="Timestamp of the analysis")
    message: Optional[str] = Field(None, description="Additional message")


class VideoAnalysisStatusResponse(BaseModel):
    """Response model for video analysis status."""
    success: bool = Field(..., description="Whether the status check was successful")
    video_url: str = Field(..., description="URL of the video")
    status: str = Field(..., description="Analysis status: pending, processing, completed, failed")
    progress: float = Field(default=0.0, description="Progress percentage (0-100)")
    message: Optional[str] = Field(None, description="Status message")
    result: Optional[VideoAnalysisResponse] = Field(None, description="Analysis result if completed") 