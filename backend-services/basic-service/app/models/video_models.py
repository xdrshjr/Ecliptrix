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
    max_videos: int = Field(default=20, description="Maximum number of videos to return", ge=1, le=100)
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


class VideoSearchResponse(BaseResponse):
    """Video search response model."""
    
    videos: List[VideoInfo] = Field(default_factory=list, description="List of found videos")
    total_found: int = Field(0, description="Total number of videos found")
    page: int = Field(1, description="Current page number")
    per_page: int = Field(20, description="Number of results per page")
    query: str = Field(default="", description="Search query used")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "message": "Videos retrieved successfully",
                "videos": [
                    {
                        "id": 12345,
                        "title": "Beautiful Landscape",
                        "author": "John Doe", 
                        "duration": 30,
                        "video_url": "https://example.com/video.mp4",
                        "thumbnail": "https://example.com/thumbnail.jpg",
                        "width": 1920,
                        "height": 1080
                    }
                ],
                "total_found": 100,
                "page": 1,
                "per_page": 20,
                "query": "nature landscape"
            }
        }
    )


class ImagePosition(BaseModel):
    """Position and size configuration for image overlays."""
    x: float = Field(..., description="X position as percentage (0.0 to 1.0)")
    y: float = Field(..., description="Y position as percentage (0.0 to 1.0)")
    width: float = Field(..., description="Width as percentage (0.0 to 1.0)")
    height: float = Field(..., description="Height as percentage (0.0 to 1.0)")
    rotation: float = Field(0.0, description="Rotation angle in degrees")
    z_index: Optional[int] = Field(10, description="Layer order for multiple image overlays")


class VideoCompositionItem(BaseModel):
    """
    Individual video item in the composition timeline.
    """
    id: str = Field(..., description="Unique identifier for the timeline item")
    name: str = Field(..., description="Display name of the video item")
    url: str = Field(..., description="Video URL (can be local file path or remote URL)")
    start_time: float = Field(..., ge=0, description="Start time in the timeline (seconds)")
    duration: float = Field(..., gt=0, description="Duration in the timeline (seconds)")
    track_id: str = Field(..., description="ID of the track this item belongs to")
    
    # Video trimming/clipping properties (may be None for untrimmed videos)
    clip_start: Optional[float] = Field(None, description="Start time for trimming within the original video (seconds)")
    clip_end: Optional[float] = Field(None, description="End time for trimming within the original video (seconds)")
    original_duration: Optional[float] = Field(None, description="Original video duration before trimming (seconds)")
    
    # Video transformation properties
    volume: Optional[float] = Field(1.0, ge=0, le=2, description="Volume level (0.0 to 2.0)")
    opacity: Optional[float] = Field(1.0, ge=0, le=1, description="Opacity level (0.0 to 1.0)")
    image_position: Optional[ImagePosition] = Field(None, description="Position for image overlay (only for image materials)")


class AudioCompositionItem(BaseModel):
    """
    Individual audio item in the composition timeline.
    """
    id: str = Field(..., description="Unique identifier for the timeline item")
    name: str = Field(..., description="Display name of the audio item")
    url: str = Field(..., description="Audio URL (can be local file path or remote URL)")
    start_time: float = Field(..., ge=0, description="Start time in the timeline (seconds)")
    duration: float = Field(..., gt=0, description="Duration in the timeline (seconds)")
    track_id: str = Field(..., description="ID of the track this item belongs to")
    
    # Audio properties
    volume: float = Field(1.0, ge=0, le=2, description="Volume level (0.0 to 2.0)")
    
    # Audio trimming/clipping properties (may be None for untrimmed audio)
    clip_start: Optional[float] = Field(None, description="Start time for trimming within the original audio (seconds)")
    clip_end: Optional[float] = Field(None, description="End time for trimming within the original audio (seconds)")


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


class VideoProcessingStage(str, Enum):
    """Video processing stages for error tracking."""
    DOWNLOAD = "download"
    NORMALIZATION = "normalization"
    CONCATENATION = "concatenation"
    AUDIO_PROCESSING = "audio_processing"
    FINALIZATION = "finalization"


class VideoProcessingError(BaseModel):
    """Detailed error information for individual video processing failures."""
    video_index: int = Field(..., description="Index of the failed video in the timeline order")
    video_id: str = Field(..., description="ID of the failed video item")
    video_name: str = Field(..., description="Name of the failed video item")
    video_url: str = Field(..., description="URL of the failed video")
    stage: VideoProcessingStage = Field(..., description="Processing stage where the failure occurred")
    attempts: int = Field(..., description="Number of retry attempts made")
    max_retries: int = Field(..., description="Maximum number of retries allowed")
    error_message: str = Field(..., description="Detailed error message")
    last_error: str = Field(..., description="The final error that caused all retries to fail")
    timeline_position: float = Field(..., description="Position in timeline where this video should appear (seconds)")
    duration: float = Field(..., description="Expected duration of this video in the timeline (seconds)")


