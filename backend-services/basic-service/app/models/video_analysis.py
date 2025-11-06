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


class VideoAnalysisItem(BaseModel):
    """Model for individual video in batch analysis request."""
    video_url: str = Field(..., description="URL or path to the video file to analyze")
    frame_interval: int = Field(default=5, description="Interval in seconds between frames to extract")
    thumbnail_url: Optional[str] = Field(None, description="Thumbnail URL for quick mode analysis (skips video download/frame extraction)")


class BatchVideoAnalysisRequest(BaseModel):
    """Request model for batch video analysis."""
    videos: List[VideoAnalysisItem] = Field(..., description="List of videos to analyze")
    custom_prompt: Optional[str] = Field(None, description="Custom prompt for LLM analysis (applies to all videos)")
    use_thumbnails: bool = Field(default=False, description="Use thumbnails instead of downloading videos (quick mode)")


class BatchVideoAnalysisResult(BaseModel):
    """Model for individual video result in batch analysis."""
    video_url: str = Field(..., description="URL of the analyzed video")
    success: bool = Field(..., description="Whether the analysis was successful")
    total_frames_extracted: int = Field(default=0, description="Total number of frames extracted")
    video_duration: float = Field(default=0.0, description="Duration of the video in seconds")
    frame_analyses: List[FrameAnalysis] = Field(default_factory=list, description="List of frame analysis results")
    error_message: Optional[str] = Field(None, description="Error message if analysis failed")


class BatchVideoAnalysisResponse(BaseModel):
    """Response model for batch video analysis."""
    success: bool = Field(..., description="Whether the batch analysis was successful")
    total_videos: int = Field(..., description="Total number of videos processed")
    successful_videos: int = Field(..., description="Number of successfully analyzed videos")
    failed_videos: int = Field(..., description="Number of failed video analyses")
    results: List[BatchVideoAnalysisResult] = Field(..., description="List of individual video analysis results")
    total_frames_extracted: int = Field(..., description="Total frames extracted across all videos")
    total_processing_time: float = Field(..., description="Total time taken to process all videos in seconds")
    frame_extraction_time: float = Field(..., description="Time spent on sequential frame extraction in seconds")
    vlm_analysis_time: float = Field(..., description="Time spent on concurrent VLM analysis in seconds")
    concurrent_threads: int = Field(..., description="Number of concurrent threads used for VLM analysis")
    timestamp: datetime = Field(default_factory=datetime.now, description="Timestamp of the analysis")
    message: Optional[str] = Field(None, description="Additional message") 