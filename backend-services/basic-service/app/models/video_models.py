"""
Video search data models for PEXELS API integration.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict, validator
from .base_models import BaseResponse


class VideoSearchRequest(BaseModel):
    """Video search request model."""
    
    query: str = Field(description="Search query for videos", min_length=1, max_length=200)
    max_videos: int = Field(default=20, description="Maximum number of videos to return", ge=1, le=50)
    orientation: str = Field(default="mixed", description="Video orientation filter", pattern="^(landscape|portrait|mixed)$")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "query": "nature landscape",
                "max_videos": 20,
                "orientation": "mixed"
            }
        }
    )


class VideoInfo(BaseModel):
    """Individual video information model."""
    
    id: int = Field(description="Video ID from PEXELS")
    title: str = Field(description="Video title")
    author: str = Field(description="Video author/creator")
    duration: Optional[int] = Field(default=None, description="Video duration in seconds")
    video_url: str = Field(description="Direct video file URL")
    thumbnail: str = Field(description="Video thumbnail URL")
    width: int = Field(description="Video width in pixels")
    height: int = Field(description="Video height in pixels")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": 12345,
                "title": "Video by John Doe",
                "author": "John Doe",
                "duration": 30,
                "video_url": "https://example.com/video.mp4",
                "thumbnail": "https://example.com/thumbnail.jpg",
                "width": 1920,
                "height": 1080
            }
        }
    )


class VideoSearchResponse(BaseModel):
    """Video search response model."""
    
    success: bool = Field(description="Whether the search was successful")
    message: str = Field(description="Response message")
    videos: List[VideoInfo] = Field(default=[], description="List of found videos")
    total_found: int = Field(description="Total number of videos found")
    query: str = Field(description="Original search query")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "message": "Found 20 videos",
                "videos": [
                    {
                        "id": 12345,
                        "title": "Video by John Doe",
                        "author": "John Doe",
                        "duration": 30,
                        "video_url": "https://example.com/video.mp4",
                        "thumbnail": "https://example.com/thumbnail.jpg",
                        "width": 1920,
                        "height": 1080
                    }
                ],
                "total_found": 20,
                "query": "nature landscape"
            }
        }
    ) 

# Video Composition Models
class VideoCompositionItem(BaseModel):
    """
    Individual video item in the composition timeline.
    """
    id: str = Field(..., description="Unique identifier for the timeline item")
    name: str = Field(..., description="Display name of the video item")
    url: str = Field(..., description="Video URL (can be local file path or remote URL)")
    start_time: float = Field(..., ge=0, description="Start time in the timeline (seconds)")
    duration: float = Field(..., gt=0, description="Duration of the video segment (seconds)")
    track_id: str = Field(..., description="ID of the track this item belongs to")
    volume: float = Field(1.0, ge=0, le=2, description="Volume level (0.0 to 2.0)")
    opacity: float = Field(1.0, ge=0, le=1, description="Opacity level (0.0 to 1.0)")
    
    # 新增：视频剪辑属性，用于支持时间轴上的素材缩放
    clip_start: float = Field(0.0, ge=0, description="Start time within the source video file (seconds)")
    clip_end: float = Field(..., gt=0, description="End time within the source video file (seconds)")


class AudioCompositionItem(BaseModel):
    """
    Individual audio item in the composition timeline.
    """
    id: str = Field(..., description="Unique identifier for the timeline item")
    name: str = Field(..., description="Display name of the audio item")
    url: str = Field(..., description="Audio URL (can be local file path or remote URL)")
    start_time: float = Field(..., ge=0, description="Start time in the timeline (seconds)")
    duration: float = Field(..., gt=0, description="Duration of the audio segment (seconds)")
    track_id: str = Field(..., description="ID of the track this item belongs to")
    volume: float = Field(1.0, ge=0, le=2, description="Volume level (0.0 to 2.0)")
    
    # 新增：音频剪辑属性，用于支持时间轴上的素材缩放
    clip_start: float = Field(0.0, ge=0, description="Start time within the source audio file (seconds)")
    clip_end: float = Field(..., gt=0, description="End time within the source audio file (seconds)")


class SubtitleCompositionItem(BaseModel):
    """
    Individual subtitle item in the composition timeline.
    """
    id: str = Field(..., description="Unique identifier for the timeline item")
    name: str = Field(..., description="Display name of the subtitle item")
    text: str = Field(..., description="Subtitle text content")
    start_time: float = Field(..., ge=0, description="Start time in the timeline (seconds)")
    duration: float = Field(..., gt=0, description="Duration of the subtitle display (seconds)")
    track_id: str = Field(..., description="ID of the track this item belongs to")
    font_size: int = Field(24, ge=8, le=72, description="Font size in pixels")
    font_color: str = Field("#FFFFFF", description="Font color in hex format")
    background_color: Optional[str] = Field(None, description="Background color in hex format")
    position: str = Field("bottom", description="Subtitle position (top, center, bottom)")


class VideoCompositionRequest(BaseModel):
    """
    Request model for video composition.
    """
    task_id: str = Field(..., description="Task ID for tracking and logging")
    video_items: List[VideoCompositionItem] = Field(..., description="List of video items to compose")
    audio_items: List[AudioCompositionItem] = Field(default_factory=list, description="List of audio items to compose")
    subtitle_items: List[SubtitleCompositionItem] = Field(default_factory=list, description="List of subtitle items to compose")
    total_duration: float = Field(..., gt=0, description="Total duration of the composition (seconds)")
    output_resolution: Dict[str, int] = Field(
        default={"width": 1920, "height": 1080}, 
        description="Output video resolution"
    )
    output_fps: int = Field(30, ge=15, le=60, description="Output video frame rate")
    output_format: str = Field("mp4", description="Output video format")
    
    @validator('output_resolution')
    def validate_resolution(cls, v):
        if 'width' not in v or 'height' not in v:
            raise ValueError('Resolution must contain width and height')
        if v['width'] <= 0 or v['height'] <= 0:
            raise ValueError('Resolution width and height must be positive')
        return v


class VideoCompositionResponse(BaseResponse):
    """
    Response model for video composition.
    """
    composition_id: Optional[str] = Field(None, description="Unique identifier for the composition job")
    status: str = Field(..., description="Composition status (processing, completed, failed)")
    progress: float = Field(0.0, ge=0, le=1, description="Composition progress (0.0 to 1.0)")
    output_file_path: Optional[str] = Field(None, description="Path to the composed video file")
    output_file_size: Optional[int] = Field(None, description="Size of the output file in bytes")
    processing_time: Optional[float] = Field(None, description="Total processing time in seconds")
    error_details: Optional[Dict[str, Any]] = Field(None, description="Error details if composition failed")


class VideoDownloadRequest(BaseModel):
    """
    Request model for video download.
    """
    composition_id: str = Field(..., description="Composition ID to download")
    task_id: Optional[str] = Field(None, description="Task ID for tracking")


class VideoDownloadResponse(BaseResponse):
    """
    Response model for video download.
    """
    download_url: Optional[str] = Field(None, description="URL to download the composed video")
    file_name: Optional[str] = Field(None, description="Name of the file to download")
    file_size: Optional[int] = Field(None, description="Size of the file in bytes")
    expires_at: Optional[str] = Field(None, description="Download link expiration time (ISO format)") 