class CompositionErrorDetails(BaseModel):
    """Comprehensive error details for video composition failures."""
    failed_videos: List[VideoProcessingError] = Field(default_factory=list, description="Details of videos that failed to process")
    total_videos: int = Field(..., description="Total number of videos in the composition")
    successful_videos: int = Field(..., description="Number of videos that processed successfully")
    composition_stage: str = Field(..., description="Overall composition stage where failure occurred")
    error_summary: str = Field(..., description="Human-readable summary of what went wrong")
    recovery_suggestions: List[str] = Field(default_factory=list, description="Suggestions for resolving the issues")


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
    error_details: Optional[CompositionErrorDetails] = Field(None, description="Detailed error information if composition failed")


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

# Image to Video Conversion Models
class ImageToVideoEffect(str, Enum):
    """Image to video effect types."""
    STATIC = "static"
    KEN_BURNS = "ken_burns"
    PAN = "pan"

class ImageToVideoRequest(BaseModel):
    """Request model for image to video conversion."""
    image_url: Optional[str] = Field(None, description="URL of the image to convert (for remote images)")
    image_data: Optional[str] = Field(None, description="Base64 encoded image data (for blob/local images)")
    image_filename: Optional[str] = Field(None, description="Original filename of the image")
    effect: ImageToVideoEffect = Field(..., description="Video effect to apply")
    duration: float = Field(default=5.0, ge=1.0, le=30.0, description="Video duration in seconds")
    task_id: Optional[str] = Field(None, description="Task ID for organization")
    custom_filename: Optional[str] = Field(None, description="Custom filename for the output video")
    
    # Focus point parameters (0.0 to 1.0 range representing relative position on image)
    focus_x: Optional[float] = Field(default=0.5, ge=0.0, le=1.0, description="Focus point X coordinate (0.0-1.0, 0.5 is center)")
    focus_y: Optional[float] = Field(default=0.5, ge=0.0, le=1.0, description="Focus point Y coordinate (0.0-1.0, 0.5 is center)")
    
    # Ken Burns effect parameters
    ken_burns_direction: Optional[str] = Field(default="zoom_in", description="Ken Burns direction: zoom_in or zoom_out")
    
    # Pan effect parameters  
    pan_direction: Optional[str] = Field(default="left_to_right", description="Pan direction: left_to_right or right_to_left")

    @validator('image_data')
    def validate_image_source(cls, v, values):
        """Ensure either image_url or image_data is provided."""
        image_url = values.get('image_url')
        if not image_url and not v:
            raise ValueError('Either image_url or image_data must be provided')
        return v

class ImageToVideoResponse(BaseModel):
    """Response model for image to video conversion."""
    success: bool = Field(..., description="Whether the conversion was successful")
    message: str = Field(..., description="Response message")
    video_url: Optional[str] = Field(None, description="URL of the generated video")
    thumbnail_url: Optional[str] = Field(None, description="URL of the video thumbnail")
    file_size: Optional[int] = Field(None, description="File size in bytes")
    duration: Optional[float] = Field(None, description="Video duration in seconds")
    width: Optional[int] = Field(None, description="Video width in pixels")
    height: Optional[int] = Field(None, description="Video height in pixels")
    effect_applied: Optional[str] = Field(None, description="Effect that was applied")
    processing_time: Optional[float] = Field(None, description="Processing time in seconds")

class ImageToVideoErrorResponse(BaseModel):
    """Error response model for image to video conversion."""
    success: bool = Field(False, description="Always false for error responses")
    message: str = Field(..., description="Error message")
    error_code: str = Field(..., description="Error code")
    details: Optional[str] = Field(None, description="Additional error details") 

class VideoCutClipRequest(BaseModel):
    """Individual video clip cut request."""
    
    id: str = Field(description="Unique identifier for the clip")
    name: str = Field(description="Display name of the clip")
    start_time: float = Field(description="Start time in seconds within the original video")
    end_time: float = Field(description="End time in seconds within the original video")
    duration: float = Field(description="Duration of the clip in seconds")


class VideoCutRequest(BaseModel):
    """Video cutting request model."""
    
    task_id: str = Field(description="Task ID for tracking and logging")
    video_url: str = Field(description="URL of the original video to cut")
    clips: List[VideoCutClipRequest] = Field(description="List of clips to cut from the video")
    generate_thumbnails: bool = Field(default=True, description="Whether to generate thumbnails for cut clips")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "task_id": "cut_task_123",
                "video_url": "https://example.com/video.mp4",
                "clips": [
                    {
                        "id": "clip_1",
                        "name": "First Clip",
                        "start_time": 10.0,
                        "end_time": 30.0,
                        "duration": 20.0
                    }
                ],
                "generate_thumbnails": True
            }
        }
    )


