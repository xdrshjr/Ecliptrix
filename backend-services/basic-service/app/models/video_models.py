"""
Video search data models for PEXELS API integration.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict, validator
from enum import Enum

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

class ImagePosition(BaseModel):
    """
    Position information for image overlays in video composition.
    """
    x: float = Field(..., ge=0, le=1, description="X coordinate (0-1, relative to video width)")
    y: float = Field(..., ge=0, le=1, description="Y coordinate (0-1, relative to video height)")
    width: float = Field(..., ge=0, le=1, description="Width (0-1, relative to video width)")
    height: float = Field(..., ge=0, le=1, description="Height (0-1, relative to video height)")
    z_index: Optional[int] = Field(10, description="Layer order for multiple image overlays")


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
    
    # 新增：图片叠加相关属性
    original_material_type: Optional[str] = Field(None, description="Original material type (video, image, audio, etc.)")
    image_position: Optional[ImagePosition] = Field(None, description="Position for image overlay (only for image materials)")


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
    font_family: str = Field("default", description="Font family (default, serif, sans-serif, monospace)")
    font_size: int = Field(24, ge=8, le=72, description="Font size in pixels")
    font_color: str = Field("#FFFFFF", description="Font color in hex format")
    background_color: Optional[str] = Field(None, description="Background color in hex format")
    position: str = Field("bottom", description="Subtitle position (top, center, bottom, upper-3/4, lower-3/4)")


class ImageCompositionItem(BaseModel):
    """
    Individual image item in the composition timeline for overlay purposes.
    """
    id: str = Field(..., description="Unique identifier for the timeline item")
    name: str = Field(..., description="Display name of the image item")
    url: str = Field(..., description="Image URL (can be local file path or remote URL)")
    start_time: float = Field(..., ge=0, description="Start time in the timeline (seconds)")
    duration: float = Field(..., gt=0, description="Duration of the image display (seconds)")
    track_id: str = Field(..., description="ID of the track this item belongs to")
    position: ImagePosition = Field(..., description="Position and size of the image overlay")
    opacity: float = Field(1.0, ge=0, le=1, description="Opacity level (0.0 to 1.0)")
    
    # 新增：图片动画和效果属性
    fade_in_duration: float = Field(0.0, ge=0, description="Fade-in duration in seconds")
    fade_out_duration: float = Field(0.0, ge=0, description="Fade-out duration in seconds")


class AspectRatio(str, Enum):
    """Supported aspect ratios for video composition."""
    RATIO_16_9 = "16:9"
    RATIO_9_16 = "9:16" 
    RATIO_4_3 = "4:3"
    RATIO_1_1 = "1:1"
    RATIO_21_9 = "21:9"


class VideoCompositionRequest(BaseModel):
    """
    Request model for video composition.
    """
    task_id: str = Field(..., description="Task ID for tracking and logging")
    video_items: List[VideoCompositionItem] = Field(..., description="List of video items to compose")
    audio_items: List[AudioCompositionItem] = Field(default_factory=list, description="List of audio items to compose")
    subtitle_items: List[SubtitleCompositionItem] = Field(default_factory=list, description="List of subtitle items to compose")
    image_items: List[ImageCompositionItem] = Field(default_factory=list, description="List of image items to compose as overlays")
    total_duration: float = Field(..., gt=0, description="Total duration of the composition (seconds)")
    aspect_ratio: AspectRatio = Field(AspectRatio.RATIO_16_9, description="Output video aspect ratio")
    output_resolution: Optional[Dict[str, int]] = Field(
        None, 
        description="Output video resolution (auto-calculated from aspect_ratio if not provided)"
    )
    output_fps: int = Field(30, ge=15, le=60, description="Output video frame rate")
    output_format: str = Field("mp4", description="Output video format")
    
    @validator('output_resolution', always=True)
    def validate_and_set_resolution(cls, v, values):
        """Validate resolution or auto-calculate from aspect ratio."""
        aspect_ratio = values.get('aspect_ratio', AspectRatio.RATIO_16_9)
        
        # Auto-calculate resolution from aspect ratio if not provided
        if v is None:
            resolution_map = {
                AspectRatio.RATIO_16_9: {"width": 1920, "height": 1080},
                AspectRatio.RATIO_9_16: {"width": 1080, "height": 1920},
                AspectRatio.RATIO_4_3: {"width": 1440, "height": 1080},
                AspectRatio.RATIO_1_1: {"width": 1080, "height": 1080},
                AspectRatio.RATIO_21_9: {"width": 2560, "height": 1080}
            }
            v = resolution_map[aspect_ratio]
        
        # Validate provided resolution
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


class SubtitleAddRequest(BaseModel):
    """
    Request model for adding subtitles to an existing video.
    """
    video_file_path: str = Field(..., description="Path to the input video file")
    subtitle_file_path: str = Field(..., description="Path to the SRT subtitle file")
    font_family: str = Field("default", description="Font family (default, serif, sans-serif, monospace)")
    font_size: int = Field(24, ge=8, le=72, description="Font size in pixels")
    font_color: str = Field("#FFFFFF", description="Font color in hex format (e.g., #FFFFFF)")
    background_color: Optional[str] = Field(None, description="Background color in hex format (optional)")
    border_width: int = Field(2, ge=0, le=10, description="Text border width in pixels")
    border_color: str = Field("#000000", description="Text border color in hex format")
    position: str = Field("bottom", description="Subtitle position (top, center, bottom)")
    margin_vertical: int = Field(50, ge=10, le=200, description="Vertical margin from edge in pixels")
    margin_horizontal: int = Field(50, ge=10, le=200, description="Horizontal margin from edge in pixels")
    max_line_width: Optional[int] = Field(None, description="Maximum line width in characters (auto-calculated if not provided)")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "video_file_path": "datas/merge/video-1.mp4",
                "subtitle_file_path": "datas/merge/basic-01.srt",
                "font_family": "default",
                "font_size": 24,
                "font_color": "#FFFFFF",
                "background_color": "#000000",
                "border_width": 2,
                "border_color": "#000000",
                "position": "bottom",
                "margin_vertical": 50,
                "margin_horizontal": 50
            }
        }
    )


class SubtitleAddResponse(BaseResponse):
    """
    Response model for subtitle addition.
    """
    output_video_path: Optional[str] = Field(None, description="Path to the output video with subtitles")
    video_width: Optional[int] = Field(None, description="Width of the processed video")
    video_height: Optional[int] = Field(None, description="Height of the processed video")
    subtitle_count: Optional[int] = Field(None, description="Number of subtitle entries processed")
    processing_time: Optional[float] = Field(None, description="Processing time in seconds")
    file_size: Optional[int] = Field(None, description="Size of the output file in bytes") 