class VideoCutClipResult(BaseModel):
    """Individual video clip cut result."""
    
    id: str = Field(description="Unique identifier for the clip")
    name: str = Field(description="Display name of the clip")
    video_url: str = Field(description="URL of the cut video clip")
    thumbnail_url: Optional[str] = Field(default=None, description="URL of the video thumbnail")
    file_size: int = Field(description="File size in bytes")
    duration: float = Field(description="Duration of the clip in seconds")
    width: int = Field(description="Video width in pixels")
    height: int = Field(description="Video height in pixels")
    format: str = Field(description="Video format (e.g., mp4)")


class VideoCutResponse(BaseResponse):
    """Video cutting response model."""
    
    clips: List[VideoCutClipResult] = Field(default_factory=list, description="List of cut video clips")
    total_clips: int = Field(0, description="Total number of clips processed")
    processing_time: float = Field(0.0, description="Total processing time in seconds")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "message": "Video clips cut and uploaded successfully",
                "clips": [
                    {
                        "id": "clip_1",
                        "name": "First Clip",
                        "video_url": "https://supabase.example.com/storage/v1/object/public/videos/clip_1.mp4",
                        "thumbnail_url": "https://supabase.example.com/storage/v1/object/public/thumbnails/clip_1.jpg",
                        "file_size": 1024000,
                        "duration": 20.0,
                        "width": 1920,
                        "height": 1080,
                        "format": "mp4"
                    }
                ],
                "total_clips": 1,
                "processing_time": 15.5
            }
        }
    ) 


# Watermark Removal Models

class WatermarkArea(BaseModel):
    """Watermark area coordinates."""
    x1: int = Field(..., description="Left x coordinate of watermark area", ge=0)
    y1: int = Field(..., description="Top y coordinate of watermark area", ge=0)
    x2: int = Field(..., description="Right x coordinate of watermark area", gt=0)
    y2: int = Field(..., description="Bottom y coordinate of watermark area", gt=0)
    
    @validator('x2')
    def x2_must_be_greater_than_x1(cls, v, values):
        if 'x1' in values and v <= values['x1']:
            raise ValueError('x2 must be greater than x1')
        return v
    
    @validator('y2')
    def y2_must_be_greater_than_y1(cls, v, values):
        if 'y1' in values and v <= values['y1']:
            raise ValueError('y2 must be greater than y1')
        return v

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "x1": 10,
                "y1": 10,
                "x2": 300,
                "y2": 250
            }
        }
    )


class WatermarkRemovalRequest(BaseModel):
    """Watermark removal request model."""
    
    task_id: str = Field(..., description="Unique task identifier", min_length=1)
    video_url: str = Field(..., description="URL of the video to process", min_length=1)
    watermark_area: WatermarkArea = Field(..., description="Coordinates of the watermark area to remove")
    custom_filename: Optional[str] = Field(None, description="Custom filename for the output video")
    inpaint_radius: int = Field(default=5, description="Inpainting radius for watermark removal", ge=1, le=20)
    inpaint_method: str = Field(default="telea", description="Inpainting method (telea or ns)", pattern="^(telea|ns)$")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "task_id": "task_123456",
                "video_url": "https://example.com/video.mp4",
                "watermark_area": {
                    "x1": 10,
                    "y1": 10,
                    "x2": 300,
                    "y2": 250
                },
                "custom_filename": "video_no_watermark.mp4",
                "inpaint_radius": 5,
                "inpaint_method": "telea"
            }
        }
    )


class WatermarkRemovalResponse(BaseResponse):
    """Watermark removal response model."""
    
    task_id: str = Field(..., description="Task identifier")
    original_video_url: str = Field(..., description="Original video URL")
    processed_video_url: Optional[str] = Field(None, description="URL of the processed video without watermark")
    watermark_area: Optional[WatermarkArea] = Field(None, description="Coordinates of the removed watermark area")
    processing_time: float = Field(0.0, description="Processing time in seconds", ge=0)
    video_duration: Optional[float] = Field(None, description="Video duration in seconds", ge=0)
    total_frames: Optional[int] = Field(None, description="Total number of frames processed", ge=0)
    inpaint_method: Optional[str] = Field(None, description="Inpainting method used")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "message": "Watermark removal completed successfully",
                "task_id": "task_123456",
                "original_video_url": "https://example.com/video.mp4",
                "processed_video_url": "https://example.com/processed_video_no_watermark.mp4",
                "watermark_area": {
                    "x1": 10,
                    "y1": 10,
                    "x2": 300,
                    "y2": 250
                },
                "processing_time": 45.2,
                "video_duration": 30.0,
                "total_frames": 900,
                "inpaint_method": "telea"
            }
        }
    )


class WatermarkRemovalErrorResponse(BaseResponse):
    """Watermark removal error response model."""
    
    task_id: Optional[str] = Field(None, description="Task identifier")
    error_code: str = Field(..., description="Error code for categorization")
    details: Optional[str] = Field(None, description="Detailed error information")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": False,
                "message": "Watermark removal failed",
                "task_id": "task_123456",
                "error_code": "PROCESSING_ERROR",
                "details": "Failed to process video frames"
            }
        }
    ) 